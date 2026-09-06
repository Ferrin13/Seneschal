import type { Edge, Node } from "@xyflow/react";
import type { Belief, Cluster, Relation } from "./types";

/** React Flow node/edge shapes derived from the domain graph. */

export type BeliefNodeData = {
  belief: Belief;
  /** True when a search/filter is active and this belief doesn't match. */
  dimmed: boolean;
  inCount: number;
  outCount: number;
};
export type BeliefNode = Node<BeliefNodeData, "belief">;

export type ClusterNodeData = {
  cluster: Cluster;
  memberCount: number;
};
export type ClusterNode = Node<ClusterNodeData, "cluster">;

export type DescartesNode = BeliefNode | ClusterNode;

export type RelationEdgeData = { relation: Relation };
export type RelationEdge = Edge<RelationEdgeData, "default">;
