import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WorkspacesIcon from "@mui/icons-material/Workspaces";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BeliefNodeView } from "./BeliefNodeView";
import { ClusterNodeView } from "./ClusterNodeView";
import { DetailPanel } from "./DetailPanel";
import { Sidebar, beliefMatches } from "./Sidebar";
import type { DescartesNode, RelationEdge } from "./flowTypes";
import {
  BELIEF_KINDS,
  BELIEF_SCOPES,
  KIND_META,
  RELATION_META,
  withAlpha,
} from "./format";
import { NODE_HEIGHT, NODE_WIDTH, clusterBounds } from "./layout";
import { useDescartesStore, type SyncState } from "./store";
import type { BeliefKind, BeliefScope, Selection } from "./types";

const nodeTypes: NodeTypes = {
  belief: BeliefNodeView,
  cluster: ClusterNodeView,
};

const SIDEBAR_WIDTH = 272;
const DETAIL_WIDTH = 384;

/** "Saved" / "Saving…" / error-with-retry, inline in the header caption. */
function SyncIndicator({ sync }: { sync: SyncState }) {
  const iconSx = { fontSize: 16, verticalAlign: "text-bottom" } as const;
  switch (sync.status) {
    case "loading":
      return <span>loading…</span>;
    case "saving":
      return (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <CloudSyncOutlinedIcon sx={iconSx} /> saving…
        </Box>
      );
    case "saved":
      return (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <CloudDoneOutlinedIcon sx={{ ...iconSx, color: "success.main" }} /> saved
        </Box>
      );
    case "error":
      return (
        <Tooltip title={sync.error ?? "Save failed"}>
          <Box
            component="span"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: "warning.main" }}
          >
            <CloudOffIcon sx={iconSx} /> not saved ·
            <Button
              size="small"
              color="warning"
              onClick={sync.retry}
              sx={{ p: 0, minWidth: 0, fontSize: "inherit", textTransform: "none", lineHeight: "inherit" }}
            >
              retry
            </Button>
          </Box>
        </Tooltip>
      );
  }
}

export function DescartesView() {
  return (
    <ReactFlowProvider>
      <DescartesWorkspace />
    </ReactFlowProvider>
  );
}

function DescartesWorkspace() {
  const store = useDescartesStore();
  const { graph, beliefList } = store;
  const rf = useReactFlow<DescartesNode, RelationEdge>();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // ---- UI state ----------------------------------------------------------
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visibleKinds, setVisibleKinds] = useState<Set<BeliefKind>>(
    () => new Set(BELIEF_KINDS)
  );
  const [visibleScopes, setVisibleScopes] = useState<Set<BeliefScope>>(
    () => new Set(BELIEF_SCOPES)
  );
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

  const clusterIds = useMemo(
    () => new Set(graph.clusters.map((c) => c.id)),
    [graph.clusters]
  );

  /** Collapse the raw React Flow selection into one thing to edit. */
  const selection = useMemo<Selection>(() => {
    if (selectedEdgeIds.length > 0) {
      return { type: "relation", id: selectedEdgeIds[0] };
    }
    const beliefs = selectedNodeIds.filter((id) => graph.beliefs[id]);
    const clusters = selectedNodeIds.filter((id) => clusterIds.has(id));
    if (beliefs.length === 1) return { type: "belief", id: beliefs[0] };
    if (beliefs.length > 1) return { type: "beliefs", ids: beliefs };
    if (clusters.length >= 1) return { type: "cluster", id: clusters[0] };
    return { type: "none" };
  }, [selectedNodeIds, selectedEdgeIds, graph.beliefs, clusterIds]);

  const select = useCallback((sel: Selection) => {
    switch (sel.type) {
      case "belief":
      case "cluster":
        setSelectedNodeIds([sel.id]);
        setSelectedEdgeIds([]);
        break;
      case "beliefs":
        setSelectedNodeIds(sel.ids);
        setSelectedEdgeIds([]);
        break;
      case "relation":
        setSelectedNodeIds([]);
        setSelectedEdgeIds([sel.id]);
        break;
      default:
        setSelectedNodeIds([]);
        setSelectedEdgeIds([]);
    }
  }, []);

  const clearSelection = useCallback(() => select({ type: "none" }), [select]);

  /** Select something and pan the canvas to it. */
  const pick = useCallback(
    (sel: Selection) => {
      select(sel);
      if (sel.type === "belief") {
        void rf.fitView({
          nodes: [{ id: sel.id }],
          duration: 400,
          maxZoom: 1.1,
          padding: 1,
        });
      } else if (sel.type === "cluster") {
        const cluster = graph.clusters.find((c) => c.id === sel.id);
        if (cluster && cluster.memberIds.length > 0) {
          void rf.fitView({
            nodes: cluster.memberIds.map((id) => ({ id })),
            duration: 400,
            maxZoom: 1,
            padding: 0.4,
          });
        }
      }
    },
    [select, rf, graph.clusters]
  );

  // ---- Derive React Flow nodes/edges from the domain graph ---------------
  const q = query.trim().toLowerCase();

  const neighbourhood = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set<string>([focusId]);
    for (const r of graph.relations) {
      if (r.source === focusId) ids.add(r.target);
      if (r.target === focusId) ids.add(r.source);
    }
    return ids;
  }, [focusId, graph.relations]);

  const degrees = useMemo(() => {
    const d: Record<string, { in: number; out: number }> = {};
    for (const r of graph.relations) {
      (d[r.source] ??= { in: 0, out: 0 }).out += 1;
      (d[r.target] ??= { in: 0, out: 0 }).in += 1;
    }
    return d;
  }, [graph.relations]);

  const visibleBeliefIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of beliefList) {
      if (!visibleKinds.has(b.kind)) continue;
      if (!visibleScopes.has(b.scope)) continue;
      if (neighbourhood && !neighbourhood.has(b.id)) continue;
      ids.add(b.id);
    }
    return ids;
  }, [beliefList, visibleKinds, visibleScopes, neighbourhood]);

  const dimmedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!q) return ids;
    for (const b of beliefList) if (!beliefMatches(b, q)) ids.add(b.id);
    return ids;
  }, [beliefList, q]);

  const nodes = useMemo<DescartesNode[]>(() => {
    const selectedSet = new Set(selectedNodeIds);
    const soleCluster = selection.type === "cluster" ? selection.id : null;

    const clusterNodes: DescartesNode[] = [];
    for (const c of graph.clusters) {
      const members = c.memberIds.filter((m) => visibleBeliefIds.has(m));
      const bounds = clusterBounds(members, graph.positions);
      if (!bounds) continue;
      clusterNodes.push({
        id: c.id,
        type: "cluster",
        position: { x: bounds.x, y: bounds.y },
        width: bounds.width,
        height: bounds.height,
        data: { cluster: c, memberCount: c.memberIds.length },
        selected: soleCluster === c.id,
        draggable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
        style: { pointerEvents: "none" },
      });
    }

    const beliefNodes: DescartesNode[] = [];
    for (const b of beliefList) {
      const position = graph.positions[b.id] ?? { x: 0, y: 0 };
      const deg = degrees[b.id] ?? { in: 0, out: 0 };
      beliefNodes.push({
        id: b.id,
        type: "belief",
        position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: {
          belief: b,
          dimmed: dimmedIds.has(b.id),
          inCount: deg.in,
          outCount: deg.out,
        },
        selected: selectedSet.has(b.id),
        hidden: !visibleBeliefIds.has(b.id),
      });
    }
    return [...clusterNodes, ...beliefNodes];
  }, [
    graph.clusters,
    graph.positions,
    beliefList,
    degrees,
    dimmedIds,
    visibleBeliefIds,
    selectedNodeIds,
    selection,
  ]);

  const edges = useMemo<RelationEdge[]>(() => {
    const selectedSet = new Set(selectedEdgeIds);
    return graph.relations.map((r) => {
      const meta = RELATION_META[r.kind];
      const isSelected = selectedSet.has(r.id);
      const dim = dimmedIds.has(r.source) || dimmedIds.has(r.target);
      const marker = {
        type: MarkerType.ArrowClosed,
        color: meta.color,
        width: 16,
        height: 16,
      };
      return {
        id: r.id,
        source: r.source,
        target: r.target,
        type: "default",
        data: { relation: r },
        selected: isSelected,
        hidden: !visibleBeliefIds.has(r.source) || !visibleBeliefIds.has(r.target),
        label: showEdgeLabels || isSelected ? meta.verb : undefined,
        labelStyle: { fontSize: 10, fontWeight: 600, fill: meta.color },
        labelBgStyle: { fill: "#F6F4FA", fillOpacity: 0.92 },
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: meta.color,
          strokeWidth: isSelected ? 2.5 : 1.6,
          strokeDasharray: meta.dashed ? "6 4" : undefined,
          opacity: dim ? 0.2 : 1,
        },
        markerEnd: marker,
        markerStart: meta.bidirectional ? marker : undefined,
        interactionWidth: 18,
      };
    });
  }, [graph.relations, selectedEdgeIds, dimmedIds, visibleBeliefIds, showEdgeLabels]);

  // ---- React Flow event plumbing ----------------------------------------
  const onNodesChange = useCallback(
    (changes: NodeChange<DescartesNode>[]) => {
      const toRemove: string[] = [];
      let nextSelected: string[] | null = null;
      for (const ch of changes) {
        switch (ch.type) {
          case "position":
            if (ch.position && graph.beliefs[ch.id]) {
              store.moveBelief(ch.id, ch.position);
            }
            break;
          case "remove":
            if (graph.beliefs[ch.id]) toRemove.push(ch.id);
            else if (clusterIds.has(ch.id)) store.removeCluster(ch.id);
            break;
          case "select": {
            nextSelected ??= [...selectedNodeIds];
            const idx = nextSelected.indexOf(ch.id);
            if (ch.selected && idx === -1) nextSelected.push(ch.id);
            if (!ch.selected && idx !== -1) nextSelected.splice(idx, 1);
            break;
          }
          default:
            break;
        }
      }
      if (toRemove.length > 0) store.removeBeliefs(toRemove);
      if (nextSelected) {
        setSelectedNodeIds(nextSelected);
        if (nextSelected.length > 0) setSelectedEdgeIds([]);
      }
    },
    [graph.beliefs, clusterIds, store, selectedNodeIds]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationEdge>[]) => {
      let nextSelected: string[] | null = null;
      for (const ch of changes) {
        if (ch.type === "remove") {
          store.removeRelation(ch.id);
        } else if (ch.type === "select") {
          nextSelected ??= [...selectedEdgeIds];
          const idx = nextSelected.indexOf(ch.id);
          if (ch.selected && idx === -1) nextSelected.push(ch.id);
          if (!ch.selected && idx !== -1) nextSelected.splice(idx, 1);
        }
      }
      if (nextSelected) {
        setSelectedEdgeIds(nextSelected);
        if (nextSelected.length > 0) setSelectedNodeIds([]);
      }
    },
    [store, selectedEdgeIds]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const id = store.addRelation(conn.source, conn.target, "grounds");
      if (id) select({ type: "relation", id });
    },
    [store, select]
  );

  // ---- Toolbar actions ---------------------------------------------------
  const addBelief = (kind: BeliefKind) => {
    setAddMenuAnchor(null);
    const rect = canvasRef.current?.getBoundingClientRect();
    const centre = rect
      ? rf.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
      : { x: 0, y: 0 };
    const id = store.addBelief({
      kind,
      position: {
        x: Math.round(centre.x - NODE_WIDTH / 2),
        y: Math.round(centre.y - NODE_HEIGHT / 2),
      },
    });
    if (!visibleKinds.has(kind)) {
      setVisibleKinds((s) => new Set(s).add(kind));
    }
    // A new card must be visible; scope defaults come from the store.
    setVisibleScopes(new Set(BELIEF_SCOPES));
    setFocusId(null);
    select({ type: "belief", id });
  };

  const groupSelection = () => {
    if (selection.type !== "beliefs") return;
    const id = store.addCluster(selection.ids);
    select({ type: "cluster", id });
  };

  const fitSoon = () => {
    window.setTimeout(() => {
      void rf.fitView({ duration: 500, padding: 0.15 });
    }, 60);
  };

  // The `fitView` prop only fires for nodes present on mount; the graph
  // arrives from the server a moment later, so fit once it lands.
  const fittedOnLoad = useRef(false);
  useEffect(() => {
    if (store.loading || fittedOnLoad.current) return;
    if (Object.keys(graph.beliefs).length === 0) return;
    fittedOnLoad.current = true;
    window.setTimeout(() => {
      void rf.fitView({ duration: 0, padding: 0.15 });
    }, 80);
  }, [store.loading, graph.beliefs, rf]);

  const autoArrange = () => {
    store.autoArrange();
    fitSoon();
  };

  const resetSample = () => {
    if (
      !window.confirm(
        "Replace everything on the canvas with the sample graph? This cannot be undone."
      )
    ) {
      return;
    }
    store.resetToSample();
    clearSelection();
    setFocusId(null);
    setQuery("");
    fitSoon();
  };

  const toggleKind = (k: BeliefKind) => {
    setVisibleKinds((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleScope = (s: BeliefScope) => {
    setVisibleScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const toggleFocus = (id: string) => {
    const next = focusId === id ? null : id;
    setFocusId(next);
    if (next) {
      window.setTimeout(() => {
        void rf.fitView({ duration: 400, padding: 0.3, maxZoom: 1.1 });
      }, 60);
    }
  };

  const focusedBelief = focusId ? graph.beliefs[focusId] : null;
  const hasSelection = selection.type !== "none";

  const detail = hasSelection ? (
    <DetailPanel
      selection={selection}
      store={store}
      onSelect={pick}
      onClose={clearSelection}
      focusId={focusId}
      onToggleFocus={toggleFocus}
    />
  ) : null;

  return (
    <Stack
      spacing={1.5}
      sx={{
        height: {
          xs: "calc(100vh - 56px - 32px)",
          sm: "calc(100vh - 64px - 64px)",
        },
        minHeight: 520,
      }}
    >
      {/* Header + toolbar */}
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ lg: "flex-end" }}
        spacing={1.5}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ letterSpacing: 4, color: "secondary.main" }}
          >
            Descartes
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 500, fontSize: { xs: "1.6rem", md: "2rem" }, lineHeight: 1.1 }}
          >
            Belief graph
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}
          >
            {Object.keys(graph.beliefs).length} beliefs · {graph.relations.length}{" "}
            connections · {graph.clusters.length} groups ·
            <SyncIndicator sync={store.sync} />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
          >
            New belief
          </Button>
          <Menu
            anchorEl={addMenuAnchor}
            open={!!addMenuAnchor}
            onClose={() => setAddMenuAnchor(null)}
          >
            {BELIEF_KINDS.map((k) => (
              <MenuItem key={k} onClick={() => addBelief(k)}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: KIND_META[k].color,
                    mr: 1.5,
                  }}
                />
                <Box>
                  <Typography variant="body2">{KIND_META[k].label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {KIND_META[k].hint}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
          <Tooltip
            title={
              selection.type === "beliefs"
                ? "Collect the selected beliefs into a group"
                : "Select two or more beliefs to group them"
            }
          >
            <span>
              <Button
                variant="outlined"
                startIcon={<WorkspacesIcon />}
                disabled={selection.type !== "beliefs"}
                onClick={groupSelection}
              >
                Group
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Re-lay out the graph top-to-bottom, keeping groups together">
            <Button
              variant="outlined"
              startIcon={<AutoFixHighIcon />}
              onClick={autoArrange}
            >
              Arrange
            </Button>
          </Tooltip>
          <FormControlLabel
            sx={{ ml: 0.5, mr: 0 }}
            control={
              <Switch
                size="small"
                checked={showEdgeLabels}
                onChange={(e) => setShowEdgeLabels(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Labels</Typography>}
          />
          <Tooltip title="Reset to the sample graph">
            <IconButton onClick={resetSample} size="small">
              <RestartAltIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Workspace */}
      <Paper
        variant="outlined"
        sx={{
          flexGrow: 1,
          minHeight: 0,
          display: "flex",
          overflow: "hidden",
          borderRadius: 3,
        }}
      >
        {sidebarOpen && !narrow ? (
          <Box
            sx={{
              width: SIDEBAR_WIDTH,
              flexShrink: 0,
              borderRight: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
            }}
          >
            <Sidebar
              beliefs={beliefList}
              clusters={graph.clusters}
              selection={selection}
              query={query}
              onQueryChange={setQuery}
              visibleKinds={visibleKinds}
              onToggleKind={toggleKind}
              visibleScopes={visibleScopes}
              onToggleScope={toggleScope}
              onPick={pick}
            />
          </Box>
        ) : null}

        <Box
          ref={canvasRef}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            position: "relative",
            bgcolor: "#FBFAFD",
            "& .react-flow__edge-textbg": { rx: 4 },
            "& .react-flow__node": { cursor: "default" },
            "& .react-flow__handle": { opacity: 0, transition: "opacity 120ms" },
            "& .react-flow__node:hover .react-flow__handle, & .react-flow__node.selected .react-flow__handle":
              { opacity: 1 },
            "& .react-flow__controls": { boxShadow: theme.shadows[2], borderRadius: 2 },
            "& .react-flow__controls-button": { border: 0 },
            "& .react-flow__minimap": { borderRadius: 2, boxShadow: theme.shadows[2] },
          }}
        >
          <ReactFlow<DescartesNode, RelationEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={clearSelection}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.15}
            maxZoom={2}
            selectionOnDrag
            panOnDrag={[1, 2]}
            panOnScroll
            selectNodesOnDrag={false}
            deleteKeyCode={["Delete", "Backspace"]}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            defaultEdgeOptions={{ type: "default" }}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#D9D3E6" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap<DescartesNode>
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(n) =>
                n.type === "belief"
                  ? KIND_META[n.data.belief.kind].color
                  : "transparent"
              }
              nodeStrokeWidth={0}
              maskColor={withAlpha("#2D1B4E", 0.08)}
            />
          </ReactFlow>

          {store.loading || store.loadError ? (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(251,250,253,0.85)",
              }}
            >
              {store.loadError ? (
                <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 360, textAlign: "center" }}>
                  <CloudOffIcon color="disabled" sx={{ fontSize: 40 }} />
                  <Typography variant="body1">Couldn't load your belief graph</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {store.loadError}
                  </Typography>
                  <Button variant="outlined" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={1.5} alignItems="center">
                  <CircularProgress size={28} />
                  <Typography variant="body2" color="text.secondary">
                    Loading your belief graph…
                  </Typography>
                </Stack>
              )}
            </Box>
          ) : null}

          {/* Canvas overlays */}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ position: "absolute", top: 10, left: 10, zIndex: 5 }}
          >
            {!narrow ? (
              <Tooltip title={sidebarOpen ? "Hide index" : "Show index"}>
                <IconButton
                  size="small"
                  onClick={() => setSidebarOpen((o) => !o)}
                  sx={{
                    bgcolor: "background.paper",
                    boxShadow: 1,
                    transform: sidebarOpen ? "none" : "scaleX(-1)",
                    "&:hover": { bgcolor: "background.paper" },
                  }}
                >
                  <MenuOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {focusedBelief ? (
              <Chip
                icon={<CenterFocusStrongIcon />}
                color="primary"
                label={`Focused on “${focusedBelief.title || "Untitled"}”`}
                onClick={() => setFocusId(null)}
                onDelete={() => setFocusId(null)}
                sx={{ boxShadow: 1 }}
              />
            ) : null}
            {q ? (
              <Chip
                label={`Matching “${query.trim()}”`}
                onClick={() => setQuery("")}
                onDelete={() => setQuery("")}
                sx={{ bgcolor: "background.paper", boxShadow: 1 }}
              />
            ) : null}
          </Stack>

          {Object.keys(graph.beliefs).length === 0 ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                textAlign: "center",
                px: 4,
              }}
            >
              <Typography variant="h6" color="text.secondary">
                Empty canvas
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add a belief to begin, or reset to the sample graph.
              </Typography>
            </Stack>
          ) : null}
        </Box>

        {/*
          Always mounted on wide screens: toggling this column while a box
          selection sweeps across cards would resize the canvas on every
          mouse move and make the whole view flicker.
        */}
        {!narrow ? (
          <Box
            sx={{
              width: DETAIL_WIDTH,
              flexShrink: 0,
              borderLeft: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              overflow: "hidden",
            }}
          >
            {detail ?? <EmptyDetail />}
          </Box>
        ) : null}
      </Paper>

      {narrow ? (
        <Drawer
          anchor="right"
          open={hasSelection}
          onClose={clearSelection}
          PaperProps={{ sx: { width: "min(100vw, 420px)" } }}
        >
          {detail}
        </Drawer>
      ) : null}
    </Stack>
  );
}

/** Placeholder for the detail column when nothing is selected. */
function EmptyDetail() {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1}
      sx={{ height: "100%", px: 4, textAlign: "center", color: "text.secondary" }}
    >
      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        Nothing selected
      </Typography>
      <Typography variant="body2">
        Click a belief, a connection, or a group label to edit it here.
      </Typography>
    </Stack>
  );
}
