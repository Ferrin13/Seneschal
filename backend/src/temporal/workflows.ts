import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type * as activities from "./activities/index.js";
import type {
  BrowserActivities,
  CandidateRef,
  RunMeta,
  SearchRef,
  VerifyRef,
  VerifyResult,
} from "./types.js";
import type { HarvestedItem } from "../marketplace/types.js";
import type { HuntTargetInput } from "./shared.js";
import { BROWSER_TASK_QUEUE } from "./constants.js";

// Server-side activities run on this worker's (default) task queue.
const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "3 minutes",
  retry: { maximumAttempts: 3 },
});

// LLM/comps activities can take longer and hit rate limits.
const slowActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

// Facebook load-and-parse runs on the browser box (logged-in Chrome over CDP).
const browser = proxyActivities<BrowserActivities>({
  taskQueue: BROWSER_TASK_QUEUE,
  startToCloseTimeout: "3 minutes",
  // Fewer attempts: a login wall won't fix itself within a run.
  retry: { maximumAttempts: 2 },
});

/** Detect the browser box's "logged out of Facebook" signal. */
function isLoggedOut(err: unknown): boolean {
  const e = err as { type?: string; message?: string; cause?: { type?: string } };
  return (
    e?.type === "logged_out" ||
    e?.cause?.type === "logged_out" ||
    String(e?.message ?? "").includes("logged_out")
  );
}

/** Harvest a single search's tiles, routing by platform to the right worker. */
async function harvest(search: SearchRef): Promise<HarvestedItem[]> {
  if (!search.searchUrl) return [];
  if (search.platform === "facebook") {
    return browser.fbHarvestSearch({ searchUrl: search.searchUrl });
  }
  return acts.craigslistHarvestSearch({ searchUrl: search.searchUrl });
}

/** Deep-scrape a promising candidate's PDP, routing by platform. */
async function deepScrape(candidate: CandidateRef) {
  if (candidate.platform === "facebook") {
    return browser.fbDeepScrape({ url: candidate.url });
  }
  return acts.craigslistDeepScrape({ url: candidate.url });
}

/** Re-fetch a vanished candidate's PDP to confirm it's gone, routing by platform. */
async function verifyGone(candidate: VerifyRef): Promise<VerifyResult> {
  if (candidate.platform === "facebook") {
    return browser.fbVerifyListing({ url: candidate.url });
  }
  return acts.verifyCraigslistGone({ url: candidate.url });
}

/**
 * Hunt one target: for each of its active searches, harvest a snapshot, triage
 * the tiles, deep-scrape + comp + evaluate the promising ones, then reconcile
 * which previously-seen listings have disappeared (likely sold). Each step is
 * fault-isolated so one bad listing/search never aborts the whole run.
 */
export async function huntTargetWorkflow(input: HuntTargetInput): Promise<{
  searches: number;
  discovered: number;
  promising: number;
  evaluated: number;
}> {
  const info = workflowInfo();
  const meta: RunMeta = {
    userId: input.userId,
    workflowId: info.workflowId,
    runId: info.runId,
    model: input.model,
  };

  const searches = await acts.getActiveSearches({
    userId: input.userId,
    targetId: input.targetId,
  });

  let discovered = 0;
  let promisingTotal = 0;
  let evaluated = 0;
  let skipFacebook = false;

  for (const search of searches) {
    if (search.platform === "facebook" && skipFacebook) continue;

    let items: HarvestedItem[] = [];
    try {
      items = await harvest(search);
    } catch (err) {
      if (isLoggedOut(err)) {
        // Facebook session is dead — flag it and skip remaining FB searches.
        skipFacebook = true;
        await acts.flagNeedsLogin({ meta });
      }
      continue;
    }

    const { candidates, seenKeys } = await acts.upsertHarvest({
      meta,
      searchId: search.id,
      items,
    });
    discovered += candidates.length;

    const { promisingIds } = await acts.triageCandidates({
      meta,
      candidateIds: candidates.map((c) => c.id),
    });
    promisingTotal += promisingIds.length;

    const promisingSet = new Set(promisingIds);
    const promising = candidates.filter((c) => promisingSet.has(c.id));

    for (const candidate of promising) {
      if (candidate.platform === "facebook" && skipFacebook) continue;
      try {
        const deep = await deepScrape(candidate);
        const { listingId } = await acts.upsertListing({
          meta,
          candidateId: candidate.id,
          deep,
        });
        await slowActs.gatherComps({
          meta,
          listingId,
          candidateId: candidate.id,
        });
        await slowActs.finalEvaluate({
          meta,
          listingId,
          candidateId: candidate.id,
        });
        evaluated += 1;
      } catch (err) {
        if (isLoggedOut(err)) {
          skipFacebook = true;
          await acts.flagNeedsLogin({ meta });
        }
        // One listing failing (scrape/LLM) shouldn't abort the run.
        continue;
      }
    }

    const { toVerify } = await acts.reconcileSeen({
      meta,
      searchId: search.id,
      seenKeys,
    });

    // Promising listings that vanished get a PDP re-check before we call them
    // sold; a still-live page just fell out of the snapshot and stays active.
    for (const cand of toVerify) {
      if (cand.platform === "facebook" && skipFacebook) continue;
      try {
        const result = await verifyGone(cand);
        await acts.finalizeDisappearance({ meta, candidate: cand, result });
      } catch (err) {
        if (isLoggedOut(err)) {
          skipFacebook = true;
          await acts.flagNeedsLogin({ meta });
        }
        // Couldn't verify (e.g. login wall) — leave active, retry next run.
        continue;
      }
    }
  }

  return {
    searches: searches.length,
    discovered,
    promising: promisingTotal,
    evaluated,
  };
}
