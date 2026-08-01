import type { Phase } from "./engine.js";

export type SegmentKind = "player" | "general";

export type SegmentRow = {
  id: string;
  gameId: string;
  playerId: string | null;
  kind: SegmentKind;
  phase: Phase;
  roundNumber: number;
  startedAt: Date;
  endedAt: Date | null;
};

export type OpenSegmentInput = {
  gameId: string;
  playerId: string | null;
  kind: SegmentKind;
  phase: Phase;
  roundNumber: number;
  at: Date;
};

/**
 * Close an open segment at `at`. Returns null if already closed / missing.
 */
export function closeSegment(
  segment: SegmentRow,
  at: Date
): SegmentRow {
  if (segment.endedAt != null) return segment;
  return { ...segment, endedAt: at };
}

export function describeOpenPlayerSegment(
  gameId: string,
  playerId: string,
  phase: Phase,
  roundNumber: number,
  at: Date
): OpenSegmentInput {
  return {
    gameId,
    playerId,
    kind: "player",
    phase,
    roundNumber,
    at,
  };
}

export function describeOpenGeneralSegment(
  gameId: string,
  phase: Phase,
  roundNumber: number,
  at: Date
): OpenSegmentInput {
  return {
    gameId,
    playerId: null,
    kind: "general",
    phase,
    roundNumber,
    at,
  };
}

export type SegmentDuration = {
  segmentId: string;
  gameId: string;
  playerId: string | null;
  kind: SegmentKind;
  phase: Phase;
  roundNumber: number;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number;
};

/** Duration of a segment; open segments use `now` as the end. */
export function segmentDuration(segment: SegmentRow, now: Date): SegmentDuration {
  const end = segment.endedAt ?? now;
  return {
    segmentId: segment.id,
    gameId: segment.gameId,
    playerId: segment.playerId,
    kind: segment.kind,
    phase: segment.phase,
    roundNumber: segment.roundNumber,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationMs: Math.max(0, end.getTime() - segment.startedAt.getTime()),
  };
}

export type StatsBucket = {
  playerId: string | null;
  kind: SegmentKind;
  phase: Phase;
  roundNumber: number;
  durationMs: number;
};

export function aggregateStats(
  segments: SegmentRow[],
  now: Date
): {
  byPlayer: Record<string, number>;
  byPhase: Record<string, number>;
  byRound: Record<number, number>;
  byPlayerPhase: Array<{ playerId: string | null; phase: Phase; durationMs: number }>;
  byPlayerRound: Array<{ playerId: string | null; roundNumber: number; durationMs: number }>;
  generalMs: number;
  totalMs: number;
  segments: SegmentDuration[];
} {
  const durations = segments.map((s) => segmentDuration(s, now));
  const byPlayer: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  const byRound: Record<number, number> = {};
  const playerPhase = new Map<string, number>();
  const playerRound = new Map<string, number>();
  let generalMs = 0;
  let totalMs = 0;

  for (const d of durations) {
    totalMs += d.durationMs;
    byPhase[d.phase] = (byPhase[d.phase] ?? 0) + d.durationMs;
    byRound[d.roundNumber] = (byRound[d.roundNumber] ?? 0) + d.durationMs;
    if (d.kind === "general" || d.playerId == null) {
      generalMs += d.durationMs;
    } else {
      byPlayer[d.playerId] = (byPlayer[d.playerId] ?? 0) + d.durationMs;
      const pk = `${d.playerId}|${d.phase}`;
      playerPhase.set(pk, (playerPhase.get(pk) ?? 0) + d.durationMs);
      const rk = `${d.playerId}|${d.roundNumber}`;
      playerRound.set(rk, (playerRound.get(rk) ?? 0) + d.durationMs);
    }
  }

  return {
    byPlayer,
    byPhase,
    byRound,
    byPlayerPhase: [...playerPhase.entries()].map(([k, durationMs]) => {
      const [playerId, phase] = k.split("|") as [string, Phase];
      return { playerId, phase, durationMs };
    }),
    byPlayerRound: [...playerRound.entries()].map(([k, durationMs]) => {
      const [playerId, roundStr] = k.split("|");
      return { playerId: playerId!, roundNumber: Number(roundStr), durationMs };
    }),
    generalMs,
    totalMs,
    segments: durations,
  };
}
