import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";

/**
 * The LLM-backed steps of the deal pipeline a user can configure a model for.
 * Each maps to an OpenRouter model slug; unset steps fall back to the server's
 * tier defaults (see {@link defaultModels}).
 */
export const MODEL_STEPS = [
  "search_expansion",
  "triage",
  "comps",
  "advanced",
] as const;

export type ModelStep = (typeof MODEL_STEPS)[number];

export type ModelOverrides = Partial<Record<ModelStep, string>>;

export const MODEL_STEP_META: Record<
  ModelStep,
  { label: string; description: string }
> = {
  search_expansion: {
    label: "Search expansion",
    description:
      "Turns a natural-language target into concrete Facebook/Craigslist searches.",
  },
  triage: {
    label: "Triage",
    description:
      "Cheap first-pass filter over freshly harvested listings (title, price, thumbnail).",
  },
  comps: {
    label: "Comps & value research",
    description:
      "Web-search pass that gathers price comparables and a rough value estimate.",
  },
  advanced: {
    label: "Advanced evaluation",
    description:
      "Deep verdict on a fully scraped listing plus its comparables.",
  },
};

/** The server's default model for each step, derived from the tier config. */
export function defaultModels(): Record<ModelStep, string> {
  return {
    search_expansion: config.LLM_ADVANCED_MODEL,
    triage: config.LLM_TRIAGE_MODEL,
    comps: config.LLM_COMPS_MODEL,
    advanced: config.LLM_ADVANCED_MODEL,
  };
}

/** Keep only known steps with non-empty string values. */
export function sanitizeOverrides(raw: unknown): ModelOverrides {
  const out: ModelOverrides = {};
  if (raw && typeof raw === "object") {
    for (const step of MODEL_STEPS) {
      const v = (raw as Record<string, unknown>)[step];
      if (typeof v === "string" && v.trim()) out[step] = v.trim();
    }
  }
  return out;
}

/** A user's saved per-step model overrides (may be empty). */
export async function getModelOverrides(
  userId: string
): Promise<ModelOverrides> {
  const [row] = await db
    .select({ overrides: userSettings.modelOverrides })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return sanitizeOverrides(row?.overrides);
}

/**
 * Resolve the model to use for a step. An explicit per-run override (e.g. a
 * model-comparison request) wins, then the user's saved setting; returning
 * `undefined` lets the LLM layer apply its tier default.
 */
export function pickModel(
  step: ModelStep,
  overrides: ModelOverrides,
  runOverride?: string | null
): string | undefined {
  return runOverride?.trim() || overrides[step] || undefined;
}
