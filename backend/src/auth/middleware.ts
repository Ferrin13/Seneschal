import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { firebaseAuth } from "./firebase.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { seedUserDefaults } from "../db/seed.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export type AuthContext = {
  firebaseUid: string;
  email: string | null;
  userId: string; // internal users.id
};

const BEARER = /^Bearer\s+(.+)$/i;

// Single-tenant allowlist. Any other identity is rejected at the edge so that
// no users row, seed data, or downstream resources are ever created for them.
const ALLOWED_EMAIL = "12aplustech@gmail.com";

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", null as unknown as AuthContext);

  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    // Skip auth for health checks
    if (req.url === "/healthz" || req.url === "/readyz") return;

    const header = req.headers.authorization;
    if (!header) {
      return reply.code(401).send({ error: "missing_authorization" });
    }
    const match = BEARER.exec(header);
    if (!match) {
      return reply.code(401).send({ error: "invalid_authorization" });
    }
    const idToken = match[1]!;

    let decoded;
    try {
      decoded = await firebaseAuth().verifyIdToken(idToken);
    } catch (err) {
      req.log.warn({ err }, "firebase token verification failed");
      return reply.code(401).send({ error: "invalid_token" });
    }

    const firebaseUid = decoded.uid;
    const email = decoded.email ?? null;

    if (
      !email ||
      !decoded.email_verified ||
      email.toLowerCase() !== ALLOWED_EMAIL
    ) {
      req.log.warn(
        { firebaseUid, email, emailVerified: decoded.email_verified },
        "rejecting token: email not on allowlist"
      );
      return reply.code(403).send({ error: "forbidden" });
    }

    // Lazy upsert: ensure a users row exists, then seed defaults on first
    // sign-in. Safe and idempotent on every request.
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, firebaseUid))
      .limit(1);

    let userId: string;
    if (existing.length === 0) {
      const [created] = await db
        .insert(users)
        .values({
          firebaseUid,
          email,
          displayName: (decoded.name as string | undefined) ?? null,
        })
        .returning({ id: users.id });
      userId = created!.id;
      await seedUserDefaults(db, userId);
    } else {
      userId = existing[0]!.id;
      // Best-effort: keep email fresh, but don't fail the request if it
      // races with a concurrent update.
      if (email && existing[0]!.email !== email) {
        await db
          .update(users)
          .set({ email, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .catch(() => undefined);
      }
    }

    req.auth = { firebaseUid, email, userId };
  });
};

export const authPlugin = fp(plugin, { name: "firebase-auth" });
