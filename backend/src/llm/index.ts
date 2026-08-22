import { config } from "../config.js";
import { db } from "../db/client.js";
import { llmCalls } from "../db/schema.js";

/**
 * The LLM gateway: every model call in the application — plain completions,
 * function-calling chat, speech-to-text — flows through this module and is
 * instrumented uniformly. Each call records provider, model, purpose, token
 * usage, USD cost, wall-clock latency, and success/failure to `mp_llm_calls`
 * (reported by GET /marketplace/llm-usage). The usage context is a required
 * argument so new features can't silently skip accounting; failed provider
 * calls are logged too (status "error") before the error propagates.
 *
 * Transport is OpenRouter's OpenAI-compatible API, so any model can be
 * swapped in via its OpenRouter slug. Two tiers (`triage`, `advanced`) keep
 * cheap, high-volume work separate from expensive deep evaluation; the model
 * for each comes from config but can be overridden per request. Supports
 * multimodal input (image URLs or inline base64). When `OPENROUTER_API_KEY`
 * is unset, callers get a 503-flavored error.
 */

export type LlmTier = "triage" | "advanced";

export type LlmImage =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string; mimeType: string };

export type LlmMessage = {
  role: "system" | "user";
  text: string;
  images?: LlmImage[];
};

export type LlmUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  requestId: string | null;
};

/** Attribution for the gateway's per-call accounting row. */
export type LlmUsageContext = {
  userId: string;
  purpose:
    | "search_expansion"
    | "triage"
    | "comps"
    | "advanced"
    | "voice"
    | "stt"
    | "other";
  candidateId?: string | null;
  listingId?: string | null;
  targetId?: string | null;
  /** Temporal run id when the call originates from a hunt run. */
  runId?: string | null;
};

export type LlmResult = { text: string; model: string; usage: LlmUsage };

function serviceUnavailable(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 503;
  return err;
}

export function llmConfigured(): boolean {
  return !!config.OPENROUTER_API_KEY;
}

function modelFor(tier: LlmTier): string {
  return tier === "triage"
    ? config.LLM_TRIAGE_MODEL
    : config.LLM_ADVANCED_MODEL;
}

// ----- Gateway ------------------------------------------------------------

/**
 * Wraps one provider call: measures latency, records the accounting row
 * (success or failure), and passes the value through. `requestedModel` is
 * what gets logged when the call fails before the provider reports the
 * resolved model.
 */
async function throughGateway<T>(
  ctx: LlmUsageContext,
  requestedModel: string,
  exec: () => Promise<{ value: T; accounting: LlmResult }>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const { value, accounting } = await exec();
    await recordCall(ctx, accounting, Date.now() - startedAt, null);
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCall(
      ctx,
      { text: "", model: requestedModel, usage: emptyUsage() },
      Date.now() - startedAt,
      message
    );
    throw err;
  }
}

function emptyUsage(): LlmUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    costUsd: null,
    requestId: null,
  };
}

async function recordCall(
  ctx: LlmUsageContext,
  result: LlmResult,
  latencyMs: number,
  errorMessage: string | null
): Promise<void> {
  try {
    await db.insert(llmCalls).values({
      userId: ctx.userId,
      purpose: ctx.purpose,
      provider: "openrouter",
      model: result.model,
      requestId: result.usage.requestId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: result.usage.costUsd,
      latencyMs,
      status: errorMessage == null ? "ok" : "error",
      errorMessage: errorMessage?.slice(0, 500) ?? null,
      candidateId: ctx.candidateId ?? null,
      listingId: ctx.listingId ?? null,
      targetId: ctx.targetId ?? null,
      runId: ctx.runId ?? null,
    });
  } catch {
    // Never let accounting break the actual work.
  }
}

// ----- Public entry points ------------------------------------------------

/**
 * Run a completion through the gateway. `model` overrides the tier default
 * so callers can compare models. When `json` is true the model is asked to
 * return a single JSON object (callers should still parse defensively).
 */
export async function llmComplete(opts: {
  tier: LlmTier;
  messages: LlmMessage[];
  usage: LlmUsageContext;
  json?: boolean;
  maxTokens?: number;
  model?: string;
  /** OpenRouter server tools (e.g. [{ type: "openrouter:web_search" }]). */
  tools?: unknown[];
  /**
   * OpenRouter `reasoning` control (e.g. `{ enabled: false }` to turn thinking
   * off for structured-extraction tasks so it doesn't eat the token budget).
   */
  reasoning?: unknown;
}): Promise<LlmResult> {
  if (!config.OPENROUTER_API_KEY) {
    throw serviceUnavailable("llm_not_configured");
  }
  const model = opts.model?.trim() || modelFor(opts.tier);
  return throughGateway(opts.usage, model, async () => {
    const result = await openrouterComplete(
      model,
      opts.messages,
      opts.maxTokens ?? 1024,
      opts.json ?? false,
      opts.tools,
      opts.reasoning
    );
    return { value: result, accounting: result };
  });
}

/**
 * Convenience: complete and JSON.parse the result. Uses JSON response-format
 * mode by default; pass `jsonMode: false` to disable it (required alongside
 * server tools like `openrouter:web_search`, which some providers reject in
 * JSON mode). Parsing stays defensive either way.
 */
export async function llmJson<T>(opts: {
  tier: LlmTier;
  messages: LlmMessage[];
  usage: LlmUsageContext;
  maxTokens?: number;
  model?: string;
  tools?: unknown[];
  reasoning?: unknown;
  jsonMode?: boolean;
}): Promise<{ data: T; model: string; raw: string; usage: LlmUsage }> {
  const res = await llmComplete({ ...opts, json: opts.jsonMode ?? true });
  const raw = res.text.trim();
  // Providers sometimes wrap JSON in markdown fences; strip them.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let data: T;
  try {
    data = JSON.parse(cleaned) as T;
  } catch {
    // Last resort: grab the outermost JSON object.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`llm_invalid_json: ${raw.slice(0, 200)}`);
    data = JSON.parse(m[0]) as T;
  }
  return { data, model: res.model, raw, usage: res.usage };
}

// ----- Function-calling chat --------------------------------------------
//
// `llmChat` works with raw OpenAI-style messages (unlike `llmComplete`'s
// simplified LlmMessage) because tool loops need assistant messages carrying
// `tool_calls` and `tool` result messages — and because the voice pipeline
// echoes the running message array to the phone between turns, so the wire
// format and the model format should be the same thing.

export type ChatToolDef = {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON schema for the arguments object. */
    parameters?: unknown;
  };
};

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function llmChat(opts: {
  tier: LlmTier;
  messages: ChatMessage[];
  usage: LlmUsageContext;
  tools?: ChatToolDef[];
  maxTokens?: number;
  model?: string;
  reasoning?: unknown;
}): Promise<{
  content: string | null;
  toolCalls: ChatToolCall[];
  model: string;
  usage: LlmUsage;
}> {
  if (!config.OPENROUTER_API_KEY) {
    throw serviceUnavailable("llm_not_configured");
  }
  const model = opts.model?.trim() || modelFor(opts.tier);
  return throughGateway(opts.usage, model, async () => {
    const { content, toolCalls, result } = await openrouterChat(
      model,
      opts.messages,
      opts.tools,
      opts.maxTokens ?? 1024,
      opts.reasoning
    );
    return {
      value: { content, toolCalls, model: result.model, usage: result.usage },
      accounting: result,
    };
  });
}

/**
 * Speech-to-text via OpenRouter's /audio/transcriptions endpoint. Takes raw
 * base64 audio (no data-URI prefix) and returns the transcript.
 */
export async function llmTranscribe(opts: {
  data: string;
  format: "wav" | "mp3" | "flac" | "m4a" | "ogg" | "webm" | "aac";
  usage: LlmUsageContext;
  language?: string;
  model?: string;
}): Promise<{ text: string; model: string }> {
  if (!config.OPENROUTER_API_KEY) {
    throw serviceUnavailable("llm_not_configured");
  }
  const model = opts.model?.trim() || config.LLM_STT_MODEL;
  return throughGateway(opts.usage, model, async () => {
    const result = await openrouterTranscribe(
      model,
      opts.data,
      opts.format,
      opts.language
    );
    return {
      value: { text: result.text, model: result.model },
      accounting: result,
    };
  });
}

// ----- OpenRouter (OpenAI-compatible) -----------------------------------

type OaiContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function content(m: LlmMessage): string | OaiContent[] {
  if (!m.images || m.images.length === 0) return m.text;
  const parts: OaiContent[] = [{ type: "text", text: m.text }];
  for (const img of m.images) {
    const url =
      img.kind === "url" ? img.url : `data:${img.mimeType};base64,${img.data}`;
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function openrouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "X-Title": config.OPENROUTER_APP_NAME,
  };
  if (config.OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = config.OPENROUTER_SITE_URL;
  }
  return headers;
}

type OaiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

function toLlmUsage(id: string | undefined, usage: OaiUsage | undefined): LlmUsage {
  return {
    promptTokens: num(usage?.prompt_tokens),
    completionTokens: num(usage?.completion_tokens),
    totalTokens: num(usage?.total_tokens),
    costUsd: num(usage?.cost),
    requestId: id ?? null,
  };
}

async function openrouterComplete(
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  json: boolean,
  tools?: unknown[],
  reasoning?: unknown
): Promise<LlmResult> {
  const res = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Ask OpenRouter to return cost + token accounting in the response.
      usage: { include: true },
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      messages: messages.map((m) => ({ role: m.role, content: content(m) })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `llm_openrouter_error ${res.status}: ${body.slice(0, 300)}`
    );
  }
  const data = (await res.json()) as {
    id?: string;
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: OaiUsage;
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    // Prefer the resolved model OpenRouter reports (it may pin a variant).
    model: data.model ?? model,
    usage: toLlmUsage(data.id, data.usage),
  };
}

async function openrouterChat(
  model: string,
  messages: ChatMessage[],
  tools: ChatToolDef[] | undefined,
  maxTokens: number,
  reasoning?: unknown
): Promise<{
  content: string | null;
  toolCalls: ChatToolCall[];
  result: LlmResult;
}> {
  const res = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      usage: { include: true },
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`llm_openrouter_error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    id?: string;
    model?: string;
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
    usage?: OaiUsage;
  };
  const message = data.choices?.[0]?.message;
  const toolCalls: ChatToolCall[] = (message?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: c.id ?? `call_${i}`,
      type: "function",
      function: {
        name: c.function!.name!,
        arguments: c.function!.arguments ?? "{}",
      },
    }));
  return {
    content: message?.content ?? null,
    toolCalls,
    result: {
      text: message?.content ?? "",
      model: data.model ?? model,
      usage: toLlmUsage(data.id, data.usage),
    },
  };
}

async function openrouterTranscribe(
  model: string,
  audioBase64: string,
  format: string,
  language?: string
): Promise<LlmResult> {
  const res = await fetch(
    `${config.OPENROUTER_BASE_URL}/audio/transcriptions`,
    {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({
        model,
        input_audio: { data: audioBase64, format },
        ...(language ? { language } : {}),
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`llm_stt_error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    text?: string;
    model?: string;
    id?: string;
    usage?: OaiUsage;
  };
  return {
    text: data.text ?? "",
    model: data.model ?? model,
    usage: toLlmUsage(data.id, data.usage),
  };
}
