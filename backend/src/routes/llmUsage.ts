import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { llmCalls } from "../db/schema.js";

/**
 * LLM gateway reporting. Surfaces totals, per-model and per-purpose
 * breakdowns (cost, tokens, latency, error rate — for comparing OpenRouter
 * models), and the most recent calls. Every LLM call in the app is logged by
 * the gateway (src/llm/index.ts), so this covers all features, not just the
 * marketplace.
 */
export const llmUsageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/llm-usage", async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().positive().max(200).default(50) })
      .parse(req.query);
    const userId = req.auth.userId;

    const avgLatency = sql<number>`coalesce(round(avg(${llmCalls.latencyMs}))::int, 0)`;
    const p95Latency = sql<number>`coalesce(percentile_cont(0.95) within group (order by ${llmCalls.latencyMs})::int, 0)`;
    const errorCalls = sql<number>`count(*) filter (where ${llmCalls.status} <> 'ok')::int`;

    const [totals] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalCostUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${llmCalls.totalTokens}), 0)::int`,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        errorCalls,
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
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        errorCalls,
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
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        errorCalls,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId))
      .groupBy(llmCalls.purpose)
      .orderBy(desc(sql`coalesce(sum(${llmCalls.costUsd}), 0)`));

    // Cost/usage time series (ascending) for the cost-over-time charts. Daily
    // spans all history; hourly is bounded to the recent window to keep the
    // payload and chart density reasonable.
    const dayExpr = sql`date_trunc('day', ${llmCalls.createdAt})`;
    const daily = await db
      .select({
        date: sql<string>`to_char(${dayExpr}, 'YYYY-MM-DD')`,
        costUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${llmCalls.totalTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId))
      .groupBy(dayExpr)
      .orderBy(dayExpr);

    const hourExpr = sql`date_trunc('hour', ${llmCalls.createdAt})`;
    const hourly = await db
      .select({
        date: sql<string>`to_char(${hourExpr}, 'YYYY-MM-DD HH24:00')`,
        costUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${llmCalls.totalTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.userId, userId),
          sql`${llmCalls.createdAt} >= now() - interval '7 days'`
        )
      )
      .groupBy(hourExpr)
      .orderBy(hourExpr);

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
      avgLatencyMs: totals?.avgLatencyMs ?? 0,
      p95LatencyMs: totals?.p95LatencyMs ?? 0,
      errorCalls: totals?.errorCalls ?? 0,
      byModel: byModel.map((m) => ({
        model: m.model,
        calls: m.calls,
        costUsd: Number(m.costUsd),
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        avgLatencyMs: m.avgLatencyMs,
        p95LatencyMs: m.p95LatencyMs,
        errorCalls: m.errorCalls,
      })),
      byPurpose: byPurpose.map((p) => ({
        purpose: p.purpose,
        calls: p.calls,
        costUsd: Number(p.costUsd),
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        avgLatencyMs: p.avgLatencyMs,
        p95LatencyMs: p.p95LatencyMs,
        errorCalls: p.errorCalls,
      })),
      daily: daily.map((d) => ({
        date: d.date,
        costUsd: Number(d.costUsd),
        calls: d.calls,
        tokens: d.tokens,
      })),
      hourly: hourly.map((d) => ({
        date: d.date,
        costUsd: Number(d.costUsd),
        calls: d.calls,
        tokens: d.tokens,
      })),
      recent: recentRows.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        status: r.status,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
};
