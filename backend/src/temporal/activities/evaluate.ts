import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  candidates,
  comps,
  evaluations,
  listingImages,
  listings,
  notifications,
  searchTargets,
  searches,
} from "../../db/schema.js";
import { llmJson, type LlmImage } from "../../llm/index.js";
import { presignGet } from "../../marketplace/storage.js";
import type { RunMeta } from "../types.js";
import { logEvent } from "./util.js";

const PROMPT_VERSION = "advanced-v2";
const MAX_IMAGES = 6;

const SYSTEM = `You are an expert reseller evaluating whether a marketplace listing (Facebook or Craigslist) is a genuinely good deal for the user.
You are given the user's targets/rules, the full listing (title, description, price, condition, seller, location, how long ago it was posted/updated), listing photos, and price comparables from an internet search and the user's own history.
Estimate the item's fair resale/market value, then decide.
Be decisive but honest: only call something a good deal when the asking price is clearly below fair value AND it fits the user's intent and rules.
Respond ONLY with JSON:
{"verdict":"good_deal"|"pass"|"unsure","confidence":0.0-1.0,"estimatedValueCents":integer|null,"rationale":"2-3 sentences"}`;

type AdvancedResult = {
  verdict?: "good_deal" | "pass" | "unsure";
  confidence?: number;
  estimatedValueCents?: number | null;
  rationale?: string;
};

function money(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "unknown";
}

function ageText(ts: Date | null): string {
  if (!ts) return "unknown";
  const days = Math.floor((Date.now() - ts.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function targetContext(candidateId: string | null): Promise<string> {
  if (!candidateId) return "(no target)";
  const [row] = await db
    .select({
      title: searchTargets.title,
      prompt: searchTargets.prompt,
      evalInstructions: searchTargets.evalInstructions,
    })
    .from(candidates)
    .innerJoin(searches, eq(candidates.searchId, searches.id))
    .innerJoin(searchTargets, eq(searches.targetId, searchTargets.id))
    .where(eq(candidates.id, candidateId))
    .limit(1);
  if (!row) return "(no target)";
  return `Target: ${row.title} — ${row.prompt}${
    row.evalInstructions ? ` [rules: ${row.evalInstructions}]` : ""
  }`;
}

/** Map a verdict + confidence into a 0-100 promise score for UI ranking. */
function promiseFromVerdict(
  verdict: string,
  confidence: number | null
): number {
  const base = verdict === "good_deal" ? 80 : verdict === "unsure" ? 50 : 15;
  const conf = confidence != null ? Math.round(confidence * 20) : 0;
  return Math.max(0, Math.min(100, base + conf));
}

/**
 * Advanced-LLM evaluation of a single scraped listing + its comps. Writes an
 * `advanced` evaluation, updates the candidate's promise score, raises a deal
 * notification for good deals, and logs an `evaluated` event.
 */
export async function finalEvaluate(input: {
  meta: RunMeta;
  listingId: string;
  candidateId: string;
}): Promise<{ verdict: string; confidence: number | null }> {
  const { meta, listingId, candidateId } = input;

  const [listing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.userId, meta.userId)))
    .limit(1);
  if (!listing) return { verdict: "unsure", confidence: null };

  const ctx = await targetContext(candidateId);

  const imgRows = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(listingImages.sortOrder)
    .limit(MAX_IMAGES);

  const images: LlmImage[] = [];
  for (const img of imgRows) {
    const url = img.imageKey
      ? await presignGet(img.imageKey).catch(() => null)
      : null;
    const final = url ?? img.sourceUrl;
    if (final && final.startsWith("http")) {
      images.push({ kind: "url", url: final });
    }
  }

  const compRows = await db
    .select()
    .from(comps)
    .where(eq(comps.listingId, listingId))
    .limit(25);
  const compsText =
    compRows.length > 0
      ? compRows
          .map(
            (c) =>
              `- ${c.source}: ${money(c.priceCents)} — ${c.matchedTitle ?? ""}${
                c.url ? ` (${c.url})` : ""
              }`
          )
          .join("\n")
      : "(no comparables available)";

  const userText = [
    `User targets/rules:\n${ctx}`,
    `\nListing (${listing.platform}):`,
    `Title: ${listing.title ?? "(none)"}`,
    `Asking price: ${money(listing.priceCents)}`,
    `Condition: ${listing.conditionLabel ?? "unknown"}`,
    `Location: ${listing.locationText ?? "unknown"}`,
    `Posted: ${ageText(listing.listedAt)}; Updated: ${ageText(
      listing.sourceUpdatedAt
    )}`,
    `Seller: ${listing.sellerName ?? "unknown"}`,
    `Description: ${(listing.description ?? "").slice(0, 1500)}`,
    `\nComparables:\n${compsText}`,
  ].join("\n");

  const { data, model: usedModel } = await llmJson<AdvancedResult>({
    tier: "advanced",
    model: meta.model,
    messages: [
      { role: "system", text: SYSTEM },
      { role: "user", text: userText, images },
    ],
    maxTokens: 500,
    usage: {
      userId: meta.userId,
      purpose: "advanced",
      listingId,
      candidateId,
    },
  });

  const verdict = data.verdict ?? "unsure";
  const confidence =
    typeof data.confidence === "number"
      ? Math.max(0, Math.min(1, data.confidence))
      : null;
  const estimatedValueCents =
    typeof data.estimatedValueCents === "number"
      ? Math.round(data.estimatedValueCents)
      : null;
  const rationale = data.rationale ?? null;
  const promise = promiseFromVerdict(verdict, confidence);

  await db.transaction(async (tx) => {
    const [evalRow] = await tx
      .insert(evaluations)
      .values({
        userId: meta.userId,
        listingId,
        candidateId,
        tier: "advanced",
        model: usedModel,
        verdict,
        confidence,
        estimatedValueCents,
        rationale,
        promptVersion: PROMPT_VERSION,
        raw: data as Record<string, unknown>,
      })
      .returning({ id: evaluations.id });

    await tx
      .update(candidates)
      .set({ promiseScore: promise, updatedAt: new Date() })
      .where(eq(candidates.id, candidateId));

    if (verdict === "good_deal") {
      await tx.insert(notifications).values({
        userId: meta.userId,
        listingId,
        evaluationId: evalRow!.id,
        kind: "deal",
        title: listing.title ?? "Potential deal",
        body: `${money(listing.priceCents)}${
          estimatedValueCents != null
            ? ` (est. value ${money(estimatedValueCents)})`
            : ""
        } — ${rationale ?? ""}`.slice(0, 1000),
      });
    }
  });

  await logEvent(meta, candidateId, "evaluated", `Verdict: ${verdict}`, {
    verdict,
    confidence,
    estimatedValueCents,
    model: usedModel,
    compCount: compRows.length,
  });

  return { verdict, confidence };
}
