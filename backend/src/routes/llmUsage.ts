import type { FastifyPluginAsync } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { llmCalls } from "../db/schema.js";

/**
 * LLM cost accounting. Surfaces totals, per-model and per-purpose breakdowns
 * (for comparing OpenRouter models), and the most recent calls.
 */
export const llmUsageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/llm-usage", async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().positive().max(200).default(50) })
      .parse(req.query);
    const userId = req.auth.userId;

    const [totals] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalCostUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${llmCalls.totalTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId));

    const byModel = await db
      .select({
        model: llmCalls.model,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${llmCalls.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${llmCalls.completionTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId))
      .groupBy(llmCalls.model)
      .orderBy(desc(sql`coalesce(sum(${llmCalls.costUsd}), 0)`));

    const byPurpose = await db
      .select({
        purpose: llmCalls.purpose,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${llmCalls.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${llmCalls.completionTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId))
      .groupBy(llmCalls.purpose)
      .orderBy(desc(sql`coalesce(sum(${llmCalls.costUsd}), 0)`));

    const recentRows = await db
      .select()
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId))
      .orderBy(desc(llmCalls.createdAt))
      .limit(q.limit);

    return {
      totalCalls: totals?.totalCalls ?? 0,
      totalCostUsd: Number(totals?.totalCostUsd ?? 0),
      totalTokens: totals?.totalTokens ?? 0,
      byModel: byModel.map((m) => ({
        model: m.model,
        calls: m.calls,
        costUsd: Number(m.costUsd),
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
      })),
      byPurpose: byPurpose.map((p) => ({
        purpose: p.purpose,
        calls: p.calls,
        costUsd: Number(p.costUsd),
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
      })),
      recent: recentRows.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
};
