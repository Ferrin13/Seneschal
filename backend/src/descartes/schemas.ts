import { z } from "zod";

/**
 * Wire format for the Descartes belief graph. Mirrors
 * frontend/src/descartes/types.ts exactly so the client can persist its
 * in-memory graph without a mapping layer.
 */

/** Client-generated ids: short, URL-safe, no whitespace. */
export const entityId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid id");

export const beliefKind = z.enum(["axiom", "doctrine", "principle", "practice"]);
export const beliefScope = z.enum(["general", "specific"]);
export const relationKind = z.enum([
  "grounds",
  "implies",
  "applies",
  "qualifies",
  "tension",
]);

export const reference = z.object({
  id: entityId,
  ref: z.string().max(200),
  text: z.string().max(20_000).optional(),
  translation: z.string().max(16).optional(),
  note: z.string().max(4_000).optional(),
});

export const belief = z.object({
  id: entityId,
  title: z.string().max(500),
  kind: beliefKind,
  scope: beliefScope,
  confidence: z.number().int().min(1).max(10),
  summary: z.string().max(4_000),
  notes: z.string().max(100_000),
  references: z.array(reference).max(200),
  tags: z.array(z.string().max(64)).max(50),
});

export const relation = z.object({
  id: entityId,
  source: entityId,
  target: entityId,
  kind: relationKind,
  note: z.string().max(4_000).optional(),
});

export const cluster = z.object({
  id: entityId,
  label: z.string().max(200),
  description: z.string().max(4_000).optional(),
  color: z.string().max(32),
  memberIds: z.array(entityId).max(2_000),
});

export const point = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const graph = z.object({
  beliefs: z.record(entityId, belief),
  relations: z.array(relation),
  clusters: z.array(cluster),
  positions: z.record(entityId, point),
});

/**
 * A batch of edits, applied atomically. Deletes cascade server-side
 * (removing a belief removes its relations and cluster memberships), so the
 * client only needs to send the primary deletions.
 */
export const changeSet = z.object({
  beliefs: z.array(belief).default([]),
  deleteBeliefIds: z.array(entityId).default([]),
  relations: z.array(relation).default([]),
  deleteRelationIds: z.array(entityId).default([]),
  clusters: z.array(cluster).default([]),
  deleteClusterIds: z.array(entityId).default([]),
  positions: z.record(entityId, point).default({}),
});

export type Belief = z.infer<typeof belief>;
export type Relation = z.infer<typeof relation>;
export type Cluster = z.infer<typeof cluster>;
export type Point = z.infer<typeof point>;
export type Graph = z.infer<typeof graph>;
export type ChangeSet = z.infer<typeof changeSet>;
