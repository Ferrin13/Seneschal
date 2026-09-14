import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { pushDevices } from "../db/schema.js";

function serialize(row: typeof pushDevices.$inferSelect) {
  return {
    id: row.id,
    platform: row.platform,
    deviceName: row.deviceName,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

const registerBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["android"]).default("android"),
  deviceName: z.string().trim().min(1).max(120).nullish(),
});

/**
 * Push-device registry for the signed-in account. Lives under `/me` so any
 * account may register a phone regardless of features; what actually gets
 * pushed is decided per product server-side (see `push/deals.ts`).
 *
 * The Android app calls `POST /me/devices` on every sync with its current
 * FCM token (cheap upsert that also bumps `last_seen_at`) and
 * `POST /me/devices/unregister` right before signing out.
 */
export const pushDeviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me/devices", async (req) => {
    const rows = await db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.userId, req.auth.userId))
      .orderBy(desc(pushDevices.lastSeenAt));
    return rows.map(serialize);
  });

  app.post("/me/devices", async (req) => {
    const body = registerBody.parse(req.body);
    const now = new Date();
    const [row] = await db
      .insert(pushDevices)
      .values({
        userId: req.auth.userId,
        token: body.token,
        platform: body.platform,
        deviceName: body.deviceName ?? null,
        lastSeenAt: now,
      })
      // A token identifies one app install. If another account signs in on
      // the same phone, the row follows the new account.
      .onConflictDoUpdate({
        target: pushDevices.token,
        set: {
          userId: req.auth.userId,
          platform: body.platform,
          deviceName: body.deviceName ?? null,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning();
    return serialize(row!);
  });

  app.post("/me/devices/unregister", async (req, reply) => {
    const body = z.object({ token: z.string().min(1) }).parse(req.body);
    await db
      .delete(pushDevices)
      .where(
        and(
          eq(pushDevices.userId, req.auth.userId),
          eq(pushDevices.token, body.token)
        )
      );
    return reply.code(204).send();
  });

  app.delete("/me/devices/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db
      .delete(pushDevices)
      .where(
        and(eq(pushDevices.id, id), eq(pushDevices.userId, req.auth.userId))
      )
      .returning({ id: pushDevices.id });
    if (!row) return reply.code(404).send({ error: "device_not_found" });
    return reply.code(204).send();
  });
};
