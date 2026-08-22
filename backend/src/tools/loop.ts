import type { ChatMessage, ChatToolCall } from "../llm/index.js";
import { toChatTool, type ServerTool, type ToolDef } from "./types.js";

/**
 * The single LLM function-calling turn driver for the hybrid tool
 * architecture. Server tools are executed inline and the loop continues;
 * the first batch containing client tools is returned to the caller (the
 * /voice/command route hands it to the phone, which executes and posts the
 * results back — the route then re-enters this loop with the appended
 * messages). No content, no tool calls ends the loop with spoken text.
 *
 * The chat function is injected so the loop is unit-testable without a
 * network or database.
 */

export type ToolLoopChat = (opts: {
  messages: ChatMessage[];
  tools: ReturnType<typeof toChatTool>[];
}) => Promise<{ content: string | null; toolCalls: ChatToolCall[] }>;

export type ToolLoopOutcome =
  | { kind: "speech"; speech: string; messages: ChatMessage[] }
  | { kind: "client_calls"; calls: ChatToolCall[]; messages: ChatMessage[] };

const DEFAULT_MAX_TURNS = 4;

export async function runToolLoop(opts: {
  userId: string;
  /** Conversation so far; not mutated — the outcome carries the new array. */
  messages: ChatMessage[];
  clientTools: ToolDef[];
  serverTools: ServerTool[];
  chat: ToolLoopChat;
  /** Max LLM turns in this invocation (each client-call batch re-enters). */
  maxTurns?: number;
}): Promise<ToolLoopOutcome> {
  const tools = [...opts.clientTools, ...opts.serverTools].map(toChatTool);
  const serverByName = new Map(opts.serverTools.map((t) => [t.name, t]));
  const clientNames = new Set(opts.clientTools.map((t) => t.name));
  const messages = [...opts.messages];
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await opts.chat({ messages, tools });

    if (res.toolCalls.length === 0) {
      const speech = res.content?.trim() || "Done.";
      messages.push({ role: "assistant", content: speech });
      return { kind: "speech", speech, messages };
    }

    messages.push({
      role: "assistant",
      content: res.content,
      tool_calls: res.toolCalls,
    });

    const clientCalls: ChatToolCall[] = [];
    for (const call of res.toolCalls) {
      const name = call.function.name;
      const serverTool = serverByName.get(name);
      if (serverTool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: await runServerTool(serverTool, opts.userId, call),
        });
      } else if (clientNames.has(name)) {
        clientCalls.push(call);
      } else {
        // Hallucinated tool: tell the model instead of failing the request.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error: unknown tool "${name}".`,
        });
      }
    }

    if (clientCalls.length > 0) {
      return { kind: "client_calls", calls: clientCalls, messages };
    }
    // All calls were handled here; give the model the results and go again.
  }

  return {
    kind: "speech",
    speech: "Sorry, that took too many steps. Try a simpler request.",
    messages,
  };
}

async function runServerTool(
  tool: ServerTool,
  userId: string,
  call: ChatToolCall
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    return "Error: tool arguments were not valid JSON.";
  }
  try {
    const result = await tool.handler(userId, args);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
