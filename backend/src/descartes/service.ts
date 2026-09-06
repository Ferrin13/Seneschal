import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbClient } from "../db/client.js";
import {
  descartesBeliefs,
  descartesClusterMembers,
  descartesClusters,
  descartesRelations,
} from "../db/schema.js";
import {
  assembleGraph,
  beliefToRow,
  clusterToRow,
  memberRows,
  relationToRow,
} from "./graph.js";
import type { ChangeSet, Graph } from "./schemas.js";

export class DescartesError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function getGraph(userId: string): Promise<Graph> {
  const [beliefs, relations, clusters, members] = await Promise.all([
    db.select().from(descartesBeliefs).where(eq(descartesBeliefs.userId, userId)),
    db
      .select()
      .from(descartesRelations)
      .where(eq(descartesRelations.userId, userId)),
    db
      .select()
      .from(descartesClusters)
      .where(eq(descartesClusters.userId, userId))
      .orderBy(descartesClusters.createdAt),
    db
      .select()
      .from(descartesClusterMembers)
      .where(eq(descartesClusterMembers.userId, userId)),
  ]);
  return assembleGraph({ beliefs, relations, clusters, members });
}

async function knownBeliefIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: descartesBeliefs.id })
    .from(descartesBeliefs)
    .where(eq(descartesBeliefs.userId, userId));
  return new Set(rows.map((r) => r.id));
}

async function upsertBeliefs(
  tx: Tx,
  userId: string,
  changes: ChangeSet,
  now: Date
): Promise<void> {
  if (changes.beliefs.length === 0) return;
  await tx
    .insert(descartesBeliefs)
    .values(
      changes.beliefs.map((b) => beliefToRow(userId, b, changes.positions[b.id]))
    )
    .onConflictDoUpdate({
      target: [descartesBeliefs.userId, descartesBeliefs.id],
      set: {
        kind: sql`excluded.kind`,
        scope: sql`excluded.scope`,
        confidence: sql`excluded.confidence`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        notes: sql`excluded.notes`,
        references: sql`excluded."references"`,
        tags: sql`excluded.tags`,
        // Positions travel separately; don't clobber a placed card with null.
        x: sql`coalesce(excluded.x, ${descartesBeliefs.x})`,
        y: sql`coalesce(excluded.y, ${descartesBeliefs.y})`,
        updatedAt: now,
      },
    });
}

async function applyPositions(
  tx: Tx,
  userId: string,
  changes: ChangeSet,
  now: Date
): Promise<void> {
  const upserted = new Set(changes.beliefs.map((b) => b.id));
  const moves = Object.entries(changes.positions).filter(
    ([id]) => !upserted.has(id)
  );
  for (const [id, p] of moves) {
    await tx
      .update(descartesBeliefs)
      .set({ x: p.x, y: p.y, updatedAt: now })
      .where(and(eq(descartesBeliefs.userId, userId), eq(descartesBeliefs.id, id)));
  }
}

async function upsertRelations(
  tx: Tx,
  userId: string,
  changes: ChangeSet,
  now: Date
): Promise<void> {
  if (changes.relations.length === 0) return;
  await tx
    .insert(descartesRelations)
    .values(changes.relations.map((r) => relationToRow(userId, r)))
    .onConflictDoUpdate({
      target: [descartesRelations.userId, descartesRelations.id],
      set: {
        sourceId: sql`excluded.source_id`,
        targetId: sql`excluded.target_id`,
        kind: sql`excluded.kind`,
        note: sql`excluded.note`,
        updatedAt: now,
      },
    });
}

async function upsertClusters(
  tx: Tx,
  userId: string,
  changes: ChangeSet,
  now: Date
): Promise<void> {
  if (changes.clusters.length === 0) return;
  await tx
    .insert(descartesClusters)
    .values(changes.clusters.map((c) => clusterToRow(userId, c)))
    .onConflictDoUpdate({
      target: [descartesClusters.userId, descartesClusters.id],
      set: {
        label: sql`excluded.label`,
        description: sql`excluded.description`,
        color: sql`excluded.color`,
        updatedAt: now,
      },
    });

  // Membership is replaced wholesale per cluster; it's a short list.
  const known = await knownBeliefIds(tx, userId);
  await tx
    .delete(descartesClusterMembers)
    .where(
      and(
        eq(descartesClusterMembers.userId, userId),
        inArray(
          descartesClusterMembers.clusterId,
          changes.clusters.map((c) => c.id)
        )
      )
    );
  const rows = changes.clusters.flatMap((c) => memberRows(userId, c, known));
  if (rows.length > 0) {
    await tx.insert(descartesClusterMembers).values(rows);
  }
}

/** Translate Postgres constraint failures into 4xx errors the client can act on. */
function translatePgError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  switch (e.code) {
    case "23503": // foreign key
      throw new DescartesError(
        "unknown_reference",
        `A relation or group points at a belief that doesn't exist (${e.constraint ?? "fk"})`,
        409
      );
    case "23505": // unique
      throw new DescartesError(
        "duplicate",
        e.constraint === "descartes_relations_pair_idx"
          ? "A relation between those two beliefs already exists"
          : `Duplicate entry (${e.constraint ?? "unique"})`,
        409
      );
    case "23514": // check
      throw new DescartesError("invalid_value", e.message ?? "Constraint failed", 400);
    default:
      throw err;
  }
}

/**
 * Apply a batch of edits atomically. Order matters: beliefs first so new
 * relations/memberships have something to point at, deletions last so
 * cascades clean up anything the client didn't bother to list.
 */
export async function applyChanges(userId: string, changes: ChangeSet): Promise<void> {
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await upsertBeliefs(tx, userId, changes, now);
      await applyPositions(tx, userId, changes, now);
      await upsertRelations(tx, userId, changes, now);
      await upsertClusters(tx, userId, changes, now);

      if (changes.deleteRelationIds.length > 0) {
        await tx
          .delete(descartesRelations)
          .where(
            and(
              eq(descartesRelations.userId, userId),
              inArray(descartesRelations.id, changes.deleteRelationIds)
            )
          );
      }
      if (changes.deleteClusterIds.length > 0) {
        await tx
          .delete(descartesClusters)
          .where(
            and(
              eq(descartesClusters.userId, userId),
              inArray(descartesClusters.id, changes.deleteClusterIds)
            )
          );
      }
      if (changes.deleteBeliefIds.length > 0) {
        await tx
          .delete(descartesBeliefs)
          .where(
            and(
              eq(descartesBeliefs.userId, userId),
              inArray(descartesBeliefs.id, changes.deleteBeliefIds)
            )
          );
      }
    });
  } catch (err) {
    translatePgError(err);
  }
}

/** Replace the user's entire graph (import, or "reset to sample"). */
export async function replaceGraph(userId: string, graph: Graph): Promise<void> {
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      // Cascades take relations and memberships with them.
      await tx.delete(descartesClusters).where(eq(descartesClusters.userId, userId));
      await tx.delete(descartesBeliefs).where(eq(descartesBeliefs.userId, userId));

      const beliefs = Object.values(graph.beliefs);
      if (beliefs.length > 0) {
        await tx
          .insert(descartesBeliefs)
          .values(
            beliefs.map((b) => ({
              ...beliefToRow(userId, b, graph.positions[b.id]),
              createdAt: now,
              updatedAt: now,
            }))
          );
      }
      if (graph.relations.length > 0) {
        await tx
          .insert(descartesRelations)
          .values(graph.relations.map((r) => relationToRow(userId, r)));
      }
      if (graph.clusters.length > 0) {
        await tx
          .insert(descartesClusters)
          .values(graph.clusters.map((c) => clusterToRow(userId, c)));
        const known = new Set(beliefs.map((b) => b.id));
        const rows = graph.clusters.flatMap((c) => memberRows(userId, c, known));
        if (rows.length > 0) {
          await tx.insert(descartesClusterMembers).values(rows);
        }
      }
    });
  } catch (err) {
    translatePgError(err);
  }
}
