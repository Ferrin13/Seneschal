import type { DescartesChangeSet, DescartesGraph, Point } from "./types";

/**
 * Pure change-detection between two graph snapshots. The store keeps the
 * last snapshot the server acknowledged and, after edits settle, sends only
 * what differs. Kept free of React and I/O so it's trivially testable.
 */

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  return a?.x === b?.x && a?.y === b?.y;
}

export function isEmptyChangeSet(c: DescartesChangeSet): boolean {
  return (
    c.beliefs.length === 0 &&
    c.deleteBeliefIds.length === 0 &&
    c.relations.length === 0 &&
    c.deleteRelationIds.length === 0 &&
    c.clusters.length === 0 &&
    c.deleteClusterIds.length === 0 &&
    Object.keys(c.positions).length === 0
  );
}

/** Everything needed to move the server from `prev` to `next`; null if nothing changed. */
export function diffGraphs(
  prev: DescartesGraph,
  next: DescartesGraph
): DescartesChangeSet | null {
  const out: DescartesChangeSet = {
    beliefs: [],
    deleteBeliefIds: [],
    relations: [],
    deleteRelationIds: [],
    clusters: [],
    deleteClusterIds: [],
    positions: {},
  };

  // Beliefs (by id) and their positions.
  for (const [id, b] of Object.entries(next.beliefs)) {
    const before = prev.beliefs[id];
    if (!before || !sameJson(before, b)) out.beliefs.push(b);
    const pos = next.positions[id];
    if (pos && !samePoint(prev.positions[id], pos)) out.positions[id] = pos;
  }
  for (const id of Object.keys(prev.beliefs)) {
    if (!next.beliefs[id]) out.deleteBeliefIds.push(id);
  }
  const gone = new Set(out.deleteBeliefIds);

  // Relations. Skip deletions the server will cascade anyway.
  const prevRel = new Map(prev.relations.map((r) => [r.id, r] as const));
  const nextRel = new Map(next.relations.map((r) => [r.id, r] as const));
  for (const [id, r] of nextRel) {
    const before = prevRel.get(id);
    if (!before || !sameJson(before, r)) out.relations.push(r);
  }
  for (const [id, r] of prevRel) {
    if (nextRel.has(id)) continue;
    if (gone.has(r.source) || gone.has(r.target)) continue;
    out.deleteRelationIds.push(id);
  }

  // Clusters, including membership changes.
  const prevCl = new Map(prev.clusters.map((c) => [c.id, c] as const));
  const nextCl = new Map(next.clusters.map((c) => [c.id, c] as const));
  for (const [id, c] of nextCl) {
    const before = prevCl.get(id);
    if (!before || !sameJson(before, c)) out.clusters.push(c);
  }
  for (const id of prevCl.keys()) {
    if (!nextCl.has(id)) out.deleteClusterIds.push(id);
  }

  return isEmptyChangeSet(out) ? null : out;
}
