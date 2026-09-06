import type { FastifyPluginAsync } from "fastify";
import websocket from "@fastify/websocket";
import { canAccessPath } from "../auth/access.js";
import { resolveIdToken } from "../auth/resolve.js";
import { subscribe, type LazaxClient } from "../lazax/hub.js";
import { getSnapshot } from "../lazax/service.js";

/** Same authn + lazax-feature authz as the REST middleware applies. */
async function resolveUser(idToken: string): Promise<{ userId: string } | null> {
  const result = await resolveIdToken(idToken);
  if (!result.ok) return null;
  if (!canAccessPath(result.auth, "/lazax/ws")) return null;
  return { userId: result.auth.userId };
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
