import { describe, expect, it } from "vitest";
import { aggregateStats, type SegmentRow } from "../src/lazax/segments.js";

describe("aggregateStats", () => {
  it("splits player vs general time and groups by phase/round", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const t2 = new Date("2026-01-01T00:03:00Z");
    const t3 = new Date("2026-01-01T00:04:00Z");
    const segments: SegmentRow[] = [
      {
        id: "1",
        gameId: "g",
        playerId: "a",
        kind: "player",
        phase: "strategy",
        roundNumber: 1,
        startedAt: t0,
        endedAt: t1,
      },
      {
        id: "2",
        gameId: "g",
        playerId: null,
        kind: "general",
        phase: "strategy",
        roundNumber: 1,
        startedAt: t1,
        endedAt: t2,
      },
      {
        id: "3",
        gameId: "g",
        playerId: "b",
        kind: "player",
        phase: "action",
        roundNumber: 1,
        startedAt: t2,
        endedAt: t3,
      },
    ];
    const stats = aggregateStats(segments, t3);
    expect(stats.byPlayer.a).toBe(60_000);
    expect(stats.byPlayer.b).toBe(60_000);
    expect(stats.generalMs).toBe(120_000);
    expect(stats.byPhase.strategy).toBe(180_000);
    expect(stats.byPhase.action).toBe(60_000);
    expect(stats.totalMs).toBe(240_000);
  });
});
