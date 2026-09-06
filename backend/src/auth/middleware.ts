import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { canAccessPath } from "./access.js";
import { resolveIdToken, type AuthContext } from "./resolve.js";

export type { AuthContext } from "./resolve.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Global auth gate. Two steps for every request:
 *  1. Authenticate: verify the Firebase ID token and look the account up in
 *     `user_access` (or the BOOTSTRAP_ADMIN_EMAILS env list). Unknown
 *     accounts get 403 before any users row or seed data is created.
 *  2. Authorize: map the URL to a feature (auth/access.ts) and require the
 *     account to hold it. Unmapped URLs fail closed.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", null as unknown as AuthContext);

  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    // Skip auth for health checks
    if (req.url === "/healthz" || req.url === "/readyz") return;
    // Lazax WebSocket authenticates on upgrade via ?token= (see routes/lazaxWs.ts).
    if (req.url === "/lazax/ws" || req.url.startsWith("/lazax/ws?")) return;

    const header = req.headers.authorization;
    if (!header) {
      return reply.code(401).send({ error: "missing_authorization" });
    }
    const match = BEARER.exec(header);
    if (!match) {
      return reply.code(401).send({ error: "invalid_authorization" });
    }

    const result = await resolveIdToken(match[1]!);
    if (!result.ok) {
      if (result.status === 401) {
        req.log.warn("firebase token verification failed");
      } else {
        req.log.warn(
          { email: result.email },
          "rejecting token: account has not been granted access"
        );
      }
      return reply.code(result.status).send({ error: result.error });
    }

    if (!canAccessPath(result.auth, req.url)) {
      req.log.info(
        { email: result.auth.email, url: req.url },
        "rejecting request: feature not enabled for account"
      );
      return reply.code(403).send({ error: "feature_not_enabled" });
    }

    req.auth = result.auth;
  });
};

export const authPlugin = fp(plugin, { name: "firebase-auth" });
