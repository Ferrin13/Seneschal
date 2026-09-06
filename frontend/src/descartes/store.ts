import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { CLUSTER_COLORS, clampConfidence } from "./format";
import { autoLayout } from "./layout";
import { seedGraph } from "./seed";
import { diffGraphs } from "./sync";
import type {
  Belief,
  BeliefKind,
  BeliefScope,
  Cluster,
  Confidence,
  DescartesGraph,
  Point,
  Reference,
  Relation,
  RelationKind,
} from "./types";

/**
 * Persistence: the graph lives on the server (GET /descartes/graph). Edits
 * apply to local state immediately; after they settle for a moment the store
 * diffs against the last acknowledged snapshot and POSTs one change-set.
 * Only one request is in flight at a time and failures retry with backoff,
 * so the UI never blocks on the network.
 *
 * Earlier builds kept the graph in localStorage under these keys; a user
 * with an empty server graph gets that data imported once, then it's cleared.
 */
const LOCAL_KEYS = ["descartes.graph.v1", "credo.graph.v1"];

/** How long edits must be quiet before a change-set is sent. */
const SYNC_DEBOUNCE_MS = 500;
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;

const EMPTY_GRAPH: DescartesGraph = {
  beliefs: {},
  relations: [],
  clusters: [],
  positions: {},
};

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

function freshGraph(): DescartesGraph {
  const g = seedGraph();
  g.positions = autoLayout(g);
  return g;
}

/** Graph left behind by the localStorage-only version, if any. */
function loadLocalGraph(): DescartesGraph | null {
  try {
    const raw = LOCAL_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DescartesGraph;
    if (!parsed.beliefs || !parsed.relations || !parsed.clusters) return null;
    if (Object.keys(parsed.beliefs).length === 0) return null;
    return {
      ...parsed,
      beliefs: Object.fromEntries(
        Object.entries(parsed.beliefs).map(([id, b]) => [id, migrateBelief(b)])
      ),
      positions: parsed.positions ?? {},
    };
  } catch {
    return null;
  }
}

function clearLocalGraph(): void {
  for (const k of LOCAL_KEYS) localStorage.removeItem(k);
}

function isEmpty(g: DescartesGraph): boolean {
  return Object.keys(g.beliefs).length === 0 && g.clusters.length === 0;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Signed out — sign in again to keep saving";
    if (err.status >= 500) return "Server error while saving";
    try {
      const body = JSON.parse(err.message) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // not JSON
    }
    return `Save failed (HTTP ${err.status})`;
  }
  if (err instanceof TypeError) return "Offline — changes will retry";
  return err instanceof Error ? err.message : "Save failed";
}

export type SyncStatus = "loading" | "saved" | "saving" | "error";

export interface SyncState {
  status: SyncStatus;
  /** Human-readable reason when status is "error". */
  error: string | null;
  /** Force an immediate retry (e.g. from a snackbar button). */
  retry: () => void;
}

/** Shape of a belief before kinds were renamed and confidence/scope added. */
interface LegacyBelief {
  kind?: string;
  status?: "held" | "exploring" | "contested";
  scope?: string;
  confidence?: number;
}

/** Bring a stored belief up to the current shape. Idempotent. */
function migrateBelief(raw: Belief): Belief {
  const legacy = raw as Omit<Belief, keyof LegacyBelief> & LegacyBelief;
  const kindMap: Record<string, BeliefKind> = {
    principle: "axiom", // old "principle" meant a system-level framework
    doctrine: "doctrine",
    teaching: "practice",
    question: "doctrine", // open questions become low-confidence doctrines
    axiom: "axiom",
    practice: "practice",
  };
  const kind = kindMap[legacy.kind ?? ""] ?? "doctrine";

  let confidence: Confidence;
  if (typeof legacy.confidence === "number") {
    confidence = clampConfidence(legacy.confidence);
  } else if (legacy.status === "contested" || legacy.kind === "question") {
    confidence = 3;
  } else if (legacy.status === "exploring") {
    confidence = 5;
  } else {
    confidence = 8;
  }

  const scope: BeliefScope =
    legacy.scope === "general" || legacy.scope === "specific"
      ? legacy.scope
      : kind === "practice"
        ? "specific"
        : "general";

  const { status: _drop, ...rest } = legacy;
  return { ...rest, kind, scope, confidence };
}

export interface DescartesStore {
  graph: DescartesGraph;
  beliefList: Belief[];
  /** True until the first server load resolves (or fails). */
  loading: boolean;
  /** Load failure, if the graph could not be fetched at all. */
  loadError: string | null;
  sync: SyncState;

  addBelief: (init: Partial<Belief> & { position: Point }) => string;
  updateBelief: (id: string, patch: Partial<Omit<Belief, "id">>) => void;
  /** Patch one reference in place; safe to call from async completions. */
  updateReference: (
    beliefId: string,
    refId: string,
    patch: Partial<Omit<Reference, "id">>
  ) => void;
  removeBeliefs: (ids: string[]) => void;
  moveBelief: (id: string, position: Point) => void;
  setPositions: (positions: Record<string, Point>) => void;

  addRelation: (
    source: string,
    target: string,
    kind?: RelationKind
  ) => string | null;
  updateRelation: (id: string, patch: Partial<Omit<Relation, "id">>) => void;
  removeRelation: (id: string) => void;

  addCluster: (memberIds: string[], label?: string) => string;
  updateCluster: (id: string, patch: Partial<Omit<Cluster, "id">>) => void;
  removeCluster: (id: string) => void;
  setMembership: (clusterId: string, beliefId: string, member: boolean) => void;

  autoArrange: () => void;
  resetToSample: () => void;
}

export function useDescartesStore(): DescartesStore {
  const [graph, setGraph] = useState<DescartesGraph>(EMPTY_GRAPH);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [syncError, setSyncError] = useState<string | null>(null);

  const graphRef = useRef(graph);
  graphRef.current = graph;
  /** Last snapshot the server has acknowledged; null until loaded. */
  const syncedRef = useRef<DescartesGraph | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const retryTimer = useRef<number | null>(null);
  const retryDelay = useRef(RETRY_BASE_MS);

  // ---- Initial load -------------------------------------------------------
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let server = await api.descartesGraph();
        if (isEmpty(server)) {
          // First visit: import the pre-backend localStorage graph if there
          // is one, otherwise start from the sample so there's something to
          // explore. Either way the server becomes the source of truth.
          const local = loadLocalGraph();
          const initial = local ?? freshGraph();
          await api.descartesReplaceGraph(initial);
          if (local) clearLocalGraph();
          server = initial;
        }
        if (!live) return;
        syncedRef.current = server;
        setGraph(server);
        setSyncStatus("saved");
      } catch (err) {
        if (!live) return;
        setLoadError(describeError(err));
        setSyncStatus("error");
        setSyncError(describeError(err));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // ---- Change-set sync ----------------------------------------------------
  const flush = useCallback(() => {
    if (retryTimer.current != null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const base = syncedRef.current;
    if (!base) return; // not loaded yet, nothing to sync against
    if (inflightRef.current) return; // completion handler re-runs flush

    const target = graphRef.current;
    const changes = diffGraphs(base, target);
    if (!changes) {
      setSyncStatus("saved");
      return;
    }

    setSyncStatus("saving");
    inflightRef.current = api
      .descartesApplyChanges(changes)
      .then(() => {
        syncedRef.current = target;
        retryDelay.current = RETRY_BASE_MS;
        setSyncError(null);
        setSyncStatus("saved");
      })
      .catch((err: unknown) => {
        setSyncError(describeError(err));
        setSyncStatus("error");
        const delay = retryDelay.current;
        retryDelay.current = Math.min(RETRY_MAX_MS, delay * 2);
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          flush();
        }, delay);
      })
      .finally(() => {
        inflightRef.current = null;
        // Edits that landed while the request was out go in the next batch.
        if (graphRef.current !== syncedRef.current && retryTimer.current == null) {
          flush();
        }
      });
  }, []);

  // Debounced: dragging a card emits a position change per mouse move.
  useEffect(() => {
    if (!syncedRef.current || graph === syncedRef.current) return;
    const handle = window.setTimeout(flush, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [graph, flush]);

  // Best-effort flush when the page is left before the debounce fires.
  useEffect(() => {
    const flushNow = () => {
      const base = syncedRef.current;
      if (!base) return;
      const changes = diffGraphs(base, graphRef.current);
      if (!changes) return;
      syncedRef.current = graphRef.current;
      void api.descartesApplyChanges(changes, { keepalive: true }).catch(() => {
        // Nothing to do here; the next load will show whatever landed.
      });
    };
    window.addEventListener("pagehide", flushNow);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      flushNow();
    };
  }, []);

  const sync = useMemo<SyncState>(
    () => ({ status: syncStatus, error: syncError, retry: flush }),
    [syncStatus, syncError, flush]
  );

  const beliefList = useMemo(
    () =>
      Object.values(graph.beliefs).sort((a, b) =>
        a.title.localeCompare(b.title)
      ),
    [graph.beliefs]
  );

  const addBelief = useCallback<DescartesStore["addBelief"]>((init) => {
    const id = newId("b");
    const kind: BeliefKind = init.kind ?? "practice";
    const belief: Belief = {
      id,
      title: init.title ?? "",
      kind,
      scope: init.scope ?? (kind === "practice" ? "specific" : "general"),
      confidence: init.confidence ?? 5,
      summary: init.summary ?? "",
      notes: init.notes ?? "",
      references: init.references ?? [],
      tags: init.tags ?? [],
    };
    setGraph((g) => ({
      ...g,
      beliefs: { ...g.beliefs, [id]: belief },
      positions: { ...g.positions, [id]: init.position },
    }));
    return id;
  }, []);

  const updateBelief = useCallback<DescartesStore["updateBelief"]>(
    (id, patch) => {
      setGraph((g) => {
        const existing = g.beliefs[id];
        if (!existing) return g;
        return {
          ...g,
          beliefs: { ...g.beliefs, [id]: { ...existing, ...patch } },
        };
      });
    },
    []
  );

  const updateReference = useCallback<DescartesStore["updateReference"]>(
    (beliefId, refId, patch) => {
      setGraph((g) => {
        const existing = g.beliefs[beliefId];
        if (!existing) return g;
        if (!existing.references.some((r) => r.id === refId)) return g;
        return {
          ...g,
          beliefs: {
            ...g.beliefs,
            [beliefId]: {
              ...existing,
              references: existing.references.map((r) =>
                r.id === refId ? { ...r, ...patch } : r
              ),
            },
          },
        };
      });
    },
    []
  );

  const removeBeliefs = useCallback<DescartesStore["removeBeliefs"]>((ids) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    setGraph((g) => {
      const beliefs = { ...g.beliefs };
      const positions = { ...g.positions };
      for (const id of ids) {
        delete beliefs[id];
        delete positions[id];
      }
      return {
        beliefs,
        positions,
        relations: g.relations.filter(
          (r) => !gone.has(r.source) && !gone.has(r.target)
        ),
        clusters: g.clusters.map((c) => ({
          ...c,
          memberIds: c.memberIds.filter((m) => !gone.has(m)),
        })),
      };
    });
  }, []);

  const moveBelief = useCallback<DescartesStore["moveBelief"]>((id, position) => {
    setGraph((g) => ({
      ...g,
      positions: { ...g.positions, [id]: position },
    }));
  }, []);

  const setPositions = useCallback<DescartesStore["setPositions"]>((positions) => {
    setGraph((g) => ({ ...g, positions: { ...g.positions, ...positions } }));
  }, []);

  const addRelation = useCallback<DescartesStore["addRelation"]>(
    (source, target, kind = "grounds") => {
      if (source === target) return null;
      // Validate against the latest committed graph synchronously so the
      // caller gets a usable id back (setState updaters may run later).
      const current = graphRef.current;
      if (!current.beliefs[source] || !current.beliefs[target]) return null;
      const dup = current.relations.find(
        (r) => r.source === source && r.target === target
      );
      if (dup) return dup.id;
      const id = newId("r");
      setGraph((g) => ({
        ...g,
        relations: [...g.relations, { id, source, target, kind }],
      }));
      return id;
    },
    []
  );

  const updateRelation = useCallback<DescartesStore["updateRelation"]>(
    (id, patch) => {
      setGraph((g) => ({
        ...g,
        relations: g.relations.map((r) =>
          r.id === id ? { ...r, ...patch } : r
        ),
      }));
    },
    []
  );

  const removeRelation = useCallback<DescartesStore["removeRelation"]>((id) => {
    setGraph((g) => ({
      ...g,
      relations: g.relations.filter((r) => r.id !== id),
    }));
  }, []);

  const addCluster = useCallback<DescartesStore["addCluster"]>(
    (memberIds, label = "New group") => {
      const id = newId("c");
      setGraph((g) => ({
        ...g,
        clusters: [
          ...g.clusters,
          {
            id,
            label,
            color: CLUSTER_COLORS[g.clusters.length % CLUSTER_COLORS.length],
            memberIds: memberIds.filter((m) => g.beliefs[m]),
          },
        ],
      }));
      return id;
    },
    []
  );

  const updateCluster = useCallback<DescartesStore["updateCluster"]>(
    (id, patch) => {
      setGraph((g) => ({
        ...g,
        clusters: g.clusters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    []
  );

  const removeCluster = useCallback<DescartesStore["removeCluster"]>((id) => {
    setGraph((g) => ({
      ...g,
      clusters: g.clusters.filter((c) => c.id !== id),
    }));
  }, []);

  const setMembership = useCallback<DescartesStore["setMembership"]>(
    (clusterId, beliefId, member) => {
      setGraph((g) => ({
        ...g,
        clusters: g.clusters.map((c) => {
          if (c.id !== clusterId) return c;
          const has = c.memberIds.includes(beliefId);
          if (member && !has) {
            return { ...c, memberIds: [...c.memberIds, beliefId] };
          }
          if (!member && has) {
            return {
              ...c,
              memberIds: c.memberIds.filter((m) => m !== beliefId),
            };
          }
          return c;
        }),
      }));
    },
    []
  );

  const autoArrange = useCallback(() => {
    setGraph((g) => ({ ...g, positions: autoLayout(g) }));
  }, []);

  const resetToSample = useCallback(() => {
    setGraph(freshGraph());
  }, []);

  return {
    graph,
    beliefList,
    loading,
    loadError,
    sync,
    addBelief,
    updateBelief,
    updateReference,
    removeBeliefs,
    moveBelief,
    setPositions,
    addRelation,
    updateRelation,
    removeRelation,
    addCluster,
    updateCluster,
    removeCluster,
    setMembership,
    autoArrange,
    resetToSample,
  };
}
