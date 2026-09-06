/**
 * Pure helpers for the Descartes graph: turning table rows into the wire
 * format and back. No I/O, so it is unit-testable in isolation
 * (test/descartes-graph.test.ts); the service wraps these with the database.
 */

import type {
  DescartesBelief,
  DescartesCluster,
  DescartesClusterMember,
  DescartesRelation,
  NewDescartesBelief,
  NewDescartesCluster,
  NewDescartesClusterMember,
  NewDescartesRelation,
} from "../db/schema.js";
import type { Belief, Cluster, Graph, Point, Relation } from "./schemas.js";

/** Drop undefined-valued keys so JSON output stays tidy. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined)
  ) as T;
}

export function beliefFromRow(row: DescartesBelief): Belief {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    scope: row.scope,
    confidence: row.confidence,
    summary: row.summary,
    notes: row.notes,
    references: row.references.map((r) => compact({ ...r })),
    tags: row.tags,
  };
}

export function relationFromRow(row: DescartesRelation): Relation {
  return compact({
    id: row.id,
    source: row.sourceId,
    target: row.targetId,
    kind: row.kind,
    note: row.note ?? undefined,
  });
}

export function assembleGraph(input: {
  beliefs: DescartesBelief[];
  relations: DescartesRelation[];
  clusters: DescartesCluster[];
  members: DescartesClusterMember[];
}): Graph {
  const beliefs: Record<string, Belief> = {};
  const positions: Record<string, Point> = {};
  for (const row of input.beliefs) {
    beliefs[row.id] = beliefFromRow(row);
    if (row.x != null && row.y != null) {
      positions[row.id] = { x: row.x, y: row.y };
    }
  }

  const membersByCluster = new Map<string, DescartesClusterMember[]>();
  for (const m of input.members) {
    const list = membersByCluster.get(m.clusterId) ?? [];
    list.push(m);
    membersByCluster.set(m.clusterId, list);
  }

  const clusters: Cluster[] = input.clusters.map((row) =>
    compact({
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      color: row.color,
      memberIds: (membersByCluster.get(row.id) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => m.beliefId),
    })
  );

  return {
    beliefs,
    relations: input.relations.map(relationFromRow),
    clusters,
    positions,
  };
}

export function beliefToRow(
  userId: string,
  b: Belief,
  position?: Point
): NewDescartesBelief {
  return {
    userId,
    id: b.id,
    kind: b.kind,
    scope: b.scope,
    confidence: b.confidence,
    title: b.title,
    summary: b.summary,
    notes: b.notes,
    references: b.references,
    tags: b.tags,
    ...(position ? { x: position.x, y: position.y } : {}),
  };
}

export function relationToRow(userId: string, r: Relation): NewDescartesRelation {
  return {
    userId,
    id: r.id,
    sourceId: r.source,
    targetId: r.target,
    kind: r.kind,
    note: r.note ?? null,
  };
}

export function clusterToRow(userId: string, c: Cluster): NewDescartesCluster {
  return {
    userId,
    id: c.id,
    label: c.label,
    description: c.description ?? null,
    color: c.color,
  };
}

/**
 * Membership rows for a cluster, in the client's order, skipping ids that
 * aren't beliefs of this user (a stale client could reference a node deleted
 * elsewhere; better to drop the membership than fail the whole batch).
 */
export function memberRows(
  userId: string,
  c: Cluster,
  knownBeliefIds: ReadonlySet<string>
): NewDescartesClusterMember[] {
  const seen = new Set<string>();
  const rows: NewDescartesClusterMember[] = [];
  for (const beliefId of c.memberIds) {
    if (!knownBeliefIds.has(beliefId) || seen.has(beliefId)) continue;
    seen.add(beliefId);
    rows.push({ userId, clusterId: c.id, beliefId, sortOrder: rows.length });
  }
  return rows;
}
