import { useMemo } from "react";
import {
  Box,
  ButtonBase,
  Chip,
  Divider,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { KindDot } from "./BeliefPicker";
import {
  BELIEF_KINDS,
  BELIEF_SCOPES,
  KIND_META,
  RELATION_KINDS,
  RELATION_META,
  SCOPE_META,
  confidenceColor,
  confidenceLabel,
  withAlpha,
} from "./format";
import type {
  Belief,
  BeliefKind,
  BeliefScope,
  Cluster,
  Selection,
} from "./types";

/**
 * Index of the whole graph: search, kind filters, every belief grouped by
 * kind, groups, and a legend. Clicking anything selects it and pans to it.
 */
export function Sidebar({
  beliefs,
  clusters,
  selection,
  query,
  onQueryChange,
  visibleKinds,
  onToggleKind,
  visibleScopes,
  onToggleScope,
  onPick,
}: {
  beliefs: Belief[];
  clusters: Cluster[];
  selection: Selection;
  query: string;
  onQueryChange: (q: string) => void;
  visibleKinds: Set<BeliefKind>;
  onToggleKind: (k: BeliefKind) => void;
  visibleScopes: Set<BeliefScope>;
  onToggleScope: (s: BeliefScope) => void;
  onPick: (sel: Selection) => void;
}) {
  const q = query.trim().toLowerCase();
  const grouped = useMemo(() => {
    const out: Record<BeliefKind, Belief[]> = {
      axiom: [],
      doctrine: [],
      principle: [],
      practice: [],
    };
    for (const b of beliefs) {
      if (q && !beliefMatches(b, q)) continue;
      out[b.kind].push(b);
    }
    return out;
  }, [beliefs, q]);

  const selectedBeliefId = selection.type === "belief" ? selection.id : null;
  const selectedClusterId = selection.type === "cluster" ? selection.id : null;

  return (
    <Stack sx={{ height: "100%", overflow: "hidden" }}>
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search beliefs, notes, tags…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mt: 1 }}>
          {BELIEF_KINDS.map((k) => {
            const on = visibleKinds.has(k);
            return (
              <Chip
                key={k}
                size="small"
                label={KIND_META[k].plural}
                icon={<KindDot kind={k} />}
                onClick={() => onToggleKind(k)}
                variant={on ? "filled" : "outlined"}
                sx={{
                  bgcolor: on ? withAlpha(KIND_META[k].color, 0.12) : undefined,
                  color: on ? KIND_META[k].color : "text.disabled",
                  fontWeight: 600,
                  "& .MuiChip-icon": { ml: 0.75, opacity: on ? 1 : 0.4 },
                }}
              />
            );
          })}
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
          {BELIEF_SCOPES.map((s) => {
            const on = visibleScopes.has(s);
            return (
              <Chip
                key={s}
                size="small"
                label={SCOPE_META[s].label}
                onClick={() => onToggleScope(s)}
                variant={on ? "filled" : "outlined"}
                sx={{
                  color: on ? "text.primary" : "text.disabled",
                  fontWeight: 600,
                }}
              />
            );
          })}
        </Stack>
      </Box>
      <Divider />

      <Box sx={{ overflowY: "auto", flexGrow: 1, px: 0.5, py: 1 }}>
        {BELIEF_KINDS.map((k) => {
          const list = grouped[k];
          if (list.length === 0) return null;
          return (
            <Box key={k} sx={{ mb: 1.5 }}>
              <Typography
                variant="overline"
                sx={{
                  px: 1.5,
                  color: KIND_META[k].color,
                  letterSpacing: 1.5,
                  fontWeight: 700,
                  lineHeight: 1.8,
                }}
              >
                {KIND_META[k].plural} · {list.length}
              </Typography>
              {list.map((b) => (
                <ButtonBase
                  key={b.id}
                  onClick={() => onPick({ type: "belief", id: b.id })}
                  sx={{
                    width: "100%",
                    justifyContent: "space-between",
                    textAlign: "left",
                    px: 1.5,
                    py: 0.6,
                    borderRadius: 1.5,
                    gap: 1,
                    bgcolor:
                      selectedBeliefId === b.id
                        ? withAlpha(KIND_META[k].color, 0.12)
                        : "transparent",
                    opacity:
                      visibleKinds.has(k) && visibleScopes.has(b.scope) ? 1 : 0.45,
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: selectedBeliefId === b.id ? 600 : 400 }}
                  >
                    {b.title || <em>Untitled belief</em>}
                  </Typography>
                  <Typography
                    variant="caption"
                    title={`Confidence ${b.confidence}/10 — ${confidenceLabel(b.confidence)}`}
                    sx={{
                      color: confidenceColor(b.confidence),
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    {b.confidence}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          );
        })}

        {clusters.length > 0 ? (
          <Box sx={{ mb: 1.5 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ px: 1.5, letterSpacing: 1.5, lineHeight: 1.8 }}
            >
              Groups · {clusters.length}
            </Typography>
            {clusters.map((c) => (
              <ButtonBase
                key={c.id}
                onClick={() => onPick({ type: "cluster", id: c.id })}
                sx={{
                  width: "100%",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  px: 1.5,
                  py: 0.6,
                  gap: 1,
                  borderRadius: 1.5,
                  bgcolor:
                    selectedClusterId === c.id
                      ? withAlpha(c.color, 0.12)
                      : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: 0.5,
                    border: `2px dashed ${c.color}`,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                  {c.label || <em>Untitled group</em>}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.memberIds.length}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        ) : null}
      </Box>

      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ letterSpacing: 1.5, lineHeight: 1.6 }}
        >
          Connections
        </Typography>
        <Stack spacing={0.4} sx={{ mt: 0.25 }}>
          {RELATION_KINDS.map((k) => {
            const m = RELATION_META[k];
            return (
              <Stack key={k} direction="row" spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 22,
                    height: 0,
                    borderTop: `2px ${m.dashed ? "dashed" : "solid"} ${m.color}`,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                  <strong style={{ color: m.color }}>A</strong> {m.verb}{" "}
                  <strong style={{ color: m.color }}>B</strong>
                </Typography>
              </Stack>
            );
          })}
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1.25, lineHeight: 1.4 }}
        >
          Drag from the bottom of a card to the top of another to connect
          them. Shift-click or drag a box to select several, then group them.
        </Typography>
      </Box>
    </Stack>
  );
}

export function beliefMatches(b: Belief, q: string): boolean {
  if (!q) return true;
  return (
    b.title.toLowerCase().includes(q) ||
    b.summary.toLowerCase().includes(q) ||
    b.notes.toLowerCase().includes(q) ||
    b.tags.some((t) => t.toLowerCase().includes(q)) ||
    b.references.some(
      (r) =>
        r.ref.toLowerCase().includes(q) ||
        (r.text ?? "").toLowerCase().includes(q)
    )
  );
}
