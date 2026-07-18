import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  candidates,
  comps,
  evaluations,
  listingImages,
  listings,
  notifications,
  searchTargets,
  searches,
} from "../db/schema.js";
import { llmJson, type LlmImage } from "../llm/index.js";
import { getModelOverrides, pickModel } from "./modelSettings.js";
import {
  candidateTargetId,
  getNotificationPrefs,
  shouldNotify,
} from "./notificationSettings.js";
import { clampScore, dealScore, legacyVerdict, promiseScore } from "./scoring.js";
import { presignGet } from "./storage.js";

const PROMPT_VERSION = "advanced-v3";
const MAX_IMAGES = 6;

const SYSTEM = `You are an expert reseller evaluating a Facebook Marketplace listing for the user.
You are given the user's targets/rules, the full listing (title, description, price, condition, seller, location), listing photos, and any price comparables from other marketplaces or the user's own history.
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

export type EvaluateRun = {
  evaluated: number;
  goodDeals: number;
  errors: number;
};

async function targetContext(userId: string, candidateId: string | null) {
  // Prefer the specific target this candidate's search belongs to.
  if (candidateId) {
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
    if (row) {
      return `Target: ${row.title} — ${row.prompt}${
        row.evalInstructions ? ` [rules: ${row.evalInstructions}]` : ""
      }`;
    }
  }
  // Fall back to all active targets.
  const rows = await db
    .select({
      title: searchTargets.title,
      prompt: searchTargets.prompt,
      evalInstructions: searchTargets.evalInstructions,
    })
    .from(searchTargets)
    .where(
      and(eq(searchTargets.userId, userId), eq(searchTargets.isActive, true))
    );
  if (rows.length === 0) return "(no targets specified)";
  return rows
    .map(
      (t) =>
        `- ${t.title}: ${t.prompt}${
          t.evalInstructions ? ` [rules: ${t.evalInstructions}]` : ""
        }`
    )
    .join("\n");
}

function money(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "unknown";
}

/**
 * Run the advanced evaluator over scraped listings that don't yet have an
 * advanced-tier evaluation. Good deals create a `deal` notification.
 */
export async function evaluatePending(
  userId: string,
  limit = 20,
  model?: string
): Promise<EvaluateRun> {
  const run: EvaluateRun = { evaluated: 0, goodDeals: 0, errors: 0 };
  const chosenModel = pickModel(
    "advanced",
    await getModelOverrides(userId),
    model
  );
  const notifyPrefs = await getNotificationPrefs(userId);

  // Listing ids that already have an advanced evaluation.
  const done = await db
    .select({ listingId: evaluations.listingId })
    .from(evaluations)
    .where(
      and(eq(evaluations.userId, userId), eq(evaluations.tier, "advanced"))
    );
  const doneIds = done
    .map((d) => d.listingId)
    .filter((id): id is string => !!id);

  const pending = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.userId, userId),
        doneIds.length > 0 ? notInArray(listings.id, doneIds) : undefined
      )
    )
    .orderBy(desc(listings.scrapedAt))
    .limit(limit);

  for (const listing of pending) {
    try {
      const ctx = await targetContext(userId, listing.candidateId);

      const imgRows = await db
        .select()
        .from(listingImages)
        .where(eq(listingImages.listingId, listing.id))
        .orderBy(listingImages.sortOrder)
        .limit(MAX_IMAGES);

      const images: LlmImage[] = [];
      for (const img of imgRows) {
        // Prefer a presigned URL for our stored copy; fall back to source.
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
        .where(eq(comps.listingId, listing.id))
        .limit(20);
      const compsText =
        compRows.length > 0
          ? compRows
              .map(
                (c) =>
                  `- ${c.source}: ${money(c.priceCents)} — ${c.matchedTitle ?? ""}`
              )
              .join("\n")
          : "(no comparables available)";

      const userText = [
        `User targets/rules:\n${ctx}`,
        `\nListing:`,
        `Title: ${listing.title ?? "(none)"}`,
        `Asking price: ${money(listing.priceCents)}`,
        `Condition: ${listing.conditionLabel ?? "unknown"}`,
        `Location: ${listing.locationText ?? "unknown"}`,
        `Seller: ${listing.sellerName ?? "unknown"}${
          listing.sellerRatingAverage != null
            ? ` (rating ${listing.sellerRatingAverage})`
            : ""
        }`,
        `Description: ${(listing.description ?? "").slice(0, 1500)}`,
        `\nComparables:\n${compsText}`,
      ].join("\n");

      const { data, model: usedModel } = await llmJson<AdvancedResult>({
        tier: "advanced",
        model: chosenModel,
        messages: [
          { role: "system", text: SYSTEM },
          { role: "user", text: userText, images },
        ],
        maxTokens: 500,
        usage: {
          userId,
          purpose: "advanced",
          listingId: listing.id,
          candidateId: listing.candidateId,
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
      const isGoodDeal = shouldNotify(notifyPrefs, {
        valueScore,
        dealScore: promiseScore(valueScore, fitScore),
        priceCents: listing.priceCents,
        targetId: await candidateTargetId(listing.candidateId),
      });

      await db.transaction(async (tx) => {
        const [evalRow] = await tx
          .insert(evaluations)
          .values({
            userId,
            listingId: listing.id,
            candidateId: listing.candidateId,
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

        if (isGoodDeal) {
          await tx.insert(notifications).values({
            userId,
            listingId: listing.id,
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

      run.evaluated += 1;
      if (isGoodDeal) run.goodDeals += 1;
    } catch {
      run.errors += 1;
    }
  }

  return run;
}
