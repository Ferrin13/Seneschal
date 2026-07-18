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
import { getModelOverrides, pickModel } from "../../marketplace/modelSettings.js";
import {
  candidateTargetId,
  getNotificationPrefs,
  shouldNotify,
} from "../../marketplace/notificationSettings.js";
import {
  clampScore,
  dealScore,
  legacyVerdict,
  promiseScore,
} from "../../marketplace/scoring.js";
import { presignGet } from "../../marketplace/storage.js";
import type { RunMeta } from "../types.js";
import { logEvent } from "./util.js";

const PROMPT_VERSION = "advanced-v3";
const MAX_IMAGES = 6;

const SYSTEM = `You are an expert reseller evaluating a marketplace listing (Facebook or Craigslist) for the user.
You are given the user's targets/rules, the full listing (title, description, price, condition, seller, location, how long ago it was posted/updated), listing photos, and price comparables from an internet search and the user's own history. Comparables are split into USED/resale prices (what pre-owned units actually sell for) and NEW/retail prices (the brand-new price, an upper anchor). Judge the deal against the used/resale prices for a used item; a low price relative to used comps but far below new/retail signals a strong flip.
First estimate the item's fair resale/market value, then score two independent axes from 0 to 100:
- "valueScore": how good the asking price is versus fair market value. 85-100 = great steal, 65-84 = clearly below market, 40-64 = roughly fair, 0-39 = overpriced. Base this ONLY on price vs. value, not on relevance.
- "fitScore": how well the listing matches the user's target and rules. 85-100 = exact match, 40-64 = loosely related, 0-39 = wrong item or violates a stated rule.
Also give "confidence" (0.0-1.0): how sure you are of these scores given the available info.
Respond ONLY with JSON:
{"valueScore":0-100,"fitScore":0-100,"confidence":0.0-1.0,"estimatedValueCents":integer|null,"rationale":"2-3 sentences"}`;

type AdvancedResult = {
  valueScore?: number;
  fitScore?: number;
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

/**
 * Advanced-LLM evaluation of a single scraped listing + its comps. Writes an
 * `advanced` evaluation, updates the candidate's promise score, raises a deal
 * notification for good deals, and logs an `evaluated` event.
 */
export async function finalEvaluate(input: {
  meta: RunMeta;
  listingId: string;
  candidateId: string;
}): Promise<{
  verdict: string;
  valueScore: number | null;
  fitScore: number | null;
  confidence: number | null;
}> {
  const { meta, listingId, candidateId } = input;

  const [listing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.userId, meta.userId)))
    .limit(1);
  if (!listing)
    return { verdict: "unsure", valueScore: null, fitScore: null, confidence: null };

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

  const fmtComp = (c: (typeof compRows)[number]) =>
    `- ${c.source}: ${money(c.priceCents)} — ${c.matchedTitle ?? ""}${
      c.url ? ` (${c.url})` : ""
    }`;
  // Group comps by condition so the model sees resale (used) prices distinctly
  // from new/retail anchors. Comps without a condition (eBay/Craigslist/
  // internal history) are treated as used/resale.
  const usedComps = compRows.filter((c) => c.condition !== "new");
  const newComps = compRows.filter((c) => c.condition === "new");
  const compsText =
    compRows.length > 0
      ? [
          `Used / resale comps:\n${
            usedComps.length > 0
              ? usedComps.map(fmtComp).join("\n")
              : "(none found)"
          }`,
          `New / retail comps:\n${
            newComps.length > 0
              ? newComps.map(fmtComp).join("\n")
              : "(none found)"
          }`,
        ].join("\n\n")
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

  const overrides = await getModelOverrides(meta.userId);
  const { data, model: usedModel } = await llmJson<AdvancedResult>({
    tier: "advanced",
    model: pickModel("advanced", overrides, meta.model),
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
      runId: meta.runId,
    },
  });

  const fitScore = clampScore(data.fitScore);
  const confidence =
    typeof data.confidence === "number"
      ? Math.max(0, Math.min(1, data.confidence))
      : null;
  const estimatedValueCents =
    typeof data.estimatedValueCents === "number"
      ? Math.round(data.estimatedValueCents)
      : null;
  // Prefer a savings-based deal score (absolute dollars saved weighted over
  // percentage); fall back to the model's own valueScore when we lack an
  // estimate to compare the price against.
  const valueScore =
    dealScore(listing.priceCents, estimatedValueCents) ??
    clampScore(data.valueScore);
  const rationale = data.rationale ?? null;
  const verdict = legacyVerdict(valueScore);
  const promise = promiseScore(valueScore, fitScore);

  const [prefs, targetId] = await Promise.all([
    getNotificationPrefs(meta.userId),
    candidateTargetId(candidateId),
  ]);
  const isGoodDeal = shouldNotify(prefs, {
    valueScore,
    dealScore: promise,
    priceCents: listing.priceCents,
    targetId,
  });

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
        valueScore,
        fitScore,
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

    if (isGoodDeal) {
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

  await logEvent(
    meta,
    candidateId,
    "evaluated",
    `Value ${valueScore ?? "?"}/100 · fit ${fitScore ?? "?"}/100`,
    {
      valueScore,
      fitScore,
      verdict,
      confidence,
      estimatedValueCents,
      rationale,
      model: usedModel,
      compCount: compRows.length,
    }
  );

  return { verdict, valueScore, fitScore, confidence };
}
