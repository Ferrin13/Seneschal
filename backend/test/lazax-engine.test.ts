import { describe, expect, it } from "vitest";
import {
  advanceAfterEndTurn,
  advanceAfterPass,
  advancePhase,
  actionOrder,
  agendaOrder,
  allPassed,
  assertCanOverrideActive,
  effectiveInitiative,
  EngineError,
  nextInActionOrder,
  nextInAgendaOrder,
  speakerOrder,
  startGameActivePlayer,
  type EnginePlayer,
} from "../src/lazax/engine.js";

function p(
  partial: Partial<EnginePlayer> & Pick<EnginePlayer, "id" | "seatIndex" | "factionId">
): EnginePlayer {
  return {
    strategyCard: null,
    actionState: "ready",
    ...partial,
  };
}

const players: EnginePlayer[] = [
  p({ id: "a", seatIndex: 0, factionId: "sol", strategyCard: 3 }),
  p({ id: "b", seatIndex: 1, factionId: "hacan", strategyCard: 1 }),
  p({ id: "c", seatIndex: 2, factionId: "naalu", strategyCard: 8 }),
  p({ id: "d", seatIndex: 3, factionId: "xxcha", strategyCard: 5 }),
];

describe("speakerOrder", () => {
  it("starts at speaker and goes clockwise by seat", () => {
    const order = speakerOrder(players, "c").map((x) => x.id);
    expect(order).toEqual(["c", "d", "a", "b"]);
  });
});

describe("agendaOrder", () => {
  it("starts left of speaker and ends with speaker", () => {
    // speaker c → left d, then a, b, speaker last
    expect(agendaOrder(players, "c").map((x) => x.id)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("nextInAgendaOrder starts voting from general time", () => {
    expect(nextInAgendaOrder(players, "c", null)?.id).toBe("d");
    expect(nextInAgendaOrder(players, "c", "d")?.id).toBe("a");
    expect(nextInAgendaOrder(players, "c", "c")).toBeNull();
  });
});

describe("effectiveInitiative / actionOrder", () => {
  it("gives Naalu initiative 0", () => {
    expect(effectiveInitiative(players[2]!)).toBe(0);
  });

  it("orders action phase by initiative with Naalu first", () => {
    const order = actionOrder(players).map((x) => x.id);
    // Naalu(0), Hacan(1), Sol(3), Xxcha(5)
    expect(order).toEqual(["c", "b", "a", "d"]);
  });

  it("skips passed players", () => {
    const withPass = players.map((x) =>
      x.id === "b" ? { ...x, actionState: "passed" as const } : x
    );
    expect(actionOrder(withPass).map((x) => x.id)).toEqual(["c", "a", "d"]);
  });
});

describe("nextInActionOrder", () => {
  it("wraps to the next unpassed player", () => {
    expect(nextInActionOrder(players, "d")?.id).toBe("c");
    expect(nextInActionOrder(players, "c")?.id).toBe("b");
  });
});

describe("advanceAfterEndTurn", () => {
  it("strategy: advances to next seat needing a card", () => {
    const mid = [
      p({ id: "a", seatIndex: 0, factionId: "sol", strategyCard: 1 }),
      p({ id: "b", seatIndex: 1, factionId: "hacan", strategyCard: null }),
      p({ id: "c", seatIndex: 2, factionId: "xxcha", strategyCard: null }),
    ];
    const result = advanceAfterEndTurn(
      {
        phase: "strategy",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "a",
        clockState: "running",
        status: "active",
      },
      mid
    );
    expect(result.activePlayerId).toBe("b");
  });

  it("action: moves to next initiative", () => {
    const result = advanceAfterEndTurn(
      {
        phase: "action",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "c",
        clockState: "running",
        status: "active",
      },
      players
    );
    expect(result.activePlayerId).toBe("b");
    expect(result.phase).toBe("action");
  });

  it("agenda: general time then left of speaker", () => {
    const fromGeneral = advanceAfterEndTurn(
      {
        phase: "agenda",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: null,
        clockState: "running",
        status: "active",
      },
      players
    );
    expect(fromGeneral.activePlayerId).toBe("b");

    const afterSpeaker = advanceAfterEndTurn(
      {
        phase: "agenda",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "a",
        clockState: "running",
        status: "active",
      },
      players
    );
    expect(afterSpeaker.activePlayerId).toBeNull();
  });
});

describe("advanceAfterPass", () => {
  it("marks passed and continues", () => {
    const result = advanceAfterPass(
      {
        phase: "action",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "c",
        clockState: "running",
        status: "active",
      },
      players,
      "c"
    );
    expect(result.playerUpdates?.[0]).toEqual({
      id: "c",
      actionState: "passed",
    });
    expect(result.activePlayerId).toBe("b");
  });

  it("moves to status when all have passed", () => {
    const almost = players.map((x) =>
      x.id === "c" ? x : { ...x, actionState: "passed" as const }
    );
    const result = advanceAfterPass(
      {
        phase: "action",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "c",
        clockState: "running",
        status: "active",
      },
      almost,
      "c"
    );
    expect(result.phase).toBe("status");
    expect(result.allPassed).toBe(true);
    expect(allPassed(
      almost.map((x) => (x.id === "c" ? { ...x, actionState: "passed" as const } : x))
    )).toBe(true);
  });
});

describe("advancePhase", () => {
  it("strategy → action requires all cards", () => {
    expect(() =>
      advancePhase(
        {
          phase: "strategy",
          roundNumber: 1,
          speakerPlayerId: "a",
          activePlayerId: "a",
          clockState: "paused",
          status: "active",
        },
        [
          p({ id: "a", seatIndex: 0, factionId: "sol", strategyCard: 1 }),
          p({ id: "b", seatIndex: 1, factionId: "hacan", strategyCard: null }),
        ]
      )
    ).toThrow(EngineError);
  });

  it("strategy → action starts at lowest initiative", () => {
    const result = advancePhase(
      {
        phase: "strategy",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: null,
        clockState: "paused",
        status: "active",
      },
      players
    );
    expect(result.phase).toBe("action");
    expect(result.activePlayerId).toBe("c"); // Naalu
  });

  it("status → agenda opens on general time", () => {
    const result = advancePhase(
      {
        phase: "status",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: null,
        clockState: "running",
        status: "active",
      },
      players
    );
    expect(result.phase).toBe("agenda");
    expect(result.activePlayerId).toBeNull();
  });

  it("agenda → next round strategy resets players", () => {
    const result = advancePhase(
      {
        phase: "agenda",
        roundNumber: 2,
        speakerPlayerId: "b",
        activePlayerId: null,
        clockState: "paused",
        status: "active",
      },
      players
    );
    expect(result.phase).toBe("strategy");
    expect(result.roundNumber).toBe(3);
    expect(result.resetPlayers).toBe(true);
    expect(result.activePlayerId).toBe("b");
  });
});

describe("assertCanOverrideActive", () => {
  it("requires paused clock", () => {
    expect(() =>
      assertCanOverrideActive({
        phase: "action",
        roundNumber: 1,
        speakerPlayerId: "a",
        activePlayerId: "a",
        clockState: "running",
        status: "active",
      })
    ).toThrow(EngineError);
  });
});

describe("startGameActivePlayer", () => {
  it("starts at speaker", () => {
    expect(startGameActivePlayer(players, "d")).toBe("d");
  });
});
