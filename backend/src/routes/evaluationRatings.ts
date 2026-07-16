import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { candidates, evaluationRatings, evaluations } from "../db/schema.js";

function serialize(row: typeof evaluationRatings.$inferSelect) {
  return {
    id: row.id,
    candidateId: row.candidateId,
    evaluationId: row.evaluationId,
    fitAccuracy: row.fitAccuracy,
    fitNote: row.fitNote,
    valueAccuracy: row.valueAccuracy,
    valueNote: row.valueNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Optional 1-10 accuracy; `null` clears a previously-set score. Notes trim to
// null so empty strings don't persist.
const accuracy = z.number().int().min(1).max(10).nullable().optional();
const note = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => (s.length === 0 ? null : s))
  .nullable()
  .optional();

const ratingBody = z
  .object({
    fitAccuracy: accuracy,
    fitNote: note,
    valueAccuracy: accuracy,
    valueNote: note,
  })
  .refine(
    (b) =>
      b.fitAccuracy != null ||
      b.valueAccuracy != null ||
      b.fitNote != null ||
      b.valueNote != null,
    { message: "at least one rating field is required" }
  );

export const evaluationRatingRoutes: FastifyPluginAsync = async (app) => {
  /** The current user's rating for a candidate's evaluation, if any. */
  app.get(
    "/marketplace/candidates/:id/rating",
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const [row] = await db
        .select()
        .from(evaluationRatings)
        .where(
          and(
            eq(evaluationRatings.candidateId, id),
            eq(evaluationRatings.userId, req.auth.userId)
          )
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: "rating_not_found" });
      return serialize(row);
    }
  );

  /**
   * Upsert the user's accuracy rating for a candidate's analysis. One rating
   * per user + candidate; re-submitting overwrites the prior values. The rating
   * is pinned to the candidate's latest advanced evaluation for traceability.
   */
  app.put("/marketplace/candidates/:id/rating", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ratingBody.parse(req.body);

    // Ownership check — never let a user rate another user's candidate.
    const [candidate] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(eq(candidates.id, id), eq(candidates.userId, req.auth.userId))
      )
      .limit(1);
    if (!candidate) return reply.code(404).send({ error: "not_found" });

    const [latestAdvanced] = await db
      .select({ id: evaluations.id })
      .from(evaluations)
      .where(
        and(
          eq(evaluations.userId, req.auth.userId),
          eq(evaluations.candidateId, id),
          eq(evaluations.tier, "advanced")
        )
      )
      .orderBy(desc(evaluations.createdAt))
      .limit(1);

    const values = {
      fitAccuracy: body.fitAccuracy ?? null,
      fitNote: body.fitNote ?? null,
      valueAccuracy: body.valueAccuracy ?? null,
      valueNote: body.valueNote ?? null,
    };

    const [row] = await db
      .insert(evaluationRatings)
      .values({
        userId: req.auth.userId,
        candidateId: id,
        evaluationId: latestAdvanced?.id ?? null,
        ...values,
      })
      .onConflictDoUpdate({
        target: [evaluationRatings.userId, evaluationRatings.candidateId],
        set: {
          ...values,
          evaluationId: latestAdvanced?.id ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) return reply.code(500).send({ error: "rating_upsert_failed" });
    return serialize(row);
  });
};
