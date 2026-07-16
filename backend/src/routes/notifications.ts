import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";

function serialize(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    listingId: row.listingId,
    evaluationId: row.evaluationId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/notifications", async (req) => {
    const q = z
      .object({
        status: z
          .union([
            z.enum(["new", "seen", "actioned", "dismissed"]),
            z.array(z.enum(["new", "seen", "actioned", "dismissed"])),
          ])
          .optional(),
        limit: z.coerce.number().int().positive().max(200).default(100),
      })
      .parse(req.query);

    const filters = [eq(notifications.userId, req.auth.userId)];
    if (q.status) {
      const statuses = Array.isArray(q.status) ? q.status : [q.status];
      filters.push(inArray(notifications.status, statuses));
    }
    const rows = await db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(q.limit);
    return rows.map(serialize);
  });

  app.patch("/marketplace/notifications/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ status: z.enum(["new", "seen", "actioned", "dismissed"]) })
      .parse(req.body);
    const [row] = await db
      .update(notifications)
      .set({ status: body.status, updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, req.auth.userId)
        )
      )
      .returning();
    if (!row) return reply.code(404).send({ error: "notification_not_found" });
    return serialize(row);
  });
};
