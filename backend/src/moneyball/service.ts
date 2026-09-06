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
  normalizeScores,
  normalizeWeights,
  raterCount,
  score,
  STAT_KEYS,
  type Aggregate,
  type Scorecard,
  type Scores,
  type StatKey,
  type Weights,
} from "./engine.js";
import { ROSTER } from "./roster.js";

export class MoneyballError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const WEIGHTS_KEY = "weights";

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * Upsert the committed roster by slug. Idempotent; safe to run on every boot.
 * Players present in the DB but missing from the roster are left alone (they
 * may hold ratings) — deactivate them by hand if needed.
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
        number: sql`excluded.number`,
        updatedAt: sql`now()`,
      },
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

// ---------------------------------------------------------------------------
// Board / detail
// ---------------------------------------------------------------------------

export type BoardPlayer = {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  number: number | null;
  raterCount: number;
  /** Team mean per stat (null when nobody has rated it). */
  stats: Record<StatKey, number | null>;
  /** How many raters scored each stat. */
  statCounts: Record<StatKey, number>;
  scores: Scorecard;
  /** The requesting user's own scores, or null if they haven't rated. */
  myRating: Scores | null;
  /** Scores computed from the requesting user's own rating alone. */
  myScores: Scorecard | null;
};

export type Board = {
  weights: Weights;
  players: BoardPlayer[];
};

function toBoardPlayer(
  p: MoneyballPlayer,
  ratings: Scores[],
  mine: Scores | null,
  weights: Weights
): BoardPlayer {
  const agg: Aggregate = aggregate(ratings);
  const means = meansOf(agg);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    photoUrl: p.photoUrl,
    team: p.team,
    number: p.number,
    raterCount: raterCount(ratings),
    stats: means,
    statCounts: Object.fromEntries(STAT_KEYS.map((k) => [k, agg[k].count])) as Record<
      StatKey,
      number
    >,
    scores: score(means, weights),
    myRating: mine,
    myScores: mine ? score(meansFromScores(mine), weights) : null,
  };
}

export async function getBoard(userId: string): Promise<Board> {
  const [weights, players, ratingRows] = await Promise.all([
    getWeights(),
    db.query.moneyballPlayers.findMany({
      where: eq(moneyballPlayers.active, true),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.select().from(moneyballRatings),
  ]);

  const byPlayer = new Map<string, { all: Scores[]; mine: Scores | null }>();
  for (const r of ratingRows) {
    const entry = byPlayer.get(r.playerId) ?? { all: [], mine: null };
    const scores = normalizeScores(r.scores);
    entry.all.push(scores);
    if (r.raterUserId === userId) entry.mine = scores;
    byPlayer.set(r.playerId, entry);
  }

  return {
    weights,
    players: players.map((p) => {
      const e = byPlayer.get(p.id) ?? { all: [], mine: null };
      return toBoardPlayer(p, e.all, e.mine, weights);
    }),
  };
}

export type RaterBreakdown = {
  userId: string;
  /** Display name, else email, else a short id. */
  label: string;
  isMe: boolean;
  scores: Scores;
  scorecard: Scorecard;
  updatedAt: string;
};

export type PlayerDetail = BoardPlayer & {
  weights: Weights;
  raters: RaterBreakdown[];
};

export async function getPlayerDetail(userId: string, playerId: string): Promise<PlayerDetail> {
  const player = await db.query.moneyballPlayers.findFirst({
    where: eq(moneyballPlayers.id, playerId),
  });
  if (!player) throw new MoneyballError("player_not_found", "Player not found", 404);

  const [weights, ratingRows] = await Promise.all([
    getWeights(),
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
      label: r.displayName || r.email || r.raterUserId.slice(0, 8),
      isMe: r.raterUserId === userId,
      scores,
      scorecard: score(meansFromScores(scores), weights),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
  const mine = raters.find((r) => r.isMe)?.scores ?? null;

  return {
    ...toBoardPlayer(
      player,
      raters.map((r) => r.scores),
      mine,
      weights
    ),
    weights,
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

/** Replace the caller's rating for a player (whole-object semantics). */
export async function upsertMyRating(
  userId: string,
  playerId: string,
  scores: Scores
): Promise<PlayerDetail> {
  await requirePlayer(playerId);
  const clean = normalizeScores(scores);
  if (Object.keys(clean).length === 0) {
    await deleteMyRating(userId, playerId);
    return getPlayerDetail(userId, playerId);
  }
  await db
    .insert(moneyballRatings)
    .values({ playerId, raterUserId: userId, scores: clean })
    .onConflictDoUpdate({
      target: [moneyballRatings.playerId, moneyballRatings.raterUserId],
      set: { scores: clean, updatedAt: sql`now()` },
    });
  return getPlayerDetail(userId, playerId);
}

export async function deleteMyRating(userId: string, playerId: string): Promise<void> {
  await db
    .delete(moneyballRatings)
    .where(
      and(eq(moneyballRatings.playerId, playerId), eq(moneyballRatings.raterUserId, userId))
    );
}