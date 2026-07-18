import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { candidates, evaluations, searchTargets, searches } from "../../db/schema.js";
import { llmJson, type LlmImage } from "../../llm/index.js";
import { getModelOverrides, pickModel } from "../../marketplace/modelSettings.js";
import type { RunMeta } from "../types.js";
import { isFrozenDisposition } from "./search.js";
import { logEvent } from "./util.js";

const PROMPT_VERSION = "triage-v3";

const SYSTEM = `You are a fast first-pass filter for a multi-marketplace deal finder.
You are given the ONE shopping target the user is hunting for (with optional rules) and a single listing candidate (title, price, short blurb, maybe a thumbnail).
Decide whether this candidate plausibly matches that target and is worth a closer look.
Be lenient at this stage (cheap triage): only reject clear mismatches or items that violate an explicit rule.
Respond ONLY with JSON: {"promising": true|false, "score": 0-100, "reason": "one sentence"}`;

type TriageResult = {
  promising?: boolean;
  score?: number;
  reason?: string;
};

/** The single target a candidate is being judged against, or a generic fallback. */
function targetText(
  t: { title: string; prompt: string; evalInstructions: string | null } | null
): string {
  if (!t) {
    return "(no specific target — judge whether this looks like a genuinely good resale deal)";
  }
  return `${t.title}: ${t.prompt}${
    t.evalInstructions ? ` [rules: ${t.evalInstructions}]` : ""
  }`;
}

/**
 * Cheap-LLM triage over a specific set of candidates (this run's harvest).
 * Sets triageStatus/triageScore/promiseScore, records a `triage`-tier
 * evaluation, and logs a `triaged` event. Returns the promising candidate ids
 * plus `changedIds` — those whose triage verdict/score differs from the prior
 * run — so the workflow can skip re-running deep analysis when nothing changed.
 */
export async function triageCandidates(input: {
  meta: RunMeta;
  candidateIds: string[];
}): Promise<{ promisingIds: string[]; changedIds: string[] }> {
  const { meta, candidateIds } = input;
  if (candidateIds.length === 0) return { promisingIds: [], changedIds: [] };

  const overrides = await getModelOverrides(meta.userId);
  const model = pickModel("triage", overrides, meta.model);

  // Judge each candidate against the specific target its search belongs to
  // (not the set of globally-active targets). This keeps triage correct for
  // paused targets and stops unrelated targets from causing false rejections.
  const rows = await db
    .select({
      candidate: candidates,
      targetTitle: searchTargets.title,
      targetPrompt: searchTargets.prompt,
      targetEval: searchTargets.evalInstructions,
    })
    .from(candidates)
    .leftJoin(searches, eq(candidates.searchId, searches.id))
    .leftJoin(searchTargets, eq(searches.targetId, searchTargets.id))
    .where(
      and(
        eq(candidates.userId, meta.userId),
        inArray(candidates.id, candidateIds)
      )
    );

  const promisingIds: string[] = [];
  const changedIds: string[] = [];

  for (const row of rows) {
    const c = row.candidate;
    // Skip candidates the user has dispositioned as done.
    if (isFrozenDisposition(c.disposition)) continue;
    const prevStatus = c.triageStatus;
    const prevScore = c.triageScore;
    try {
      const priceStr =
        c.priceCents != null
          ? `$${(c.priceCents / 100).toFixed(2)}`
          : "unknown";
      const target = row.targetTitle
        ? {
            title: row.targetTitle,
            prompt: row.targetPrompt ?? "",
            evalInstructions: row.targetEval,
          }
        : null;
      const userText = [
        `User's target:\n${targetText(target)}`,
        `\nCandidate (${c.platform}):`,
        `Title: ${c.title ?? "(none)"}`,
        `Price: ${priceStr}`,
        `Details: ${c.blurb ?? "(none)"}`,
      ].join("\n");

      const images: LlmImage[] =
        c.thumbnailUrl && c.thumbnailUrl.startsWith("http")
          ? [{ kind: "url", url: c.thumbnailUrl }]
          : [];

      const { data, model: usedModel } = await llmJson<TriageResult>({
        tier: "triage",
        model,
        messages: [
          { role: "system", text: SYSTEM },
          { role: "user", text: userText, images },
        ],
        maxTokens: 200,
        usage: {
          userId: meta.userId,
          purpose: "triage",
          candidateId: c.id,
          runId: meta.runId,
        },
      });

      const promising = data.promising === true;
      const score =
        typeof data.score === "number"
          ? Math.max(0, Math.min(100, Math.round(data.score)))
          : null;
      const reason = data.reason ?? null;

      const newStatus = promising ? "promising" : "rejected";
      const changed = prevStatus !== newStatus || prevScore !== score;
      if (changed) changedIds.push(c.id);

      await db.transaction(async (tx) => {
        await tx
          .update(candidates)
          .set({
            triageStatus: newStatus,
            triageScore: score,
            triageReason: reason,
            promiseScore: score,
            updatedAt: new Date(),
          })
          .where(eq(candidates.id, c.id));

        await tx.insert(evaluations).values({
          userId: meta.userId,
          candidateId: c.id,
          tier: "triage",
          model: usedModel,
          verdict: promising ? "unsure" : "pass",
          fitScore: score,
          confidence: score != null ? score / 100 : null,
          rationale: reason,
          promptVersion: PROMPT_VERSION,
          raw: data as Record<string, unknown>,
        });
      });

      await logEvent(
        meta,
        c.id,
        "triaged",
        promising ? "Promising — worth a closer look" : "Rejected in triage",
        { promising, score, reason, model: usedModel }
      );

      if (promising) promisingIds.push(c.id);
    } catch (err) {
      await logEvent(meta, c.id, "error", "Triage failed", {
        error: String(err),
      });
    }
  }

  return { promisingIds, changedIds };
}
