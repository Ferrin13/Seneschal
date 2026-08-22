import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { activities } from "../db/schema.js";
import {
  llmChat,
  llmConfigured,
  llmTranscribe,
  type ChatMessage,
} from "../llm/index.js";
import { runToolLoop } from "../tools/loop.js";
import { serverToolRegistry } from "../tools/registry.js";
import type { ToolDef } from "../tools/types.js";

/**
 * Voice interface: POST /voice/command drives one LLM function-calling loop
 * over a hybrid tool catalog.
 *
 * - The phone advertises its client tools (executed on-device against its
 *   offline-first repositories) in every request.
 * - Server tools (tools/registry.ts) are executed inline during the loop.
 * - When the LLM calls client tools, the route returns the calls plus the
 *   running message array; the phone executes them, then re-posts with
 *   `messages` + `toolResults` to continue the same conversation. The
 *   server keeps no session state.
 *
 * A fresh turn starts from `audio` (transcribed here with Whisper-class
 * STT — far more accurate than the on-device recognizer) or a `transcript`
 * (the phone's offline recognizer fallback path).
 */

const timerContext = z
  .object({
    activityId: z.string(),
    activityName: z.string(),
    startedAt: z.string(),
  })
  .nullable()
  .optional();

const toolDefWire = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(2000).default(""),
  parameters: z.record(z.unknown()).default({ type: "object", properties: {} }),
  requiresConfirmation: z.boolean().optional(),
});

const commandBody = z.object({
  /** Raw base64 (no data-URI prefix). Fresh turns only. */
  audio: z
    .object({
      data: z.string().min(1),
      format: z.enum(["wav", "mp3", "m4a", "ogg", "webm", "aac", "flac"]),
    })
    .optional(),
  /** Pre-transcribed text (offline recognizer path). Fresh turns only. */
  transcript: z.string().min(1).max(2000).optional(),
  /** Client-executed tools the phone supports, sent with every request. */
  toolCatalog: z.array(toolDefWire).max(64).default([]),
  /** Client's current time as ISO-8601 with offset. */
  now: z.string(),
  /** IANA zone id, e.g. America/Denver. */
  timezone: z.string().max(100),
  /** Client-side running timer, if any (client state wins over server's). */
  runningTimer: timerContext,
  /** Continuation: the message array a previous response returned. */
  messages: z.array(z.record(z.unknown())).max(60).optional(),
  /** Continuation: results of the client tool calls, in order. */
  toolResults: z
    .array(z.object({ toolCallId: z.string(), result: z.string().max(8000) }))
    .max(16)
    .optional(),
});

type TimerContext = { activityName: string; startedAt: string } | null;

function systemPrompt(
  now: string,
  timezone: string,
  activityList: { id: string; name: string }[],
  runningTimer: TimerContext
): string {
  const activityLines = activityList
    .map((a) => `- ${a.id}: ${a.name}`)
    .join("\n");
  const timerLine = runningTimer
    ? `A timer is running for "${runningTimer.activityName}" since ${runningTimer.startedAt}.`
    : "No timer is running.";
  return `You are Seneschal, the voice assistant inside a personal life-tracking app (time tracking in 15-minute slots, a live activity timer, expenses, an automated marketplace deal-finder). You receive one spoken request, transcribed to text. Fulfill it by calling tools, then reply with a short spoken-style answer.

Current time: ${now} (timezone: ${timezone})
${timerLine}

The user's time-tracking activities (id: name):
${activityLines}

Rules:
- Spoken activity names are fuzzy; match loosely (case, plurals, partial words, transcription errors) but never invent an id. If nothing plausibly matches, don't call the tool — say so and name the closest options.
- Resolve relative time expressions ("an hour ago", "this morning", "since lunch", "from now to an hour ago") against the current time. Timestamps are ISO-8601 with UTC offset, and start must be strictly before end even when spoken in reverse order.
- Ambiguous am/pm: prefer the most recent interpretation that already started. Bare times without a date mean today.
- Never call a destructive tool (clearing logged time) unless the request clearly asks for it.
- You may call several tools for one request, and use tool results to decide what to do next.
- If the request is ambiguous or fits no tool, call nothing and reply asking for clarification or explaining what you can do.
- Your final reply is spoken aloud: one or two short sentences, no markdown, no lists.`;
}

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  // Recorded speech can run a few hundred KB as base64 WAV; raise the body
  // limit for this route only (Fastify default is 1 MB).
  app.post(
    "/voice/command",
    { bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      const body = commandBody.parse(req.body);
      if (!llmConfigured()) {
        return reply.code(503).send({ error: "llm_not_configured" });
      }
      const userId = req.auth.userId;

      let messages: ChatMessage[];
      let transcript: string | undefined;

      if (body.messages && body.messages.length > 0) {
        // Continuation of a previous turn: append the client tool results.
        messages = body.messages as unknown as ChatMessage[];
        for (const r of body.toolResults ?? []) {
          messages.push({
            role: "tool",
            tool_call_id: r.toolCallId,
            content: r.result,
          });
        }
      } else {
        // Fresh turn: get a transcript, then build the conversation.
        if (body.audio) {
          try {
            const res = await llmTranscribe({
              data: body.audio.data,
              format: body.audio.format,
              language: "en",
              usage: { userId, purpose: "stt" },
            });
            transcript = res.text.trim();
          } catch (err) {
            req.log.error({ err }, "voice_transcribe_failed");
            return {
              transcript: "",
              speech: "I had trouble hearing that, try again.",
            };
          }
        } else {
          transcript = body.transcript?.trim();
        }
        if (!transcript) {
          return { transcript: "", speech: "I didn't hear anything." };
        }

        const rows = await db
          .select({ id: activities.id, name: activities.name })
          .from(activities)
          .where(
            and(
              eq(activities.userId, userId),
              eq(activities.isActive, true),
              isNull(activities.archivedAt),
              isNull(activities.deletedAt)
            )
          );

        messages = [
          {
            role: "system",
            content: systemPrompt(
              body.now,
              body.timezone,
              rows,
              body.runningTimer
                ? {
                    activityName: body.runningTimer.activityName,
                    startedAt: body.runningTimer.startedAt,
                  }
                : null
            ),
          },
          { role: "user", content: transcript },
        ];
      }

      const clientTools: ToolDef[] = body.toolCatalog.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execution: "client",
        requiresConfirmation: t.requiresConfirmation,
      }));

      let outcome;
      try {
        outcome = await runToolLoop({
          userId,
          messages,
          clientTools,
          serverTools: serverToolRegistry,
          chat: async ({ messages: msgs, tools }) => {
            const res = await llmChat({
              tier: "triage",
              messages: msgs,
              tools,
              maxTokens: 700,
              reasoning: { enabled: false },
              usage: { userId, purpose: "voice" },
            });
            return { content: res.content, toolCalls: res.toolCalls };
          },
        });
      } catch (err) {
        req.log.error({ err }, "voice_tool_loop_failed");
        return {
          transcript,
          speech: "I had trouble processing that, try again.",
        };
      }

      if (outcome.kind === "speech") {
        return { transcript, speech: outcome.speech };
      }
      return {
        transcript,
        toolCalls: outcome.calls.map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: c.function.arguments,
        })),
        messages: outcome.messages,
      };
    }
  );
};
