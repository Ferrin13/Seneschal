import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { groupMembers, groups } from "../db/schema.js";

const memberInput = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid().nullable().optional(),
  displayName: z.string().max(200).nullable().optional(),
  phoneNumber: z.string().max(64).nullable().optional(),
  contactLookupKey: z.string().max(512).nullable().optional(),
  clientUpdatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
});

const upsertBody = z.object({
  members: z.array(memberInput).max(500),
});

const querySchema = z.object({
  since: z.string().datetime().optional(),
  groupId: z.string().uuid().optional(),
});

function serialize(row: typeof groupMembers.$inferSelect) {
  return {
    id: row.id,
    groupId: row.groupId,
    displayName: row.displayName,
    phoneNumber: row.phoneNumber,
    contactLookupKey: row.contactLookupKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function assertGroupOwned(userId: string, groupId: string) {
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
    .limit(1);
  if (!g) {
    const err = new Error("group_not_found") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Members of a `groups` row. Kept as a separate top-level resource (rather
 * than nested under /groups/:id/members) so the Android sync layer can use
 * a single `since`-cursor pull and a single bulk PUT for all of a user's
 * members across all groups.
 */
export const groupMemberRoutes: FastifyPluginAsync = async (app) => {
  app.get("/group-members", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(groupMembers.userId, req.auth.userId)];
    if (q.since) {
      filters.push(gt(groupMembers.updatedAt, new Date(q.since)));
    }
    if (q.groupId) {
      filters.push(eq(groupMembers.groupId, q.groupId));
    }
    const rows = await db
      .select()
      .from(groupMembers)
      .where(and(...filters))
      .orderBy(groupMembers.createdAt);
    return rows.map(serialize);
  });

  app.put("/group-members", async (req) => {
    const body = upsertBody.parse(req.body);
    if (body.members.length === 0) return [];

    const userId = req.auth.userId;
    const results: Array<typeof groupMembers.$inferSelect> = [];

    // Validate group ownership up front. Skip delete-only payloads since
    // they may not carry a groupId.
    const groupIds = new Set(
      body.members
        .filter((m) => !m.deleted)
        .map((m) => m.groupId)
        .filter((g): g is string => !!g)
    );
    for (const id of groupIds) {
      await assertGroupOwned(userId, id);
    }

    await db.transaction(async (tx) => {
      for (const m of body.members) {
        const cua = new Date(m.clientUpdatedAt);

        if (m.deleted) {
          const [row] = await tx
            .update(groupMembers)
            .set({
              deletedAt: new Date(),
              clientUpdatedAt: cua,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(groupMembers.userId, userId),
                eq(groupMembers.id, m.id),
                sql`${groupMembers.clientUpdatedAt} < ${cua.toISOString()}`
              )
            )
            .returning();
          if (row) results.push(row);
          continue;
        }

        if (
          m.groupId == null ||
          m.displayName == null ||
          m.phoneNumber == null
        ) {
          continue;
        }

        const [row] = await tx
          .insert(groupMembers)
          .values({
            id: m.id,
            userId,
            groupId: m.groupId,
            displayName: m.displayName,
            phoneNumber: m.phoneNumber,
            contactLookupKey: m.contactLookupKey ?? null,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: groupMembers.id,
            set: {
              groupId: m.groupId,
              displayName: m.displayName,
              phoneNumber: m.phoneNumber,
              contactLookupKey: m.contactLookupKey ?? null,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${groupMembers.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) results.push(row);
      }
    });

    return results.map(serialize);
  });
};
