import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { candidates } from "../db/schema.js";
import type { ServerTool } from "./types.js";

/**
 * First server-hosted tool pack: read-only marketplace deal-finder queries.
 * Proves the hybrid path — the LLM can mix these with client tools in one
 * conversation ("stop my timer and tell me if there are any new deals").
 */

const dealsSummary: ServerTool = {
  name: "marketplace_deals_summary",
  description:
    "List the most promising recent marketplace deal candidates the " +
    "automated deal-finder has found for the user, best first. Read-only. " +
    "Use when the user asks about deals, finds, or marketplace results.",
  parameters: {
    type: "object",
    properties: {
      days: {
        type: "integer",
        description: "Lookback window in days (1-30, default 3).",
      },
    },
    required: [],
  },
  execution: "server",
  handler: async (userId, args) => {
    const daysRaw = typeof args.days === "number" ? Math.round(args.days) : 3;
    const days = Math.min(30, Math.max(1, daysRaw));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        title: candidates.title,
        priceCents: candidates.priceCents,
        promiseScore: candidates.promiseScore,
        triageStatus: candidates.triageStatus,
        firstSeenAt: candidates.firstSeenAt,
      })
      .from(candidates)
      .where(
        and(
          eq(candidates.userId, userId),
          isNull(candidates.deletedAt),
          eq(candidates.status, "active"),
          eq(candidates.disposition, "none"),
          gte(candidates.firstSeenAt, since)
        )
      )
      .orderBy(sql`${candidates.promiseScore} DESC NULLS LAST`)
      .limit(8);
    return {
      lookbackDays: days,
      count: rows.length,
      deals: rows.map((r) => ({
        title: r.title ?? "(untitled listing)",
        price: r.priceCents != null ? `$${(r.priceCents / 100).toFixed(0)}` : null,
        promiseScore: r.promiseScore,
        triageStatus: r.triageStatus,
        firstSeen: r.firstSeenAt.toISOString(),
      })),
    };
  },
};

export const marketplaceTools: ServerTool[] = [dealsSummary];
