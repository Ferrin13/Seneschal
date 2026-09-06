import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
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
import TuneIcon from "@mui/icons-material/Tune";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { PlayerCard } from "./PlayerCard";
import { ScoreBadge } from "./ScoreBadge";
import { WeightsDialog } from "./WeightsDialog";
import { fmtScore, STAT_KEYS, type Weights } from "./stats";
import type { Board, BoardPlayer, PlayerDetail } from "./types";

const MONEYBALL_PATH = "/moneyball";

type SortKey = "name" | "overall" | "offense" | "defense" | "general" | "raters" | "mine";

const hideOnMobile = { display: { xs: "none", sm: "table-cell" } } as const;

function sortValue(p: BoardPlayer, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return p.name.toLowerCase();
    case "raters":
      return p.raterCount;
    case "mine":
      return p.myScores?.overall ?? null;
    default:
      return p.scores[key];
  }
}

function compare(a: BoardPlayer, b: BoardPlayer, key: SortKey, dir: "asc" | "desc"): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  // Unrated always sinks to the bottom regardless of direction.
  if (av == null && bv == null) return a.name.localeCompare(b.name);
  if (av == null) return 1;
  if (bv == null) return -1;
  let c: number;
  if (typeof av === "string" && typeof bv === "string") c = av.localeCompare(bv);
  else c = (av as number) - (bv as number);
  if (c === 0) c = a.name.localeCompare(b.name);
  return dir === "asc" ? c : -c;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Moneyball home: sortable roster table on the left, Madden-style card for the
 * selected player on the right (stacked on small screens). Selection lives in
 * the URL (/moneyball/:playerId) so cards are linkable.
 */
export function MoneyballView({ selectedPlayerId }: { selectedPlayerId: string | null }) {
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [weightsOpen, setWeightsOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBoard(await api.moneyballBoard());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of board?.players ?? []) if (p.team) set.add(p.team);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [board]);

  const players = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    const filtered = board.players.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) && (!team || p.team === team)
    );
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [board, search, team, sortKey, sortDir]);

  const selected = board?.players.find((p) => p.id === selectedPlayerId) ?? null;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  /** Patch one player in place from a fresh detail payload (no full reload). */
  const applyDetail = (d: PlayerDetail | null) => {
    if (!d) {
      void load();
      return;
    }
    setBoard((b) =>
      b
        ? {
            ...b,
            players: b.players.map((p) =>
              p.id === d.id
                ? {
                    id: d.id,
                    slug: d.slug,
                    name: d.name,
                    photoUrl: d.photoUrl,
                    team: d.team,
                    number: d.number,
                    raterCount: d.raterCount,
                    stats: d.stats,
                    statCounts: d.statCounts,
                    scores: d.scores,
                    myRating: d.myRating,
                    myScores: d.myScores,
                  }
                : p
            ),
          }
        : b
    );
  };

  const applyWeights = (_w: Weights) => {
    // Scores are computed server-side with the new weights; refetch.
    void load();
  };

  const myRatedCount = board?.players.filter((p) => p.myRating != null).length ?? 0;

  const header = (label: string, key: SortKey, align: "left" | "right" | "center" = "right") => (
    <TableCell align={align} sortDirection={sortKey === key ? sortDir : false}>
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? sortDir : "desc"}
        onClick={() => toggleSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ mt: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Moneyball
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {board
              ? `${board.players.length} players · you've rated ${myRatedCount}`
              : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
          />
          {teams.length > 0 ? (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="moneyball-team-label">Team</InputLabel>
              <Select
                labelId="moneyball-team-label"
                label="Team"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">All teams</MenuItem>
                {teams.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <Button
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={() => setWeightsOpen(true)}
            disabled={!board}
          >
            Formula
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {board && board.players.length === 0 ? (
        <Alert severity="info">
          No players yet. Run the roster import (<code>backend/src/moneyball/import.ts</code>)
          and deploy; the server seeds the roster on boot.
        </Alert>
      ) : null}

      {board ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            alignItems: "start",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              md: selected ? "minmax(0, 1fr) 400px" : "minmax(0, 1fr)",
            },
          }}
        >
          {selected ? (
            <Box
              sx={{
                order: { xs: 0, md: 1 },
                position: { md: "sticky" },
                top: { md: 80 },
              }}
            >
              <PlayerCard
                key={selected.id}
                player={selected}
                weights={board.weights}
                onSaved={applyDetail}
                onClose={() => navigate(MONEYBALL_PATH)}
              />
            </Box>
          ) : null}

          <TableContainer
            sx={{
              order: { xs: 1, md: 0 },
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "background.paper",
            }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {header("Player", "name", "left")}
                  {header("OVR", "overall", "center")}
                  {header("OFF", "offense", "center")}
                  {header("DEF", "defense", "center")}
                  {header("GEN", "general", "center")}
                  <TableCell align="center" sx={hideOnMobile} sortDirection={sortKey === "mine" ? sortDir : false}>
                    <Tooltip title="OVR from your rating alone">
                      <TableSortLabel
                        active={sortKey === "mine"}
                        direction={sortKey === "mine" ? sortDir : "desc"}
                        onClick={() => toggleSort("mine")}
                      >
                        Mine
                      </TableSortLabel>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={hideOnMobile} sortDirection={sortKey === "raters" ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === "raters"}
                      direction={sortKey === "raters" ? sortDir : "desc"}
                      onClick={() => toggleSort("raters")}
                    >
                      Raters
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {players.map((p, i) => {
                  const isSelected = p.id === selectedPlayerId;
                  const ratedByMe = p.myRating
                    ? STAT_KEYS.filter((k) => p.myRating?.[k] != null).length
                    : 0;
                  return (
                    <TableRow
                      key={p.id}
                      hover
                      selected={isSelected}
                      onClick={() => navigate(`${MONEYBALL_PATH}/${p.id}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ width: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                          >
                            {i + 1}
                          </Typography>
                          <Avatar
                            src={p.photoUrl ?? undefined}
                            alt={p.name}
                            variant="rounded"
                            sx={{ width: 36, height: 36, fontSize: 14 }}
                          >
                            {initials(p.name)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                              {p.name}
                            </Typography>
                            {p.team || p.number != null ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                                display="block"
                              >
                                {[p.number != null ? `#${p.number}` : null, p.team]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Typography>
                            ) : null}
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell align="center">
                        <ScoreBadge value={p.scores.overall} size="sm" />
                      </TableCell>
                      <TableCell align="center" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmtScore(p.scores.offense)}
                      </TableCell>
                      <TableCell align="center" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmtScore(p.scores.defense)}
                      </TableCell>
                      <TableCell align="center" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmtScore(p.scores.general)}
                      </TableCell>
                      <TableCell align="center" sx={hideOnMobile}>
                        {p.myScores ? (
                          <Tooltip title={`${ratedByMe}/${STAT_KEYS.length} stats rated`}>
                            <Chip
                              size="small"
                              color="primary"
                              variant="outlined"
                              label={fmtScore(p.myScores.overall)}
                            />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            –
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={hideOnMobile}>
                        {p.raterCount}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {players.length === 0 && board.players.length > 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                        No players match{search ? ` "${search}"` : ""}
                        {team ? ` on ${team}` : ""}.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : null}

      {board ? (
        <WeightsDialog
          open={weightsOpen}
          weights={board.weights}
          onClose={() => setWeightsOpen(false)}
          onSaved={applyWeights}
        />
      ) : null}
    </Stack>
  );
}
