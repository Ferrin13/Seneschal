import type { FastifyPluginAsync } from "fastify";
import websocket from "@fastify/websocket";
import { eq } from "drizzle-orm";
import { firebaseAuth } from "../auth/firebase.js";
import { isAllowedEmail } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { seedUserDefaults } from "../db/seed.js";
import { subscribe, type LazaxClient } from "../lazax/hub.js";
import { getSnapshot } from "../lazax/service.js";

async function resolveUser(idToken: string): Promise<{ userId: string } | null> {
  let decoded;
  try {
    decoded = await firebaseAuth().verifyIdToken(idToken);
  } catch {
    return null;
  }
  const email = decoded.email ?? null;
  if (!email || !decoded.email_verified || !isAllowedEmail(email)) {
    return null;
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, decoded.uid))
    .limit(1);

  let userId: string;
  if (existing.length === 0) {
    const [created] = await db
      .insert(users)
      .values({
        firebaseUid: decoded.uid,
        email,
        displayName: (decoded.name as string | undefined) ?? null,
      })
      .returning({ id: users.id });
    userId = created!.id;
  } else {
    userId = existing[0]!.id;
  }
  await seedUserDefaults(db, userId);
  return { userId };
}

/**
 * WebSocket endpoint for live Lazax game snapshots.
 * Auth via `?token=` (Firebase ID token) and `?gameId=`.
 * Global Firebase REST middleware skips `/lazax/ws`.
 */
export const lazaxWsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  app.get(
    "/lazax/ws",
    { websocket: true },
    async (socket, req) => {
      const q = req.query as { token?: string; gameId?: string };
      const token = q.token;
      const gameId = q.gameId;

      if (!token || !gameId) {
        socket.close(4401, "missing_token_or_game");
        return;
      }

      const auth = await resolveUser(token);
      if (!auth) {
        socket.close(4403, "forbidden");
        return;
      }

      const snap = await getSnapshot(gameId);
      if (!snap) {
        socket.close(4404, "not_found");
        return;
      }

      const client: LazaxClient = {
        socket,
        gameId,
        userId: auth.userId,
      };
      subscribe(client);

      socket.send(JSON.stringify({ type: "snapshot", data: snap }));

      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string };
          if (msg.type === "pong" || msg.type === "ping") {
            if (msg.type === "ping") {
              socket.send(JSON.stringify({ type: "pong", t: Date.now() }));
            }
          }
        } catch {
          // ignore non-JSON
        }
      });
    }
  );
};
