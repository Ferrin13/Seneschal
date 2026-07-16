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
export const ALLOWED_EMAILS = ["info@parthadae.com", "12aplustech@gmail.com"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  return ALLOWED_EMAILS.some((allowed) => allowed.toLowerCase() === normalized);
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("auth", null as unknown as AuthContext);

  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    // Skip auth for health checks
    if (req.url === "/healthz" || req.url === "/readyz") return;
    // The browser-box scraper agent authenticates with a shared service token
    // (see routes/agent.ts), not a Firebase ID token — skip Firebase auth here.
    if (req.url === "/agent" || req.url.startsWith("/agent/")) return;

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
      !isAllowedEmail(email)
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

    // Run seed on every request — each subsection is idempotent and
    // short-circuits if its data already exists. This makes adding new
    // seeded tables (e.g. `businesses`) automatically backfill for
    // accounts created before the new seed shipped.
    await seedUserDefaults(db, userId);

    req.auth = { firebaseUid, email, userId };
  });
};

export const authPlugin = fp(plugin, { name: "firebase-auth" });
