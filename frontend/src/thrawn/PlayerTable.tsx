import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import { useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { LeagueValues, PlayerValue } from "./types";
import {
  fmtPts,
  fmtPar,
  positionColor,
  sourceLabel,
  teamLabel,
} from "./format";
import { PlayerDetailDrawer } from "./PlayerDetailDrawer";

/** "Sleeper 245.1 · ESPN 260.3 · FantasySharks 250.0"; null with <2 feeds. */
function sourceBreakdown(sourcePoints: Record<string, number>): string | null {
  const entries = Object.entries(sourcePoints);
  if (entries.length < 2) return null;
  return entries
    .map(([source, pts]) => `${sourceLabel(source)} ${fmtPts(pts)}`)
    .join(" · ");
}

/** Secondary columns collapse below md; the detail drawer covers them. */
const hideOnMobile = { display: { xs: "none", md: "table-cell" } } as const;

type SortKey =
  | "par"
  | "parStarter"
  | "points"
  | "adp"
  | "positionRank"
  | "variance";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

function OverrideDialog({
  leagueId,
  player,
  onClose,
  onSaved,
}: {
  leagueId: string;
  player: PlayerValue;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [points, setPoints] = useState(String(player.points));
  const [note, setNote] = useState(player.overrideNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: number | null) => {
    setSaving(true);
    setError(null);
    try {
      await api.thrawnSetOverride(leagueId, player.playerId, {
        points: value,
        note: value != null && note.trim() !== "" ? note.trim() : null,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  const parsed = Number(points);
  const valid = points.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {player.name}
        <Typography variant="body2" color="text.secondary">
          {player.position} · public projection {fmtPts(player.basePoints)} pts
          (season total)
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="My projected points"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            type="number"
            size="small"
            autoFocus
            fullWidth
          />
          <TextField
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            multiline
            maxRows={3}
            placeholder="Why you're higher/lower than consensus"
          />
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {player.overridden ? (
          <Button
            color="inherit"
            onClick={() => void save(null)}
            disabled={saving}
            sx={{ mr: "auto" }}
          >
            Reset to public
          </Button>
        ) : null}
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void save(parsed)}
          disabled={saving || !valid}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Sortable, filterable table of every valued player, with click-to-edit
 * custom projections that immediately re-rank the whole league.
 */
export function PlayerTable({
  leagueId,
  teams,
  valuation,
  onChanged,
}: Pick<LeagueValues, "teams" | "valuation"> & {
  leagueId: string;
  onChanged: () => Promise<void>;
}) {
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [ownership, setOwnership] = useState<"all" | "rostered" | "free">("all");
  const [sortKey, setSortKey] = useState<SortKey>("parStarter");
  const [sortAsc, setSortAsc] = useState(false);
  const [editing, setEditing] = useState<PlayerValue | null>(null);
  const [detail, setDetail] = useState<PlayerValue | null>(null);

  const teamByRoster = useMemo(
    () => new Map(teams.map((t) => [t.rosterId, t])),
    [teams]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = valuation.values.filter((v) => {
      if (position !== "ALL" && v.position !== position) return false;
      if (ownership === "rostered" && v.rosterId == null) return false;
      if (ownership === "free" && v.rosterId != null) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "par") cmp = a.par - b.par;
      else if (sortKey === "parStarter") cmp = a.parStarter - b.parStarter;
      else if (sortKey === "points") cmp = a.points - b.points;
      else if (sortKey === "positionRank") cmp = b.positionRank - a.positionRank;
      else if (sortKey === "adp") {
        // Missing ADP sorts last regardless of direction.
        if (a.adp == null && b.adp == null) cmp = 0;
        else if (a.adp == null) return 1;
        else if (b.adp == null) return -1;
        else cmp = b.adp - a.adp;
      } else if (sortKey === "variance") {
        // Missing variance sorts last regardless of direction.
        if (a.parVariance == null && b.parVariance == null) cmp = 0;
        else if (a.parVariance == null) return 1;
        else if (b.parVariance == null) return -1;
        else cmp = a.parVariance - b.parVariance;
      }
      return cmp * dir;
    });
    return filtered;
  }, [valuation.values, position, ownership, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          label="Search players"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ minWidth: 220 }}
        />
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel id="pos-label">Position</InputLabel>
          <Select
            labelId="pos-label"
            label="Position"
            value={position}
            onChange={(e) =>
              setPosition(e.target.value as (typeof POSITIONS)[number])
            }
          >
            {POSITIONS.map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="own-label">Ownership</InputLabel>
          <Select
            labelId="own-label"
            label="Ownership"
            value={ownership}
            onChange={(e) =>
              setOwnership(e.target.value as "all" | "rostered" | "free")
            }
          >
            <MenuItem value="all">All players</MenuItem>
            <MenuItem value="rostered">Rostered</MenuItem>
            <MenuItem value="free">Free agents</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <TableContainer
        sx={{ bgcolor: "background.paper", borderRadius: 2, maxHeight: 640 }}
      >
        <Table size="small" stickyHeader sx={{ minWidth: { xs: 0, md: 1080 } }}>
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ width: 40, ...hideOnMobile }}>
                #
              </TableCell>
              <TableCell>Player</TableCell>
              <TableCell>Pos</TableCell>
              <TableCell sx={hideOnMobile}>Owner</TableCell>
              <TableCell
                align="right"
                sx={hideOnMobile}
                sortDirection={sortKey === "points" ? (sortAsc ? "asc" : "desc") : false}
              >
                <TableSortLabel
                  active={sortKey === "points"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("points")}
                >
                  Proj pts
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={hideOnMobile}>
                <TableSortLabel
                  active={sortKey === "positionRank"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("positionRank")}
                >
                  Pos rank
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={hideOnMobile}>
                PPG
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortKey === "parStarter"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("parStarter")}
                >
                  <Tooltip title="Points above starter: per-game points vs. the league-average (median) starter">
                    <span>PAS/G</span>
                  </Tooltip>
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortKey === "par"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("par")}
                >
                  <Tooltip title="Points above replacement: per-game points vs. the fringe bench-level replacement">
                    <span>PAR/G</span>
                  </Tooltip>
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={hideOnMobile}>
                Past PAR/G
              </TableCell>
              <TableCell align="right" sx={hideOnMobile}>
                <TableSortLabel
                  active={sortKey === "variance"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("variance")}
                >
                  Variance
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={hideOnMobile}>
                <TableSortLabel
                  active={sortKey === "adp"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("adp")}
                >
                  ADP
                </TableSortLabel>
              </TableCell>
              <TableCell align="center">Keeper</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((v, i) => {
              const owner =
                v.rosterId != null ? teamByRoster.get(v.rosterId) : undefined;
              return (
                <TableRow
                  key={v.playerId}
                  hover
                  onClick={() => setDetail(v)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: "tabular-nums",
                      color: "text.secondary",
                      ...hideOnMobile,
                    }}
                  >
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {v.name}
                      </Typography>
                      {v.team ? (
                        <Typography variant="caption" color="text.secondary">
                          {v.team}
                        </Typography>
                      ) : null}
                      {v.injuryStatus ? (
                        <Chip
                          label={v.injuryStatus}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ height: 18, fontSize: "0.62rem" }}
                        />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={v.position}
                      size="small"
                      sx={{
                        bgcolor: positionColor(v.position),
                        color: "#fff",
                        fontWeight: 700,
                        height: 20,
                        fontSize: "0.65rem",
                      }}
                    />
                  </TableCell>
                  <TableCell sx={hideOnMobile}>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {owner ? teamLabel(owner) : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    <Tooltip
                      title={
                        v.overridden
                          ? `Your projection (public: ${fmtPts(v.basePoints)}${
                              v.overrideNote ? `) — ${v.overrideNote}` : ")"
                            }`
                          : sourceBreakdown(v.sourcePoints) ??
                            "Public projection scored with league settings"
                      }
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: v.overridden ? 700 : 400,
                          color: v.overridden ? "secondary.main" : undefined,
                        }}
                      >
                        {fmtPts(v.points)}
                        {v.overridden ? "*" : ""}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {v.position}
                      {v.positionRank}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    <Typography
                      variant="body2"
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtPts(v.ppg)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color:
                          v.parStarter > 0 ? "success.main" : "text.disabled",
                      }}
                    >
                      {fmtPar(v.parStarter)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontVariantNumeric: "tabular-nums",
                        color: v.par > 0 ? "success.main" : "text.disabled",
                      }}
                    >
                      {fmtPar(v.par)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    {v.history.length > 0 ? (
                      <Tooltip
                        title={v.history
                          .map(
                            (h) =>
                              `${h.season}: ${fmtPar(h.par)} PAR/G (${fmtPts(h.ppg)} ppg over ${h.gp} games)`
                          )
                          .join(" · ")}
                      >
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
                        >
                          {v.history
                            .map((h) => `${fmtPar(h.par)}`)
                            .join(" / ")}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {v.parVariance != null ? v.parVariance.toFixed(1) : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {v.adp != null ? v.adp.toFixed(1) : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {v.keeperLevel ? (
                      <Tooltip title={`#${v.keeperRank} by PAS among rostered players`}>
                        <StarIcon sx={{ fontSize: 16, color: "#F9A825" }} />
                      </Tooltip>
                    ) : null}
                  </TableCell>
                  <TableCell align="right" sx={{ width: 40 }}>
                    <Tooltip title="Edit my projection">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(v);
                        }}
                      >
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13}>
                  <Box sx={{ py: 3, textAlign: "center" }}>
                    <Typography color="text.secondary">
                      No players match the filters.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="caption" color="text.secondary">
        * = your custom projection. PAS/G = projected points per game above
        the league-average (median) starter, counting flex seats. PAR/G =
        points per game above the replacement player: the best projected
        player beyond the number each position actually occupies on the
        league's rosters. Past PAR/G applies the fringe-bench baseline to
        each season's actual stats (newest first). Baselines:{" "}
        {valuation.replacement
          .map(
            (r) =>
              `${r.position}${r.rank} ${r.playerName ?? "?"} (${fmtPts(r.ppg)}/g, avg starter ${fmtPts(r.avgStarterPpg)}/g)`
          )
          .join(" · ")}
      </Typography>

      {editing ? (
        <OverrideDialog
          leagueId={leagueId}
          player={editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}

      <PlayerDetailDrawer
        open={detail != null}
        onClose={() => setDetail(null)}
        leagueId={leagueId}
        player={detail}
        teamName={
          detail?.rosterId != null
            ? (() => {
                const t = teamByRoster.get(detail.rosterId!);
                return t ? teamLabel(t) : null;
              })()
            : null
        }
      />
    </Stack>
  );
}
