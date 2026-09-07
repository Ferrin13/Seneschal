import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
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
  useMediaQuery,
  useTheme,
} from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { PlayerCard } from "./PlayerCard";
import { ScoreBadge } from "./ScoreBadge";
import { WeightsDialog } from "./WeightsDialog";
import { RatingGuideDialog } from "./RatingGuideDialog";
import { MONEYBALL_PATH, MoneyballTabs } from "./MoneyballTabs";
import { useHideUnrated } from "./prefs";
import {
  fmtScore,
  genderColor,
  ROLE_ABBR,
  ROLE_LABELS,
  ROLES,
  STAT_KEYS,
  type RoleWeights,
  type Weights,
} from "./stats";
import { GenderBadge } from "./GenderBadge";
import { GenderFilter, type GenderFilterValue } from "./GenderFilter";
import type { Board, BoardPlayer, PlayerDetail } from "./types";

type SortKey =
  | "name"
  | "overall"
  | "handler"
  | "cutter"
  | "defender"
  | "raters"
  | "mine";

const hideOnMobile = { display: { xs: "none", sm: "table-cell" } } as const;

/** Consensus scores are masked for players I haven't rated when the pref is on. */
function isMasked(p: BoardPlayer, hideUnrated: boolean): boolean {
  return hideUnrated && p.myRating == null;
}

function sortValue(p: BoardPlayer, key: SortKey, hideUnrated: boolean): number | string | null {
  switch (key) {
    case "name":
      return p.name.toLowerCase();
    case "raters":
      return p.raterCount;
    case "mine":
      return p.myScores?.overall ?? null;
    case "overall":
      // Masked players sort as unrated so the order doesn't leak their scores.
      return isMasked(p, hideUnrated) ? null : p.scores.overall;
    default:
      return isMasked(p, hideUnrated) ? null : p.roles[key];
  }
}

function compare(
  a: BoardPlayer,
  b: BoardPlayer,
  key: SortKey,
  dir: "asc" | "desc",
  hideUnrated: boolean
): number {
  const av = sortValue(a, key, hideUnrated);
  const bv = sortValue(b, key, hideUnrated);
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
 * selected player on the right. On small screens the card instead expands in
 * place, inline under the tapped row, so selecting a player never means
 * scrolling back to the top; tapping the row again collapses it. Selection
 * lives in the URL (/moneyball/:playerId) so cards are linkable either way.
 */
export function MoneyballView({ selectedPlayerId }: { selectedPlayerId: string | null }) {
  const navigate = useNavigate();
  const theme = useTheme();
  /** Below md the card is inline in the table; at md+ it's the side column. */
  const sideCard = useMediaQuery(theme.breakpoints.up("md"));
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState<string>("");
  const [gender, setGender] = useState<GenderFilterValue>("");
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [hideUnrated, setHideUnrated] = useHideUnrated();

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
        (!q || p.name.toLowerCase().includes(q)) &&
        (!team || p.team === team) &&
        (!gender || p.gender === gender)
    );
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir, hideUnrated));
  }, [board, search, team, gender, sortKey, sortDir, hideUnrated]);

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
                    gender: d.gender,
                    number: d.number,
                    raterCount: d.raterCount,
                    stats: d.stats,
                    statCounts: d.statCounts,
                    scores: d.scores,
                    roles: d.roles,
                    myRating: d.myRating,
                    myScores: d.myScores,
                  }
                : p
            ),
          }
        : b
    );
  };

  const applyWeights = (_w: Weights, _rw: RoleWeights) => {
    // Scores are computed server-side with the new weights; refetch.
    void load();
  };

  const myRatedCount = board?.players.filter((p) => p.myRating != null).length ?? 0;

  const header = (
    label: string,
    key: SortKey,
    align: "left" | "right" | "center" = "right",
    sx?: object,
    tooltip?: string
  ) => (
    <TableCell align={align} sx={sx} sortDirection={sortKey === key ? sortDir : false}>
      <Tooltip title={tooltip ?? ""}>
        <TableSortLabel
          active={sortKey === key}
          direction={sortKey === key ? sortDir : "desc"}
          onClick={() => toggleSort(key)}
        >
          {label}
        </TableSortLabel>
      </Tooltip>
    </TableCell>
  );

  if (loading) {
    return (
      <Stack spacing={2}>
        <MoneyballTabs value="players" />
        <Stack alignItems="center" sx={{ mt: 8 }}>
          <CircularProgress />
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <MoneyballTabs value="players" />
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
          <GenderFilter id="moneyball-gender" value={gender} onChange={setGender} />
          <Tooltip
            title="Hide everyone else's ratings for players you haven't rated yet, so your rating isn't anchored by the consensus."
            enterDelay={400}
          >
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={hideUnrated}
                  onChange={(e) => setHideUnrated(e.target.checked)}
                />
              }
              label={
                <Typography variant="body2" noWrap>
                  Hide until I rate
                </Typography>
              }
              sx={{ mr: 0 }}
            />
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<HelpOutlineIcon />}
            onClick={() => setGuideOpen(true)}
          >
            Rating guide
          </Button>
          <Button
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={() => setWeightsOpen(true)}
            disabled={!board}
          >
            Formulas
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
          {selected && sideCard ? (
            <Box sx={{ order: 1, position: "sticky", top: 80 }}>
              <PlayerCard
                key={selected.id}
                player={selected}
                weights={board.weights}
                roleWeights={board.roleWeights}
                masked={isMasked(selected, hideUnrated)}
                onSaved={applyDetail}
                onClose={() => navigate(MONEYBALL_PATH)}
              />
            </Box>
          ) : null}

          <TableContainer
            sx={{
              order: 0,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "background.paper",
            }}
          >
            <Table
              size="small"
              stickyHeader
              sx={{
                // On phones the table must fit the viewport exactly — a
                // horizontally scrolling table would drag the inline player
                // card (a full-width row) along with it. Fixed layout with
                // percentage columns + tighter cell padding gets all five
                // columns into ~360px; names truncate rather than push.
                tableLayout: { xs: "fixed", sm: "auto" },
                "& .MuiTableCell-root": { px: { xs: 0.75, sm: 2 } },
              }}
            >
              <TableHead>
                <TableRow>
                  {header("Player", "name", "left", { width: { xs: "43%", sm: "auto" } })}
                  {header("OVR", "overall", "center", { width: { xs: "15%", sm: "auto" } })}
                  {ROLES.map((r) => (
                    <Fragment key={r}>
                      {header(
                        ROLE_ABBR[r],
                        r,
                        "center",
                        { width: { xs: "14%", sm: "auto" } },
                        `${ROLE_LABELS[r]} OVR — adjust its stat weights from Formulas`
                      )}
                    </Fragment>
                  ))}
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
                  const masked = isMasked(p, hideUnrated);
                  const shown = (v: number | null) => (masked ? null : v);
                  return (
                    <Fragment key={p.id}>
                    <TableRow
                      hover
                      selected={isSelected}
                      // Tapping the selected row again collapses/closes it.
                      onClick={() =>
                        navigate(isSelected ? MONEYBALL_PATH : `${MONEYBALL_PATH}/${p.id}`)
                      }
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ overflow: "hidden" }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              width: 20,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                              // The rank cedes its space to the name on phones.
                              display: { xs: "none", sm: "block" },
                            }}
                          >
                            {i + 1}
                          </Typography>
                          <Avatar
                            src={p.photoUrl ?? undefined}
                            alt={p.name}
                            variant="rounded"
                            sx={{
                              width: 36,
                              height: 36,
                              fontSize: 14,
                              boxShadow: `0 0 0 2px ${genderColor(p.gender)}`,
                            }}
                          >
                            {initials(p.name)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                {p.name}
                              </Typography>
                              <GenderBadge gender={p.gender} />
                            </Stack>
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
                        {masked && p.raterCount > 0 ? (
                          <Tooltip title="Rate this player to see the consensus">
                            <Box component="span" sx={{ display: "inline-flex" }}>
                              <ScoreBadge value={null} size="sm" />
                            </Box>
                          </Tooltip>
                        ) : (
                          <ScoreBadge value={shown(p.scores.overall)} size="sm" />
                        )}
                      </TableCell>
                      {ROLES.map((r) => (
                        <TableCell
                          key={r}
                          align="center"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {fmtScore(shown(p.roles[r]))}
                        </TableCell>
                      ))}
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
                    {/* Small screens: the card expands in place, right under
                        the tapped row, instead of mounting above the table. */}
                    {isSelected && !sideCard ? (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ p: 1, bgcolor: "background.default" }}>
                          <PlayerCard
                            key={p.id}
                            player={p}
                            weights={board.weights}
                            roleWeights={board.roleWeights}
                            masked={masked}
                            onSaved={applyDetail}
                            onClose={() => navigate(MONEYBALL_PATH)}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                    </Fragment>
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

      <RatingGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
      {board ? (
        <WeightsDialog
          open={weightsOpen}
          weights={board.weights}
          roleWeights={board.roleWeights}
          onClose={() => setWeightsOpen(false)}
          onSaved={applyWeights}
        />
      ) : null}
    </Stack>
  );
}
