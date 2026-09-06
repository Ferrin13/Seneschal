import type { FastifyPluginAsync } from "fastify";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { userAccess, users } from "../db/schema.js";
import {
  FEATURE_LABELS,
  FEATURES,
  isFeature,
  normalizeEmail,
  normalizeFeatures,
  type Feature,
} from "../auth/access.js";

/**
 * Admin console: who can sign in and which products they see. Every route
 * here is behind `/admin`, which the auth middleware restricts to accounts
 * with the admin flag (auth/access.ts).
 *
 * Revoking access deletes only the `user_access` row; the person's data in
 * `users` and the per-product tables is retained so re-granting access later
 * brings everything back.
 */

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform(normalizeEmail);

const featureSchema = z.custom<Feature>(isFeature, {
  message: `feature must be one of: ${FEATURES.join(", ")}`,
});

const createBody = z.object({
  email: emailSchema,
  isAdmin: z.boolean().default(false),
  features: z.array(featureSchema).default([]),
});

const updateBody = z
  .object({
    isAdmin: z.boolean().optional(),
    features: z.array(featureSchema).optional(),
  })
  .refine((b) => b.isAdmin !== undefined || b.features !== undefined, {
    message: "nothing to update",
  });

const emailParams = z.object({ email: emailSchema });

export type AdminUser = {
  email: string;
  isAdmin: boolean;
  features: Feature[];
  /** From BOOTSTRAP_ADMIN_EMAILS: always admin, cannot be demoted or removed. */
  bootstrap: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present once the person has signed in at least once. */
  user: { id: string; displayName: string | null; firstSignInAt: string } | null;
};

function isBootstrap(email: string): boolean {
  return config.BOOTSTRAP_ADMIN_EMAILS.includes(email);
}

async function listUsers(): Promise<AdminUser[]> {
  const rows = await db.select().from(userAccess).orderBy(userAccess.createdAt);
  if (rows.length === 0) return [];

  // Match sign-ins by email. Firebase gives one Google account one uid, so
  // this is 1:1 in practice; if it ever isn't, keep the earliest row.
  const signedIn = await db
    .select({
      id: users.id,
      email: sql<string>`lower(${users.email})`,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      inArray(
        sql`lower(${users.email})`,
        rows.map((r) => r.email)
      )
    )
    .orderBy(users.createdAt);
  const byEmail = new Map<string, (typeof signedIn)[number]>();
  for (const u of signedIn) {
    if (!byEmail.has(u.email)) byEmail.set(u.email, u);
  }

  return rows.map((r) => {
    const u = byEmail.get(r.email);
    return {
      email: r.email,
      isAdmin: r.isAdmin || isBootstrap(r.email),
      features: normalizeFeatures(r.features),
      bootstrap: isBootstrap(r.email),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      user: u
        ? {
            id: u.id,
            displayName: u.displayName,
            firstSignInAt: u.createdAt.toISOString(),
          }
        : null,
    };
  });
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin/features", async () => ({
    features: FEATURES.map((id) => ({ id, label: FEATURE_LABELS[id] })),
  }));

  app.get("/admin/users", async () => ({ users: await listUsers() }));

  app.post("/admin/users", async (req, reply) => {
    const body = createBody.parse(req.body);
    const inserted = await db
      .insert(userAccess)
      .values({
        email: body.email,
        isAdmin: body.isAdmin,
        features: normalizeFeatures(body.features),
        createdBy: req.auth.userId,
      })
      .onConflictDoNothing()
      .returning({ email: userAccess.email });
    if (inserted.length === 0) {
      return reply
        .code(409)
        .send({ error: "already_exists", message: `${body.email} already has access` });
    }
    const all = await listUsers();
    return reply.code(201).send(all.find((u) => u.email === body.email));
  });

  app.patch("/admin/users/:email", async (req, reply) => {
    const { email } = emailParams.parse(req.params);
    const body = updateBody.parse(req.body);

    if (body.isAdmin === false) {
      if (isBootstrap(email)) {
        return reply.code(400).send({
          error: "bootstrap_admin",
          message: "Bootstrap admins (BOOTSTRAP_ADMIN_EMAILS) cannot be demoted",
        });
      }
      if (email === req.auth.email) {
        return reply.code(400).send({
          error: "self_demotion",
          message: "You cannot remove your own admin access",
        });
      }
    }

    const updated = await db
      .update(userAccess)
      .set({
        ...(body.isAdmin !== undefined ? { isAdmin: body.isAdmin } : {}),
        ...(body.features !== undefined
          ? { features: normalizeFeatures(body.features) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(userAccess.email, email))
      .returning({ email: userAccess.email });
    if (updated.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    const all = await listUsers();
    return all.find((u) => u.email === email);
  });

  app.delete("/admin/users/:email", async (req, reply) => {
    const { email } = emailParams.parse(req.params);
    if (isBootstrap(email)) {
      return reply.code(400).send({
        error: "bootstrap_admin",
        message: "Bootstrap admins (BOOTSTRAP_ADMIN_EMAILS) cannot be removed",
      });
    }
    if (email === req.auth.email) {
      return reply.code(400).send({
        error: "self_removal",
        message: "You cannot revoke your own access",
      });
    }
    const deleted = await db
      .delete(userAccess)
      .where(eq(userAccess.email, email))
      .returning({ email: userAccess.email });
    if (deleted.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(204).send();
  });
};
