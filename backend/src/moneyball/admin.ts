/**
 * Moneyball roster administration: raw CRUD on `moneyball_players` for
 * admins, plus photo upload.
 *
 * Interplay with the boot-time roster sync (`syncRosterFromCode`): the sync
 * upserts roster.ts by slug but skips rows flagged `manually_edited`, and
 * every write here sets that flag. So an admin edit sticks across deploys,
 * while untouched rows keep following roster.ts. Hard-deleting a player who
 * is still in roster.ts brings them back (fresh, unrated) on the next boot —
 * deactivate instead unless they've also been removed from the file.
 *
 * Photos: see `photos.ts` for how `photo_url` values are stored and resolved.
 */
import { randomUUID } from "node:crypto";
import { count, eq, ne, and } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../db/client.js";
import { moneyballPlayers, moneyballRatings, type MoneyballPlayer } from "../db/schema.js";
import { s3Bucket, s3Client } from "../s3.js";
import { normalizeGender, type Gender } from "./engine.js";
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  PHOTO_KEY_PREFIX,
  resolvePhotoUrl,
  S3_PHOTO_PREFIX,
} from "./photos.js";
import { MoneyballError } from "./service.js";

export type AdminPlayer = {
  id: string;
  slug: string;
  name: string;
  /** Raw stored value (may be `s3:<key>`); what the admin edits. */
  photoUrl: string | null;
  /** Loadable URL for previews. */
  photoSrc: string | null;
  team: string | null;
  gender: Gender | null;
  number: number | null;
  active: boolean;
  manuallyEdited: boolean;
  /** How many raters have scored this player (deleting cascades them). */
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
};

async function toAdminPlayer(p: MoneyballPlayer, ratingCount: number): Promise<AdminPlayer> {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    photoUrl: p.photoUrl,
    photoSrc: await resolvePhotoUrl(p.photoUrl),
    team: p.team,
    gender: normalizeGender(p.gender),
    number: p.number,
    active: p.active,
    manuallyEdited: p.manuallyEdited,
    ratingCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPlayersAdmin(): Promise<AdminPlayer[]> {
  const [players, counts] = await Promise.all([
    db.query.moneyballPlayers.findMany({ orderBy: (t, { asc }) => [asc(t.name)] }),
    db
      .select({ playerId: moneyballRatings.playerId, n: count() })
      .from(moneyballRatings)
      .groupBy(moneyballRatings.playerId),
  ]);
  const byId = new Map(counts.map((c) => [c.playerId, Number(c.n)]));
  return Promise.all(players.map((p) => toAdminPlayer(p, byId.get(p.id) ?? 0)));
}

async function getAdminPlayer(id: string): Promise<AdminPlayer> {
  const p = await db.query.moneyballPlayers.findFirst({ where: eq(moneyballPlayers.id, id) });
  if (!p) throw new MoneyballError("player_not_found", "Player not found", 404);
  const rows = await db
    .select({ n: count() })
    .from(moneyballRatings)
    .where(eq(moneyballRatings.playerId, id));
  return toAdminPlayer(p, Number(rows[0]?.n ?? 0));
}

export type PlayerInput = {
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  gender: Gender | null;
  number: number | null;
  active: boolean;
};

export type PlayerPatch = Partial<PlayerInput>;

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function assertSlugFree(slug: string, exceptId?: string): Promise<void> {
  const clash = await db.query.moneyballPlayers.findFirst({
    where: exceptId
      ? and(eq(moneyballPlayers.slug, slug), ne(moneyballPlayers.id, exceptId))
      : eq(moneyballPlayers.slug, slug),
    columns: { id: true, name: true },
  });
  if (clash) {
    throw new MoneyballError("slug_taken", `Slug "${slug}" is already used by ${clash.name}`, 409);
  }
}

export async function createPlayer(input: PlayerInput): Promise<AdminPlayer> {
  const slug = input.slug.trim() || slugify(input.name);
  if (!slug) throw new MoneyballError("invalid_slug", "Slug is required", 400);
  await assertSlugFree(slug);
  const [row] = await db
    .insert(moneyballPlayers)
    .values({
      slug,
      name: input.name.trim(),
      photoUrl: input.photoUrl,
      team: input.team,
      gender: input.gender,
      number: input.number,
      active: input.active,
      manuallyEdited: true,
    })
    .returning();
  return toAdminPlayer(row!, 0);
}

export async function updatePlayer(id: string, patch: PlayerPatch): Promise<AdminPlayer> {
  const existing = await db.query.moneyballPlayers.findFirst({
    where: eq(moneyballPlayers.id, id),
  });
  if (!existing) throw new MoneyballError("player_not_found", "Player not found", 404);

  const set: Partial<typeof moneyballPlayers.$inferInsert> = {
    manuallyEdited: true,
    updatedAt: new Date(),
  };
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim();
    if (!slug) throw new MoneyballError("invalid_slug", "Slug is required", 400);
    if (slug !== existing.slug) await assertSlugFree(slug, id);
    set.slug = slug;
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new MoneyballError("invalid_name", "Name is required", 400);
    set.name = name;
  }
  if (patch.photoUrl !== undefined) set.photoUrl = patch.photoUrl;
  if (patch.team !== undefined) set.team = patch.team;
  if (patch.gender !== undefined) set.gender = patch.gender;
  if (patch.number !== undefined) set.number = patch.number;
  if (patch.active !== undefined) set.active = patch.active;

  await db.update(moneyballPlayers).set(set).where(eq(moneyballPlayers.id, id));
  return getAdminPlayer(id);
}

/** Hard delete; ratings cascade. See module comment re: roster.ts resurrection. */
export async function deletePlayer(id: string): Promise<void> {
  const res = await db
    .delete(moneyballPlayers)
    .where(eq(moneyballPlayers.id, id))
    .returning({ id: moneyballPlayers.id });
  if (res.length === 0) throw new MoneyballError("player_not_found", "Player not found", 404);
}

/**
 * Store an uploaded photo in the images bucket and point the player at it.
 * Bytes arrive base64-encoded in JSON (photos are small; avoids a multipart
 * dependency). The previous S3 object, if any, is left in place — cheap, and
 * a stale board may still be showing it.
 */
export async function uploadPlayerPhoto(
  id: string,
  contentType: string,
  bytes: Buffer
): Promise<AdminPlayer> {
  const ext = PHOTO_CONTENT_TYPES[contentType];
  if (!ext) {
    throw new MoneyballError(
      "unsupported_type",
      `contentType must be one of ${Object.keys(PHOTO_CONTENT_TYPES).join(", ")}`,
      400
    );
  }
  if (bytes.length === 0) throw new MoneyballError("empty_photo", "Photo is empty", 400);
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new MoneyballError("photo_too_large", `Photo exceeds ${MAX_PHOTO_BYTES} bytes`, 413);
  }
  const existing = await db.query.moneyballPlayers.findFirst({
    where: eq(moneyballPlayers.id, id),
    columns: { slug: true },
  });
  if (!existing) throw new MoneyballError("player_not_found", "Player not found", 404);

  const key = `${PHOTO_KEY_PREFIX}/${existing.slug}-${randomUUID().slice(0, 8)}.${ext}`;
  await s3Client().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return updatePlayer(id, { photoUrl: `${S3_PHOTO_PREFIX}${key}` });
}
