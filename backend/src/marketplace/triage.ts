import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { candidates, evaluations, searchTargets } from "../db/schema.js";
import { llmJson, type LlmImage } from "../llm/index.js";

/** Oldest pending, not-yet-triaged candidates for a user. */
async function pendingCandidates(userId: string, limit: number) {
  return db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.userId, userId),
        eq(candidates.triageStatus, "pending"),
        isNull(candidates.deletedAt)
      )
    )
    .orderBy(asc(candidates.createdAt))
    .limit(limit);
}

const PROMPT_VERSION = "triage-v1";

const SYSTEM = `You are a fast first-pass filter for a Facebook Marketplace deal finder.
You are given the user's shopping targets (with optional rules) and a single listing candidate (title, price, short blurb, and maybe a thumbnail).
Decide whether this candidate is worth a closer look.
Be lenient at this stage (cheap triage): only reject clear mismatches or items that violate an explicit rule.
Respond ONLY with JSON: {"promising": true|false, "score": 0-100, "reason": "one sentence", "matchedTarget": "target title or null"}`;

type TriageResult = {
  promising?: boolean;
  score?: number;
  reason?: string;
  matchedTarget?: string | null;
};

export type TriageRun = {
  evaluated: number;
  promising: number;
  rejected: number;
  errors: number;
};

function targetsBlock(
  rows: { title: string; prompt: string; evalInstructions: string | null }[]
): string {
  if (rows.length === 0) return "(no active targets)";
  return rows
    .map(
      (t, i) =>
        `${i + 1}. ${t.title}: ${t.prompt}${
          t.evalInstructions ? ` [rules: ${t.evalInstructions}]` : ""
        }`
    )
    .join("\n");
}

/**
 * Manual/legacy triage over pending candidates with the cheap LLM tier. Sets
 * triageStatus and persists a `triage`-tier evaluation per candidate. The
 * Temporal hunt workflow now drives triage end-to-end; this remains for the
 * manual UI trigger. Per-candidate errors are isolated so one bad row doesn't
 * abort the batch.
 */
export async function triagePending(
  userId: string,
  limit = 50,
  model?: string
): Promise<TriageRun> {
  const run: TriageRun = { evaluated: 0, promising: 0, rejected: 0, errors: 0 };

  const targets = await db
    .select({
      title: searchTargets.title,
      prompt: searchTargets.prompt,
      evalInstructions: searchTargets.evalInstructions,
    })
    .from(searchTargets)
    .where(
      and(
        eq(searchTargets.userId, userId),
        eq(searchTargets.isActive, true)
      )
    );
  const targetsText = targetsBlock(targets);

  const pending = await pendingCandidates(userId, limit);

  for (const c of pending) {
    try {
      const priceStr =
        c.priceCents != null ? `$${(c.priceCents / 100).toFixed(2)}` : "unknown";
      const userText = [
        `User targets:\n${targetsText}`,
        `\nCandidate:`,
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
        usage: { userId, purpose: "triage", candidateId: c.id },
      });

      const promising = data.promising === true;
      const score =
        typeof data.score === "number"
          ? Math.max(0, Math.min(100, Math.round(data.score)))
          : null;
      const reason = data.reason ?? null;

      await db.transaction(async (tx) => {
        await tx
          .update(candidates)
          .set({
            triageStatus: promising ? "promising" : "rejected",
            triageScore: score,
            triageReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(candidates.id, c.id));

        await tx.insert(evaluations).values({
          userId,
          candidateId: c.id,
          tier: "triage",
          model: usedModel,
          verdict: promising ? "unsure" : "pass",
          confidence: score != null ? score / 100 : null,
          rationale: reason,
          promptVersion: PROMPT_VERSION,
          raw: data as Record<string, unknown>,
        });
      });

      run.evaluated += 1;
      if (promising) run.promising += 1;
      else run.rejected += 1;
    } catch {
      // Leave as pending so a later run can retry transient failures.
      run.errors += 1;
    }
  }

  return run;
}
