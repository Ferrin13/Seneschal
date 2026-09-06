import { eq, sql } from "drizzle-orm";
import { firebaseAuth } from "./firebase.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { userAccess, users } from "../db/schema.js";
import { seedUserDefaults } from "../db/seed.js";
import {
  FEATURES,
  normalizeEmail,
  resolveAccess,
  type Access,
} from "./access.js";

export type AuthContext = Access & {
  firebaseUid: string;
  email: string;
  userId: string; // internal users.id
};

export type ResolveResult =
  | { ok: true; auth: AuthContext }
  /** Token didn't verify. */
  | { ok: false; status: 401; error: "invalid_token" }
  /** Token is fine but the account has not been granted access. */
  | { ok: false; status: 403; error: "forbidden"; email: string | null };

/**
 * Verify a Firebase ID token and turn it into an AuthContext: the internal
 * user row (lazy-created and seeded), plus what the account may access.
 * Shared by the REST middleware and the Lazax WebSocket upgrade.
 */
export async function resolveIdToken(idToken: string): Promise<ResolveResult> {
  let decoded;
  try {
    decoded = await firebaseAuth().verifyIdToken(idToken);
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const firebaseUid = decoded.uid;
  const rawEmail = decoded.email ?? null;
  if (!rawEmail || !decoded.email_verified) {
    return { ok: false, status: 403, error: "forbidden", email: rawEmail };
  }
  const email = normalizeEmail(rawEmail);

  const [row] = await db
    .select({ isAdmin: userAccess.isAdmin, features: userAccess.features })
    .from(userAccess)
    .where(eq(userAccess.email, email))
    .limit(1);
  const access = resolveAccess(email, row, config.BOOTSTRAP_ADMIN_EMAILS);
  if (!access) {
    return { ok: false, status: 403, error: "forbidden", email };
  }

  // Lazy upsert: ensure a users row exists, then seed defaults on first
  // sign-in. Safe and idempotent on every request.
  const existing = await db
    .select({ id: users.id, email: users.email })
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
    if (existing[0]!.email !== email) {
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

  return { ok: true, auth: { ...access, firebaseUid, email, userId } };
}

/**
 * Make sure every BOOTSTRAP_ADMIN_EMAILS account has a `user_access` row so
 * it appears on the admin page. Existing rows are left alone (their feature
 * list is user-editable); only the admin flag is re-asserted.
 */
export async function ensureBootstrapAdmins(): Promise<void> {
  if (config.BOOTSTRAP_ADMIN_EMAILS.length === 0) return;
  await db
    .insert(userAccess)
    .values(
      config.BOOTSTRAP_ADMIN_EMAILS.map((email) => ({
        email,
        isAdmin: true,
        features: [...FEATURES],
      }))
    )
    .onConflictDoUpdate({
      target: userAccess.email,
      set: { isAdmin: true, updatedAt: sql`now()` },
    });
}
