import { describe, expect, it } from "vitest";
import {
  assembleGraph,
  beliefToRow,
  memberRows,
} from "../src/descartes/graph.js";
import { changeSet, graph } from "../src/descartes/schemas.js";
import type {
  DescartesBelief,
  DescartesCluster,
  DescartesClusterMember,
  DescartesRelation,
} from "../src/db/schema.js";

const USER = "00000000-0000-0000-0000-000000000001";
const now = new Date("2026-01-01T00:00:00Z");

function beliefRow(over: Partial<DescartesBelief>): DescartesBelief {
  return {
    userId: USER,
    id: "b1",
    kind: "doctrine",
    scope: "general",
    confidence: 8,
    title: "Union with Christ",
    summary: "",
    notes: "",
    references: [],
    tags: [],
    x: null,
    y: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("assembleGraph", () => {
  it("builds the wire format, omitting unplaced positions and null optionals", () => {
    const beliefs = [
      beliefRow({ id: "a", x: 10, y: 20, references: [{ id: "r1", ref: "John 15:4" }] }),
      beliefRow({ id: "b" }),
    ];
    const relations: DescartesRelation[] = [
      {
        userId: USER,
        id: "rel1",
        sourceId: "a",
        targetId: "b",
        kind: "grounds",
        note: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const clusters: DescartesCluster[] = [
      {
        userId: USER,
        id: "c1",
        label: "Soteriology",
        description: null,
        color: "#1E88E5",
        createdAt: now,
        updatedAt: now,
      },
    ];
    const members: DescartesClusterMember[] = [
      { userId: USER, clusterId: "c1", beliefId: "b", sortOrder: 1 },
      { userId: USER, clusterId: "c1", beliefId: "a", sortOrder: 0 },
    ];

    const g = assembleGraph({ beliefs, relations, clusters, members });

    expect(Object.keys(g.beliefs)).toEqual(["a", "b"]);
    expect(g.positions).toEqual({ a: { x: 10, y: 20 } });
    expect(g.relations).toEqual([
      { id: "rel1", source: "a", target: "b", kind: "grounds" },
    ]);
    expect(g.relations[0]).not.toHaveProperty("note");
    expect(g.clusters).toEqual([
      { id: "c1", label: "Soteriology", color: "#1E88E5", memberIds: ["a", "b"] },
    ]);
    // Output must round-trip through the wire schema.
    expect(() => graph.parse(g)).not.toThrow();
  });
});

describe("row mapping", () => {
  it("only sets x/y when a position is supplied", () => {
    const b = {
      id: "a",
      title: "t",
      kind: "axiom" as const,
      scope: "general" as const,
      confidence: 10,
      summary: "",
      notes: "",
      references: [],
      tags: [],
    };
    expect(beliefToRow(USER, b)).not.toHaveProperty("x");
    expect(beliefToRow(USER, b, { x: 1, y: 2 })).toMatchObject({ x: 1, y: 2 });
  });

  it("drops unknown and duplicate members while preserving order", () => {
    const rows = memberRows(
      USER,
      { id: "c", label: "", color: "#000", memberIds: ["b", "zzz", "a", "b"] },
      new Set(["a", "b"])
    );
    expect(rows.map((r) => [r.beliefId, r.sortOrder])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });
});

describe("changeSet schema", () => {
  it("defaults every section so partial batches are accepted", () => {
    const parsed = changeSet.parse({ positions: { a: { x: 1, y: 2 } } });
    expect(parsed.beliefs).toEqual([]);
    expect(parsed.deleteBeliefIds).toEqual([]);
    expect(parsed.positions).toEqual({ a: { x: 1, y: 2 } });
  });

  it("rejects out-of-range confidence and malformed ids", () => {
    const base = {
      id: "ok_1",
      title: "",
      kind: "practice",
      scope: "specific",
      confidence: 5,
      summary: "",
      notes: "",
      references: [],
      tags: [],
    };
    expect(() => changeSet.parse({ beliefs: [{ ...base, confidence: 11 }] })).toThrow();
    expect(() => changeSet.parse({ beliefs: [{ ...base, id: "has space" }] })).toThrow();
    expect(() => changeSet.parse({ beliefs: [base] })).not.toThrow();
  });
});
