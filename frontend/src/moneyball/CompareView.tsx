import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { MONEYBALL_PATH, MoneyballTabs } from "./MoneyballTabs";
import { useHideUnrated } from "./prefs";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  MAX_SCORE,
  MIN_SCORE,
  STATS,
  fmtScore,
  genderColor,
  meansFromScores,
  score,
  scoreTone,
  statsInCategory,
  type Scores,
  type StatKey,
} from "./stats";
import { GenderBadge } from "./GenderBadge";
import { GenderFilter, type GenderFilterValue } from "./GenderFilter";
import type { Board, BoardPlayer, PlayerDetail } from "./types";

/** Column headers are tight; these fit in ~60px. Full label is in the tooltip. */
const SHORT_LABELS: Record<StatKey, string> = {
  short_handling: "PosH",
  huck_handling: "Huck",
  short_cutting: "PosC",
  deep_cutting: "Deep",
  decision_making: "Dec",
  handler_marking: "HMk",
  cutter_marking: "CMk",
  verticality: "Vert",
  agility: "Agil",
  team_chemistry: "Chem",
  effort: "Eff",
  game_iq: "IQ",
};

/** Where a brand-new rating lands when you press + on an unrated cell. */
const START_SCORE = 5;

const SAVE_DEBOUNCE_MS = 600;

/** Height of the category band row; the stat header row sticks just below it. */
const BAND_HEIGHT = 32;

type SortKey = "name" | "overall" | StatKey;

const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
  default: "text.disabled",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function myValue(p: BoardPlayer, key: SortKey): number | string | null {
  if (key === "name") return p.name.toLowerCase();
  if (key === "overall") return p.myScores?.overall ?? null;
  return p.myRating?.[key] ?? null;
}

function compare(a: BoardPlayer, b: BoardPlayer, key: SortKey, dir: "asc" | "desc"): number {
  const av = myValue(a, key);
  const bv = myValue(b, key);
  // Unrated always sinks to the bottom regardless of direction.
  if (av == null && bv == null) return a.name.localeCompare(b.name);
  if (av == null) return 1;
  if (bv == null) return -1;
  let c: number;
  if (typeof av === "string" && typeof bv === "string") c = av.localeCompare(bv);
  else c = (av as number) - (bv as number);
  // Ties: fall back to my OVR, then name, so equal scores still have a stable order.
  if (c === 0 && key !== "overall") {
    c = (a.myScores?.overall ?? 0) - (b.myScores?.overall ?? 0);
  }
  if (c === 0) return a.name.localeCompare(b.name);
  return dir === "asc" ? c : -c;
}

/** One editable cell: [-] value [+]. */
function StatCell({
  value,
  consensus,
  active,
  disabled,
  onChange,
}: {
  value: number | undefined;
  consensus: number | null;
  active: boolean;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const canDec = value != null && value > MIN_SCORE;
  const canInc = value == null || value < MAX_SCORE;
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      spacing={0}
      sx={{
        borderRadius: 1,
        bgcolor: active ? "action.selected" : "transparent",
        px: 0.25,
      }}
    >
      <IconButton
        size="small"
        aria-label="Decrease"
        disabled={disabled || !canDec}
        onClick={(e) => {
          e.stopPropagation();
          if (value != null) onChange(value - 1);
        }}
        sx={{ p: 0.25 }}
      >
        <RemoveIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <Tooltip
        title={consensus != null ? `Consensus ${fmtScore(consensus)}` : ""}
        enterDelay={500}
        disableHoverListener={consensus == null}
      >
        <Typography
          variant="body2"
          sx={{
            width: 22,
            textAlign: "center",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: value == null ? "text.disabled" : TONE_COLOR[scoreTone(value)],
          }}
        >
          {value ?? "–"}
        </Typography>
      </Tooltip>
      <IconButton
        size="small"
        aria-label={value == null ? `Rate (starts at ${START_SCORE})` : "Increase"}
        disabled={disabled || !canInc}
        onClick={(e) => {
          e.stopPropagation();
          onChange(value == null ? START_SCORE : value + 1);
        }}
        sx={{ p: 0.25 }}
      >
        <AddIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Stack>
  );
}

/**
 * Compare tab: every player × every stat, using *my* ratings, sortable by any
 * column, with +/- on each cell to nudge a score. Sort by one stat and scan
 * down to check the ordering makes sense; fix outliers in place. Edits are
 * applied optimistically and saved per player after a short debounce.
 */
export function CompareView() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState<string>("");
  const [gender, setGender] = useState<GenderFilterValue>("");
  const [onlyRated, setOnlyRated] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Respect the Players-tab "hide until I rate" preference for the consensus tooltips.
  const [hideUnrated] = useHideUnrated();

  // Per-player debounced save. The latest draft wins; the timer is reset on
  // every click so a run of +++ becomes one PUT.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const drafts = useRef<Map<string, Scores>>(new Map());

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

  // Flush any pending saves if the user navigates away mid-debounce.
  useEffect(() => {
    return () => {
      for (const [id, t] of timers.current) {
        clearTimeout(t);
        const draft = drafts.current.get(id);
        if (draft) void api.moneyballSetRating(id, draft).catch(() => {});
      }
      timers.current.clear();
      drafts.current.clear();
    };
  }, []);

  const applyDetail = useCallback((d: PlayerDetail) => {
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
  }, []);

  const scheduleSave = useCallback(
    (playerId: string, draft: Scores) => {
      drafts.current.set(playerId, draft);
      const existing = timers.current.get(playerId);
      if (existing) clearTimeout(existing);
      timers.current.set(
        playerId,
        setTimeout(() => {
          timers.current.delete(playerId);
          const latest = drafts.current.get(playerId);
          drafts.current.delete(playerId);
          if (!latest) return;
          setPending((s) => new Set(s).add(playerId));
          api
            .moneyballSetRating(playerId, latest)
            .then((d) => {
              // Don't clobber a newer optimistic draft that's still debouncing.
              if (!drafts.current.has(playerId)) applyDetail(d);
            })
            .catch((err) => {
              setSaveError(err instanceof ApiError ? err.message : "Failed to save rating");
              void load();
            })
            .finally(() => {
              setPending((s) => {
                const next = new Set(s);
                next.delete(playerId);
                return next;
              });
            });
        }, SAVE_DEBOUNCE_MS)
      );
    },
    [applyDetail, load]
  );

  const adjust = (p: BoardPlayer, stat: StatKey, next: number) => {
    if (!board) return;
    const base = drafts.current.get(p.id) ?? p.myRating ?? {};
    const draft: Scores = { ...base, [stat]: next };
    // Optimistic: my rating + my OVR update instantly using the shared weights.
    const myScores = score(meansFromScores(draft), board.weights);
    setBoard((b) =>
      b
        ? {
            ...b,
            players: b.players.map((q) =>
              q.id === p.id ? { ...q, myRating: draft, myScores } : q
            ),
          }
        : b
    );
    scheduleSave(p.id, draft);
  };

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
        (!gender || p.gender === gender) &&
        (!onlyRated || p.myRating != null)
    );
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [board, search, team, gender, onlyRated, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const myRatedCount = board?.players.filter((p) => p.myRating != null).length ?? 0;
  const sortedStat = STATS.find((s) => s.key === sortKey);

  if (loading) {
    return (
      <Stack spacing={2}>
        <MoneyballTabs value="compare" />
        <Stack alignItems="center" sx={{ mt: 8 }}>
          <CircularProgress />
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <MoneyballTabs value="compare" />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Compare
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your ratings only · sort by a stat and fix the order in place
            {board ? ` · you've rated ${myRatedCount} of ${board.players.length}` : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 180 }}
          />
          {teams.length > 0 ? (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="moneyball-compare-team-label">Team</InputLabel>
              <Select
                labelId="moneyball-compare-team-label"
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
          <GenderFilter id="moneyball-compare-gender" value={gender} onChange={setGender} />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={onlyRated}
                onChange={(e) => setOnlyRated(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2" noWrap>
                Only players I've rated
              </Typography>
            }
            sx={{ mr: 0 }}
          />
        </Stack>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {sortedStat ? (
        <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
          <strong>{sortedStat.label}</strong> — {sortedStat.description}
        </Alert>
      ) : null}

      {board ? (
        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.paper",
            maxHeight: "calc(100vh - 280px)",
          }}
        >
          <Table size="small" stickyHeader sx={{ minWidth: 1100 }}>
            <TableHead>
              {/* Category band */}
              <TableRow>
                <TableCell
                  rowSpan={2}
                  sx={{
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    bgcolor: "background.paper",
                    minWidth: 200,
                  }}
                  sortDirection={sortKey === "name" ? sortDir : false}
                >
                  <TableSortLabel
                    active={sortKey === "name"}
                    direction={sortKey === "name" ? sortDir : "asc"}
                    onClick={() => toggleSort("name")}
                  >
                    Player
                  </TableSortLabel>
                </TableCell>
                <TableCell
                  rowSpan={2}
                  align="center"
                  sortDirection={sortKey === "overall" ? sortDir : false}
                >
                  <Tooltip title="OVR from your rating alone">
                    <TableSortLabel
                      active={sortKey === "overall"}
                      direction={sortKey === "overall" ? sortDir : "desc"}
                      onClick={() => toggleSort("overall")}
                    >
                      OVR
                    </TableSortLabel>
                  </Tooltip>
                </TableCell>
                {CATEGORIES.map((c) => (
                  <TableCell
                    key={c}
                    align="center"
                    colSpan={statsInCategory(c).length}
                    sx={{
                      borderLeft: "1px solid",
                      borderColor: "divider",
                      py: 0,
                      height: BAND_HEIGHT,
                      top: 0,
                    }}
                  >
                    <Typography
                      variant="overline"
                      sx={{ fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.5 }}
                    >
                      {CATEGORY_LABELS[c]}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
              {/* Stat headers */}
              <TableRow>
                {CATEGORIES.map((c) =>
                  statsInCategory(c).map((s, i) => (
                    <TableCell
                      key={s.key}
                      align="center"
                      sortDirection={sortKey === s.key ? sortDir : false}
                      sx={{
                        top: BAND_HEIGHT,
                        px: 0.5,
                        borderLeft: i === 0 ? "1px solid" : undefined,
                        borderColor: "divider",
                        bgcolor: sortKey === s.key ? "action.selected" : "background.paper",
                      }}
                    >
                      <Tooltip title={`${s.label} — ${s.description}`} placement="top">
                        <TableSortLabel
                          active={sortKey === s.key}
                          direction={sortKey === s.key ? sortDir : "desc"}
                          onClick={() => toggleSort(s.key)}
                          sx={{ fontSize: 12, fontWeight: 700 }}
                        >
                          {SHORT_LABELS[s.key]}
                        </TableSortLabel>
                      </Tooltip>
                    </TableCell>
                  ))
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {players.map((p, i) => {
                const saving = pending.has(p.id);
                return (
                  <TableRow key={p.id} hover>
                    <TableCell
                      sx={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        bgcolor: "background.paper",
                        cursor: "pointer",
                      }}
                      onClick={() => navigate(`${MONEYBALL_PATH}/${p.id}`)}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
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
                          sx={{
                            width: 28,
                            height: 28,
                            fontSize: 12,
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
                          {p.team ? (
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              {p.team}
                            </Typography>
                          ) : null}
                        </Box>
                        {saving ? <CircularProgress size={12} sx={{ ml: "auto" }} /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        variant="outlined"
                        color={p.myScores ? "primary" : "default"}
                        label={fmtScore(p.myScores?.overall)}
                        sx={{ fontWeight: 700, minWidth: 44 }}
                      />
                    </TableCell>
                    {CATEGORIES.map((c) =>
                      statsInCategory(c).map((s, j) => (
                        <TableCell
                          key={s.key}
                          align="center"
                          sx={{
                            px: 0.5,
                            py: 0.25,
                            borderLeft: j === 0 ? "1px solid" : undefined,
                            borderColor: "divider",
                          }}
                        >
                          <StatCell
                            value={p.myRating?.[s.key]}
                            consensus={
                              hideUnrated && p.myRating == null ? null : p.stats[s.key]
                            }
                            active={sortKey === s.key}
                            disabled={false}
                            onChange={(next) => adjust(p, s.key, next)}
                          />
                        </TableCell>
                      ))
                    )}
                  </TableRow>
                );
              })}
              {players.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2 + STATS.length}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ py: 2, textAlign: "center" }}
                    >
                      {board.players.length === 0
                        ? "No players yet."
                        : onlyRated && myRatedCount === 0
                          ? "You haven't rated anyone yet — turn off the filter and press + on a stat to start."
                          : "No players match."}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <Snackbar
        open={saveError != null}
        autoHideDuration={6000}
        onClose={() => setSaveError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setSaveError(null)} variant="filled">
          {saveError}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
