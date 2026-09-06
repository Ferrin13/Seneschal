/**
 * Descartes — a directed graph of theological beliefs.
 *
 * Domain model, deliberately independent of the rendering library so it can
 * later be persisted through the backend without change. Everything here is
 * plain JSON-serialisable data.
 */

/**
 * What sort of belief this is, roughly in order from foundation to outworking:
 *   axiom     — a presupposition the rest is built on (not argued for)
 *   doctrine  — a formulated teaching about God, humanity, or salvation
 *   principle — a guiding rule derived from doctrine
 *   practice  — a concrete command or habit
 * The graph is meant to hold everything from a whole framework down to a
 * single practical command, so this is a first-class attribute rather than an
 * implicit property of where a node sits in the graph.
 */
export type BeliefKind = "axiom" | "doctrine" | "principle" | "practice";

/**
 * Breadth of the belief, independent of kind: "Covenant theology" is a
 * general doctrine, "Baptize the children of believers" a specific practice,
 * but a specific doctrine or a general practice are perfectly possible.
 */
export type BeliefScope = "general" | "specific";

/** How firmly the belief is held, 1 (barely) to 10 (bedrock). */
export type Confidence = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Reference {
  id: string;
  /** Citation, e.g. "Philippians 2:3-8" or "WCF 7.1". */
  ref: string;
  /** Quoted text; filled in automatically for scripture citations. */
  text?: string;
  /** Translation the text came from when it was fetched (e.g. "web"). */
  translation?: string;
  /** Why this reference matters for the belief. */
  note?: string;
}

export interface Belief {
  id: string;
  title: string;
  kind: BeliefKind;
  scope: BeliefScope;
  confidence: Confidence;
  /** One-line statement of the belief. */
  summary: string;
  /** Free-form working notes. */
  notes: string;
  references: Reference[];
  tags: string[];
}

/**
 * Directed relation `source -> target`. Read as "source <kind> target":
 *   grounds    — source is the basis / warrant for target
 *   implies    — source logically entails target
 *   applies    — source is put into practice as target (doctrine -> teaching)
 *   qualifies  — source limits or nuances target
 *   tension    — source stands in unresolved tension with target
 */
export type RelationKind =
  | "grounds"
  | "implies"
  | "applies"
  | "qualifies"
  | "tension";

export interface Relation {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  note?: string;
}

/**
 * A named collection of beliefs (a locus like "Soteriology"). Clusters are
 * purely organisational: a belief may belong to several, and membership does
 * not imply any relation.
 */
export interface Cluster {
  id: string;
  label: string;
  description?: string;
  color: string;
  memberIds: string[];
}

export interface Point {
  x: number;
  y: number;
}

export interface DescartesGraph {
  beliefs: Record<string, Belief>;
  relations: Relation[];
  clusters: Cluster[];
  /** Canvas position for each belief, by id. */
  positions: Record<string, Point>;
}

/**
 * A batch of edits for POST /descartes/graph/changes. Deletes cascade on the
 * server (a removed belief takes its relations and memberships with it), so
 * only primary deletions need listing. Produced by `diffGraphs` in sync.ts.
 */
export interface DescartesChangeSet {
  beliefs: Belief[];
  deleteBeliefIds: string[];
  relations: Relation[];
  deleteRelationIds: string[];
  clusters: Cluster[];
  deleteClusterIds: string[];
  positions: Record<string, Point>;
}

/** What is currently selected on the canvas. */
export type Selection =
  | { type: "none" }
  | { type: "belief"; id: string }
  | { type: "beliefs"; ids: string[] }
  | { type: "relation"; id: string }
  | { type: "cluster"; id: string };
