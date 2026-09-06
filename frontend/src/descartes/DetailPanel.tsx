import {
  Box,
  Button,
  ButtonBase,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import WorkspacesIcon from "@mui/icons-material/Workspaces";
import { BeliefDetail } from "./BeliefDetail";
import { BeliefPicker, KindDot } from "./BeliefPicker";
import {
  CLUSTER_COLORS,
  KIND_META,
  RELATION_KINDS,
  RELATION_META,
  withAlpha,
} from "./format";
import type { DescartesStore } from "./store";
import type { Belief, Cluster, Relation, RelationKind, Selection } from "./types";

function PanelHeader({
  color,
  label,
  onClose,
  extra,
}: {
  color: string;
  label: string;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        px: 2,
        pt: 1.5,
        pb: 1,
        borderTop: `4px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Typography
        variant="overline"
        sx={{ color, letterSpacing: 2, fontWeight: 700 }}
      >
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5}>
        {extra}
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}

function BeliefLink({
  belief,
  onClick,
}: {
  belief: Belief;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        justifyContent: "flex-start",
        gap: 1,
        textAlign: "left",
        px: 1.25,
        py: 1,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        borderLeft: `4px solid ${KIND_META[belief.kind].color}`,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{
            color: KIND_META[belief.kind].color,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontSize: "0.62rem",
          }}
        >
          {KIND_META[belief.kind].label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {belief.title || "Untitled belief"}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

function RelationDetail({
  relation,
  store,
  onSelect,
  onClose,
}: {
  relation: Relation;
  store: DescartesStore;
  onSelect: (sel: Selection) => void;
  onClose: () => void;
}) {
  const source = store.graph.beliefs[relation.source];
  const target = store.graph.beliefs[relation.target];
  const meta = RELATION_META[relation.kind];
  if (!source || !target) return null;

  return (
    <Stack sx={{ height: "100%" }}>
      <PanelHeader color={meta.color} label="Connection" onClose={onClose} />
      <Stack spacing={2.5} sx={{ px: 2, pb: 3, overflowY: "auto" }}>
        <Stack spacing={1}>
          <BeliefLink
            belief={source}
            onClick={() => onSelect({ type: "belief", id: source.id })}
          />
          <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 1 }}>
            <Box
              sx={{
                width: 0,
                height: 24,
                borderLeft: `2px ${meta.dashed ? "dashed" : "solid"} ${meta.color}`,
              }}
            />
            <Typography
              variant="body2"
              sx={{ color: meta.color, fontWeight: 600, fontStyle: "italic" }}
            >
              {meta.verb}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Tooltip title="Reverse direction">
              <IconButton
                size="small"
                onClick={() =>
                  store.updateRelation(relation.id, {
                    source: relation.target,
                    target: relation.source,
                  })
                }
              >
                <SwapVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <BeliefLink
            belief={target}
            onClick={() => onSelect({ type: "belief", id: target.id })}
          />
        </Stack>

        <FormControl size="small" fullWidth>
          <InputLabel>Kind of relation</InputLabel>
          <Select
            label="Kind of relation"
            value={relation.kind}
            onChange={(e) =>
              store.updateRelation(relation.id, {
                kind: e.target.value as RelationKind,
              })
            }
          >
            {RELATION_KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 14,
                      height: 0,
                      borderTop: `2px ${RELATION_META[k].dashed ? "dashed" : "solid"} ${RELATION_META[k].color}`,
                    }}
                  />
                  <span>{RELATION_META[k].label}</span>
                </Stack>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Why are these connected?"
          placeholder="The argument that gets you from one to the other"
          value={relation.note ?? ""}
          onChange={(e) =>
            store.updateRelation(relation.id, { note: e.target.value })
          }
          multiline
          minRows={3}
          size="small"
          fullWidth
        />

        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => {
            store.removeRelation(relation.id);
            onClose();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          Remove connection
        </Button>
      </Stack>
    </Stack>
  );
}

function ClusterDetail({
  cluster,
  store,
  onSelect,
  onClose,
}: {
  cluster: Cluster;
  store: DescartesStore;
  onSelect: (sel: Selection) => void;
  onClose: () => void;
}) {
  const members = cluster.memberIds
    .map((id) => store.graph.beliefs[id])
    .filter((b): b is Belief => !!b);
  const nonMembers = store.beliefList.filter(
    (b) => !cluster.memberIds.includes(b.id)
  );

  return (
    <Stack sx={{ height: "100%" }}>
      <PanelHeader color={cluster.color} label="Group" onClose={onClose} />
      <Stack spacing={2.5} sx={{ px: 2, pb: 3, overflowY: "auto" }}>
        <TextField
          variant="standard"
          placeholder="Name this group"
          value={cluster.label}
          onChange={(e) => store.updateCluster(cluster.id, { label: e.target.value })}
          autoFocus={cluster.label === "New group"}
          onFocus={(e) => {
            if (cluster.label === "New group") e.target.select();
          }}
          inputProps={{
            style: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.3 },
          }}
          fullWidth
        />
        <TextField
          label="Description"
          placeholder="What holds these together?"
          value={cluster.description ?? ""}
          onChange={(e) =>
            store.updateCluster(cluster.id, { description: e.target.value })
          }
          multiline
          minRows={2}
          size="small"
          fullWidth
        />

        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ letterSpacing: 1.5 }}
          >
            Colour
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            {CLUSTER_COLORS.map((c) => (
              <ButtonBase
                key={c}
                aria-label={`Colour ${c}`}
                onClick={() => store.updateCluster(cluster.id, { color: c })}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  bgcolor: c,
                  boxShadow:
                    c === cluster.color
                      ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
                      : "none",
                }}
              />
            ))}
          </Stack>
        </Box>

        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ letterSpacing: 1.5 }}
          >
            Members ({members.length})
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {members.map((b) => (
              <Box
                key={b.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  borderRadius: 1.5,
                  pl: 1,
                  pr: 0.25,
                  py: 0.25,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <KindDot kind={b.kind} />
                <ButtonBase
                  onClick={() => onSelect({ type: "belief", id: b.id })}
                  sx={{
                    flexGrow: 1,
                    justifyContent: "flex-start",
                    textAlign: "left",
                    minWidth: 0,
                  }}
                >
                  <Typography variant="body2" noWrap>
                    {b.title || "Untitled belief"}
                  </Typography>
                </ButtonBase>
                <IconButton
                  size="small"
                  aria-label="Remove from group"
                  onClick={() => store.setMembership(cluster.id, b.id, false)}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            ))}
          </Stack>
          <Box sx={{ mt: 1.5 }}>
            <BeliefPicker
              options={nonMembers}
              value={null}
              onChange={(b) => {
                if (b) store.setMembership(cluster.id, b.id, true);
              }}
              placeholder="Add a belief to this group"
            />
          </Box>
        </Box>

        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => {
            store.removeCluster(cluster.id);
            onClose();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          Dissolve group
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ mt: -2 }}>
          Dissolving a group keeps its beliefs and connections.
        </Typography>
      </Stack>
    </Stack>
  );
}

function MultiDetail({
  ids,
  store,
  onSelect,
  onClose,
}: {
  ids: string[];
  store: DescartesStore;
  onSelect: (sel: Selection) => void;
  onClose: () => void;
}) {
  const beliefs = ids
    .map((id) => store.graph.beliefs[id])
    .filter((b): b is Belief => !!b);

  return (
    <Stack sx={{ height: "100%" }}>
      <PanelHeader color="#5E35B1" label="Selection" onClose={onClose} />
      <Stack spacing={2.5} sx={{ px: 2, pb: 3, overflowY: "auto" }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {beliefs.length} beliefs selected
        </Typography>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
          {beliefs.map((b) => (
            <Chip
              key={b.id}
              size="small"
              icon={<KindDot kind={b.kind} />}
              label={b.title || "Untitled belief"}
              onClick={() => onSelect({ type: "belief", id: b.id })}
              sx={{
                bgcolor: withAlpha(KIND_META[b.kind].color, 0.1),
                "& .MuiChip-icon": { ml: 1 },
              }}
            />
          ))}
        </Stack>
        <Button
          variant="contained"
          startIcon={<WorkspacesIcon />}
          onClick={() => {
            const id = store.addCluster(beliefs.map((b) => b.id));
            onSelect({ type: "cluster", id });
          }}
        >
          Group these beliefs
        </Button>
        <Typography variant="body2" color="text.secondary">
          Tip: shift-click cards or drag a box on the canvas to add to the
          selection.
        </Typography>
        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => {
            store.removeBeliefs(beliefs.map((b) => b.id));
            onClose();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          Delete selected
        </Button>
      </Stack>
    </Stack>
  );
}

/** Routes the current selection to the right editor. */
export function DetailPanel({
  selection,
  store,
  onSelect,
  onClose,
  focusId,
  onToggleFocus,
}: {
  selection: Selection;
  store: DescartesStore;
  onSelect: (sel: Selection) => void;
  onClose: () => void;
  focusId: string | null;
  onToggleFocus: (id: string) => void;
}) {
  switch (selection.type) {
    case "belief": {
      const belief = store.graph.beliefs[selection.id];
      if (!belief) return null;
      return (
        <BeliefDetail
          belief={belief}
          store={store}
          onSelect={onSelect}
          onClose={onClose}
          focused={focusId === belief.id}
          onToggleFocus={() => onToggleFocus(belief.id)}
        />
      );
    }
    case "beliefs":
      return (
        <MultiDetail
          ids={selection.ids}
          store={store}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
    case "relation": {
      const relation = store.graph.relations.find((r) => r.id === selection.id);
      if (!relation) return null;
      return (
        <RelationDetail
          relation={relation}
          store={store}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
    }
    case "cluster": {
      const cluster = store.graph.clusters.find((c) => c.id === selection.id);
      if (!cluster) return null;
      return (
        <ClusterDetail
          cluster={cluster}
          store={store}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
    }
    default:
      return null;
  }
}
