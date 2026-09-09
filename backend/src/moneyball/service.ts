/**
 * Moneyball service: DB access around the pure engine.
 *
 * Roster and weights are shared across every account with the feature; only
 * ratings are per user. Everything the board needs comes back in one call so
 * the table and card never disagree about the formula in effect.
 */
import { eq, sql, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  moneyballPlayers,
  moneyballRatings,
  moneyballSettings,
  users,
  type MoneyballPlayer,
} from "../db/schema.js";
import {
  aggregate,
  meansFromScores,
  meansOf,
  normalizeGender,
  normalizeRoleWeights,
  normalizeScores,
  normalizeWeights,
  raterCount,
  roleScores,
  score,
  STAT_KEYS,
  summarizeTeam,
  type Aggregate,
  type Gender,
  type RoleScores,
  type RoleWeights,
  type Scorecard,
  type Scores,
  type StatKey,
  type TeamSummary,
  type Weights,
} from "./engine.js";
import { resolvePhotoUrl } from "./photos.js";
import { ROSTER } from "./roster.js";

export class MoneyballError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const WEIGHTS_KEY = "weights";
const ROLE_WEIGHTS_KEY = "roleWeights";

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * Upsert the committed roster by slug. Idempotent; safe to run on every boot.
 * Players present in the DB but missing from the roster are left alone (they
 * may hold ratings) — deactivate them from the Roster admin page if needed.
 * Rows an admin has edited (`manually_edited`) are never overwritten here.
 */
export async function syncRosterFromCode(): Promise<{ upserted: number }> {
  if (ROSTER.length === 0) return { upserted: 0 };
  await db
    .insert(moneyballPlayers)
    .values(
      ROSTER.map((r) => ({
        slug: r.slug,
        name: r.name,
        photoUrl: r.photoUrl,
        team: r.team ?? null,
        gender: r.gender ?? null,
        number: r.number ?? null,
        active: true,
      }))
    )
    .onConflictDoUpdate({
      target: moneyballPlayers.slug,
      set: {
        name: sql`excluded.name`,
        photoUrl: sql`excluded.photo_url`,
        team: sql`excluded.team`,
        gender: sql`excluded.gender`,
        number: sql`excluded.number`,
        updatedAt: sql`now()`,
      },
      setWhere: eq(moneyballPlayers.manuallyEdited, false),
    });
  return { upserted: ROSTER.length };
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

export async function getWeights(): Promise<Weights> {
  const row = await db.query.moneyballSettings.findFirst({
    where: eq(moneyballSettings.key, WEIGHTS_KEY),
  });
  return normalizeWeights(row?.value);
}

export async function setWeights(userId: string, weights: Weights): Promise<Weights> {
  const value = normalizeWeights(weights);
  await db
    .insert(moneyballSettings)
    .values({ key: WEIGHTS_KEY, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: moneyballSettings.key,
      set: { value, updatedByUserId: userId, updatedAt: sql`now()` },
    });
  return value;
}

/** Per-role stat weight tables (handler/cutter/defender OVRs). Shared, like weights. */
export async function getRoleWeights(): Promise<RoleWeights> {
  const row = await db.query.moneyballSettings.findFirst({
    where: eq(moneyballSettings.key, ROLE_WEIGHTS_KEY),
  });
  return normalizeRoleWeights(row?.value as Record<string, Record<string, unknown>> | undefined);
}

export async function setRoleWeights(
  userId: string,
  roleWeights: RoleWeights
): Promise<RoleWeights> {
  const value = normalizeRoleWeights(roleWeights);
  await db
    .insert(moneyballSettings)
    .values({ key: ROLE_WEIGHTS_KEY, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: moneyballSettings.key,
      set: { value, updatedByUserId: userId, updatedAt: sql`now()` },
    });
  return value;
}

// ---------------------------------------------------------------------------
// Board / detail
// ---------------------------------------------------------------------------

/**
 * Viewer-side options for the consensus. `excludeRaters` drops those users'
 * ratings from every team mean, scorecard and role OVR so a viewer can see
 * the board "without so-and-so" — the stored ratings are untouched and the
 * viewer's own `myRating` is always reported regardless.
 */
export type BoardOptions = {
  excludeRaters?: readonly string[];
};

export type BoardPlayer = {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  gender: Gender | null;
  number: number | null;
  /** Raters contributing to the consensus (after any exclusions). */
  raterCount: number;
  /** Raters of this player dropped by `BoardOptions.excludeRaters`. */
  excludedRaterCount: number;
  /** Team mean per stat (null when nobody has rated it). */
  stats: Record<StatKey, number | null>;
  /** How many raters scored each stat. */
  statCounts: Record<StatKey, number>;
  scores: Scorecard;
  /** Handler/cutter/defender OVRs over the team means (role weight tables). */
  roles: RoleScores;
  /** The requesting user's own scores, or null if they haven't rated. */
  myRating: Scores | null;
  /** Scores computed from the requesting user's own rating alone. */
  myScores: Scorecard | null;
};

/** Someone who has rated at least one player; drives the viewer's rater filter. */
export type BoardRater = {
  userId: string;
  /** Display name, else email, else a short id. */
  label: string;
  isMe: boolean;
  /** How many players this person has rated. */
  ratingCount: number;
};

export type Board = {
  weights: Weights;
  roleWeights: RoleWeights;
  /** Everyone with a rating on the board, alphabetical (viewer first). */
  raters: BoardRater[];
  /** The exclusions actually applied (unknown ids are passed through as-is). */
  excludedRaters: string[];
  players: BoardPlayer[];
};

/** One stored rating tagged with who submitted it. */
type RaterScores = { raterUserId: string; scores: Scores };

function raterLabel(r: {
  raterUserId: string;
  displayName: string | null;
  email: string | null;
}): string {
  return r.displayName || r.email || r.raterUserId.slice(0, 8);
}

function toBoardPlayer(
  p: MoneyballPlayer,
  ratings: readonly RaterScores[],
  mine: Scores | null,
  weights: Weights,
  roleWeights: RoleWeights,
  excluded: ReadonlySet<string>
): BoardPlayer {
  const counted = ratings.filter((r) => !excluded.has(r.raterUserId)).map((r) => r.scores);
  const agg: Aggregate = aggregate(counted);
  const means = meansOf(agg);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    photoUrl: p.photoUrl,
    team: p.team,
    gender: normalizeGender(p.gender),
    number: p.number,
    raterCount: raterCount(counted),
    excludedRaterCount:
      raterCount(ratings.map((r) => r.scores)) - raterCount(counted),
    stats: means,
    statCounts: Object.fromEntries(STAT_KEYS.map((k) => [k, agg[k].count])) as Record<
      StatKey,
      number
    >,
    scores: score(means, weights),
    roles: roleScores(means, roleWeights),
    myRating: mine,
    myScores: mine ? score(meansFromScores(mine), weights) : null,
  };
}

export async function getBoard(userId: string, opts: BoardOptions = {}): Promise<Board> {
  const excluded = new Set(opts.excludeRaters ?? []);
  const [weights, roleWeights, players, ratingRows] = await Promise.all([
    getWeights(),
    getRoleWeights(),
    db.query.moneyballPlayers.findMany({
      where: eq(moneyballPlayers.active, true),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db
      .select({
        playerId: moneyballRatings.playerId,
        raterUserId: moneyballRatings.raterUserId,
        scores: moneyballRatings.scores,
        displayName: users.displayName,
        email: users.email,
      })
      .from(moneyballRatings)
      .leftJoin(users, eq(users.id, moneyballRatings.raterUserId)),
  ]);

  const byPlayer = new Map<string, { all: RaterScores[]; mine: Scores | null }>();
  const raterMap = new Map<string, BoardRater>();
  for (const r of ratingRows) {
    const entry = byPlayer.get(r.playerId) ?? { all: [], mine: null };
    const scores = normalizeScores(r.scores);
    entry.all.push({ raterUserId: r.raterUserId, scores });
    if (r.raterUserId === userId) entry.mine = scores;
    byPlayer.set(r.playerId, entry);

    const rater = raterMap.get(r.raterUserId) ?? {
      userId: r.raterUserId,
      label: raterLabel(r),
      isMe: r.raterUserId === userId,
      ratingCount: 0,
    };
    rater.ratingCount += 1;
    raterMap.set(r.raterUserId, rater);
  }

  return {
    weights,
    roleWeights,
    raters: [...raterMap.values()].sort(
      (a, b) => Number(b.isMe) - Number(a.isMe) || a.label.localeCompare(b.label)
    ),
    excludedRaters: [...excluded],
    players: await Promise.all(
      players.map(async (p) => {
        const e = byPlayer.get(p.id) ?? { all: [], mine: null };
        return withPhoto(toBoardPlayer(p, e.all, e.mine, weights, roleWeights, excluded));
      })
    ),
  };
}

/** Swap an `s3:` photo reference for a loadable presigned URL. */
async function withPhoto<T extends { photoUrl: string | null }>(p: T): Promise<T> {
  return { ...p, photoUrl: await resolvePhotoUrl(p.photoUrl) };
}

export const UNASSIGNED_TEAM = "Unassigned";

/**
 * One summary per team (players without a team grouped as "Unassigned").
 * Honors the same viewer-side rater filter as the board: every team mean,
 * ranking and leader is computed from the filtered consensus.
 */
export async function getTeams(
  userId: string,
  opts: BoardOptions = {}
): Promise<{ weights: Weights; teams: TeamSummary[] }> {
  const board = await getBoard(userId, opts);
  const byTeam = new Map<string, BoardPlayer[]>();
  for (const p of board.players) {
    const key = p.team ?? UNASSIGNED_TEAM;
    const list = byTeam.get(key) ?? [];
    list.push(p);
    byTeam.set(key, list);
  }
  const teams = [...byTeam.entries()]
    .map(([team, players]) =>
      summarizeTeam(
        team,
        players.map((p) => ({
          id: p.id,
          name: p.name,
          photoUrl: p.photoUrl,
          gender: p.gender,
          stats: p.stats,
          raterCount: p.raterCount,
        })),
        board.weights,
        board.roleWeights
      )
    )
    .sort(
      (a, b) =>
        (b.scores.overall ?? -1) - (a.scores.overall ?? -1) || a.team.localeCompare(b.team)
    );
  return { weights: board.weights, teams };
}

export type RaterBreakdown = {
  userId: string;
  /** Display name, else email, else a short id. */
  label: string;
  isMe: boolean;
  /** True when the viewer's rater filter left this rating out of the consensus. */
  excluded: boolean;
  scores: Scores;
  scorecard: Scorecard;
  updatedAt: string;
};

export type PlayerDetail = BoardPlayer & {
  weights: Weights;
  roleWeights: RoleWeights;
  raters: RaterBreakdown[];
};

export async function getPlayerDetail(
  userId: string,
  playerId: string,
  opts: BoardOptions = {}
): Promise<PlayerDetail> {
  const excluded = new Set(opts.excludeRaters ?? []);
  const player = await db.query.moneyballPlayers.findFirst({
    where: eq(moneyballPlayers.id, playerId),
  });
  if (!player) throw new MoneyballError("player_not_found", "Player not found", 404);

  const [weights, roleWeights, ratingRows] = await Promise.all([
    getWeights(),
    getRoleWeights(),
    db
      .select({
        raterUserId: moneyballRatings.raterUserId,
        scores: moneyballRatings.scores,
        updatedAt: moneyballRatings.updatedAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(moneyballRatings)
      .leftJoin(users, eq(users.id, moneyballRatings.raterUserId))
      .where(eq(moneyballRatings.playerId, playerId)),
  ]);

  const raters: RaterBreakdown[] = ratingRows.map((r) => {
    const scores = normalizeScores(r.scores);
    return {
      userId: r.raterUserId,
      label: raterLabel(r),
      isMe: r.raterUserId === userId,
      excluded: excluded.has(r.raterUserId),
      scores,
      scorecard: score(meansFromScores(scores), weights),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
  const mine = raters.find((r) => r.isMe)?.scores ?? null;

  return {
    ...(await withPhoto(
      toBoardPlayer(
        player,
        raters.map((r) => ({ raterUserId: r.userId, scores: r.scores })),
        mine,
        weights,
        roleWeights,
        excluded
      )
    )),
    weights,
    roleWeights,
    raters: raters.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.label.localeCompare(b.label)),
  };
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

async function requirePlayer(playerId: string): Promise<MoneyballPlayer> {
  const player = await db.query.moneyballPlayers.findFirst({
    where: eq(moneyballPlayers.id, playerId),
  });
  if (!player) throw new MoneyballError("player_not_found", "Player not found", 404);
  return player;
}

/**
 * Replace the caller's rating for a player (whole-object semantics). `opts`
 * only shapes the returned detail (so the client can patch its filtered board
 * in place); it never affects what is stored.
 */
export async function upsertMyRating(
  userId: string,
  playerId: string,
  scores: Scores,
  opts: BoardOptions = {}
): Promise<PlayerDetail> {
  await requirePlayer(playerId);
  const clean = normalizeScores(scores);
  if (Object.keys(clean).length === 0) {
    await deleteMyRating(userId, playerId);
    return getPlayerDetail(userId, playerId, opts);
  }
  await db
    .insert(moneyballRatings)
    .values({ playerId, raterUserId: userId, scores: clean })
    .onConflictDoUpdate({
      target: [moneyballRatings.playerId, moneyballRatings.raterUserId],
      set: { scores: clean, updatedAt: sql`now()` },
    });
  return getPlayerDetail(userId, playerId, opts);
}

export async function deleteMyRating(userId: string, playerId: string): Promise<void> {
  await db
    .delete(moneyballRatings)
    .where(
      and(eq(moneyballRatings.playerId, playerId), eq(moneyballRatings.raterUserId, userId))
    );
}