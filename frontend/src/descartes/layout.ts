import dagre from "@dagrejs/dagre";
import type { DescartesGraph, Point } from "./types";

/** Fixed belief-card size on the canvas; clusters are sized from these. */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 92;

/** Padding between a cluster's members and its dashed border. */
export const CLUSTER_PAD = 28;
/** Extra room at the top of a cluster for its label. */
export const CLUSTER_HEADER = 22;

/**
 * Top-to-bottom layered layout so principles sit above the doctrines they
 * ground and teachings fall out underneath. Uses dagre's compound-graph
 * support so members of a cluster are kept together (a belief in several
 * clusters is placed with the first one).
 */
export function autoLayout(graph: DescartesGraph): Record<string, Point> {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: "TB",
    nodesep: 48,
    ranksep: 96,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of Object.keys(graph.beliefs)) {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const assigned = new Set<string>();
  for (const cluster of graph.clusters) {
    const members = cluster.memberIds.filter(
      (m) => graph.beliefs[m] && !assigned.has(m)
    );
    if (members.length === 0) continue;
    g.setNode(cluster.id, {});
    for (const m of members) {
      g.setParent(m, cluster.id);
      assigned.add(m);
    }
  }

  for (const r of graph.relations) {
    if (!graph.beliefs[r.source] || !graph.beliefs[r.target]) continue;
    // Tension is symmetric; leave it out of the ranking so it doesn't force
    // one side of a tension underneath the other.
    if (r.kind === "tension") continue;
    g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  const positions: Record<string, Point> = {};
  for (const id of Object.keys(graph.beliefs)) {
    const n = g.node(id);
    // dagre gives centres; React Flow wants top-left.
    positions[id] = {
      x: Math.round(n.x - NODE_WIDTH / 2),
      y: Math.round(n.y - NODE_HEIGHT / 2),
    };
  }
  return positions;
}

/** Bounding box of a set of belief positions, padded for the cluster frame. */
export function clusterBounds(
  memberIds: string[],
  positions: Record<string, Point>
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of memberIds) {
    const p = positions[id];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_WIDTH);
    maxY = Math.max(maxY, p.y + NODE_HEIGHT);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: minX - CLUSTER_PAD,
    y: minY - CLUSTER_PAD - CLUSTER_HEADER,
    width: maxX - minX + CLUSTER_PAD * 2,
    height: maxY - minY + CLUSTER_PAD * 2 + CLUSTER_HEADER,
  };
}
