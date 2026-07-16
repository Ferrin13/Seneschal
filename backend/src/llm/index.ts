import { config } from "../config.js";
import { db } from "../db/client.js";
import { llmCalls } from "../db/schema.js";

/**
 * All LLM traffic is routed through OpenRouter's OpenAI-compatible API, so any
 * model can be swapped in for evaluation via its OpenRouter slug. Two tiers
 * (`triage`, `advanced`) keep cheap, high-volume triage separate from the
 * expensive deep evaluation; the model for each comes from config but can be
 * overridden per request. Supports multimodal input (image URLs or inline
 * base64).
 *
 * Every call captures token usage and the USD cost OpenRouter reports and, when
 * a `usage` context is supplied, logs it to `mp_llm_calls` for cost accounting.
 * When `OPENROUTER_API_KEY` is unset, callers get a 503-flavored error.
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

/** Attribution for cost accounting; when present, the call is logged to DB. */
export type LlmUsageContext = {
  userId: string;
  purpose: "search_expansion" | "triage" | "comps" | "advanced" | "other";
  candidateId?: string | null;
  listingId?: string | null;
  targetId?: string | null;
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

/**
 * Run a completion through OpenRouter. `model` overrides the tier default so
 * callers can compare models. When `json` is true the model is asked to return
 * a single JSON object (callers should still parse defensively). If `usage`
 * context is provided, the call's cost/tokens are persisted to `mp_llm_calls`.
 */
export async function llmComplete(opts: {
  tier: LlmTier;
  messages: LlmMessage[];
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
  usage?: LlmUsageContext;
}): Promise<LlmResult> {
  if (!config.OPENROUTER_API_KEY) {
    throw serviceUnavailable("llm_not_configured");
  }
  const model = opts.model?.trim() || modelFor(opts.tier);
  const maxTokens = opts.maxTokens ?? 1024;

  const result = await openrouterComplete(
    model,
    opts.messages,
    maxTokens,
    opts.json ?? false,
    opts.tools,
    opts.reasoning
  );

  if (opts.usage) {
    await recordUsage(opts.usage, result).catch(() => {
      // Never let cost logging break the actual work.
    });
  }

  return result;
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
  maxTokens?: number;
  model?: string;
  tools?: unknown[];
  reasoning?: unknown;
  jsonMode?: boolean;
  usage?: LlmUsageContext;
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

async function recordUsage(
  ctx: LlmUsageContext,
  result: LlmResult
): Promise<void> {
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
    candidateId: ctx.candidateId ?? null,
    listingId: ctx.listingId ?? null,
    targetId: ctx.targetId ?? null,
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

async function openrouterComplete(
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  json: boolean,
  tools?: unknown[],
  reasoning?: unknown
): Promise<LlmResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
    "X-Title": config.OPENROUTER_APP_NAME,
  };
  if (config.OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = config.OPENROUTER_SITE_URL;
  }

  const res = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
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
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    text,
    // Prefer the resolved model OpenRouter reports (it may pin a variant).
    model: data.model ?? model,
    usage: {
      promptTokens: num(data.usage?.prompt_tokens),
      completionTokens: num(data.usage?.completion_tokens),
      totalTokens: num(data.usage?.total_tokens),
      costUsd: num(data.usage?.cost),
      requestId: data.id ?? null,
    },
  };
}
