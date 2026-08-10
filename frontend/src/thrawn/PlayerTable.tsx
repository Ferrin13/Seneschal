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
import { fmtPts, fmtVar, positionColor, teamLabel } from "./format";

type SortKey = "var" | "points" | "adp" | "positionRank";

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
  const [sortKey, setSortKey] = useState<SortKey>("var");
  const [sortAsc, setSortAsc] = useState(false);
  const [editing, setEditing] = useState<PlayerValue | null>(null);

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
      if (sortKey === "var") cmp = a.var - b.var;
      else if (sortKey === "points") cmp = a.points - b.points;
      else if (sortKey === "positionRank") cmp = b.positionRank - a.positionRank;
      else if (sortKey === "adp") {
        // Missing ADP sorts last regardless of direction.
        if (a.adp == null && b.adp == null) cmp = 0;
        else if (a.adp == null) return 1;
        else if (b.adp == null) return -1;
        else cmp = b.adp - a.adp;
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
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Player</TableCell>
              <TableCell>Pos</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell align="right" sortDirection={sortKey === "points" ? (sortAsc ? "asc" : "desc") : false}>
                <TableSortLabel
                  active={sortKey === "points"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("points")}
                >
                  Proj pts
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortKey === "positionRank"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("positionRank")}
                >
                  Pos rank
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortKey === "var"}
                  direction={sortAsc ? "asc" : "desc"}
                  onClick={() => toggleSort("var")}
                >
                  VAR
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
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
            {rows.map((v) => {
              const owner =
                v.rosterId != null ? teamByRoster.get(v.rosterId) : undefined;
              return (
                <TableRow key={v.playerId} hover>
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
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {owner ? teamLabel(owner) : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={
                        v.overridden
                          ? `Your projection (public: ${fmtPts(v.basePoints)}${
                              v.overrideNote ? `) — ${v.overrideNote}` : ")"
                            }`
                          : "Public projection scored with league settings"
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
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {v.position}
                      {v.positionRank}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color: v.var > 0 ? "success.main" : "text.disabled",
                      }}
                    >
                      {fmtVar(v.var)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
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
                      <Tooltip title={`#${v.keeperRank} by VAR among rostered players`}>
                        <StarIcon sx={{ fontSize: 16, color: "#F9A825" }} />
                      </Tooltip>
                    ) : null}
                  </TableCell>
                  <TableCell align="right" sx={{ width: 40 }}>
                    <Tooltip title="Edit my projection">
                      <IconButton size="small" onClick={() => setEditing(v)}>
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
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
        * = your custom projection. Replacement levels:{" "}
        {valuation.replacement
          .map((r) => `${r.position} ${r.starterSlots + 1} (${fmtPts(r.points)})`)
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
    </Stack>
  );
}
