import {
  Alert,
  Avatar,
  Box,
  Card,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { GameState, LiveBoard, LivePlayer, LiveTeam } from "./types";
import { fmtPts, positionColor, sleeperAvatarUrl } from "./format";

/** Poll cadence: brisk while any NFL game is in progress, relaxed otherwise. */
const LIVE_POLL_MS = 30_000;
const IDLE_POLL_MS = 180_000;
const MAX_WEEK = 18;

const STATE_COLORS: Record<GameState, string> = {
  live: "success.main",
  final: "text.disabled",
  pre: "info.main",
  bye: "text.disabled",
};

const STATE_LABELS: Record<GameState, string> = {
  live: "In progress",
  final: "Final",
  pre: "Not started",
  bye: "No game",
};

function liveTeamLabel(t: LiveTeam): string {
  return t.teamName || t.displayName || `Roster ${t.rosterId}`;
}

function opponentLabel(p: LivePlayer): string {
  if (!p.opponent) return p.gameState === "bye" && p.playerId ? "BYE" : "";
  return `${p.home ? "vs" : "@"} ${p.opponent}`;
}

function StateDot({ state }: { state: GameState }) {
  return (
    <Tooltip title={STATE_LABELS[state]}>
      <Box
        component="span"
        sx={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: STATE_COLORS[state],
          flexShrink: 0,
          ...(state === "live"
            ? {
                animation: "thrawnPulse 1.6s ease-in-out infinite",
                "@keyframes thrawnPulse": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.35 },
                },
              }
            : {}),
        }}
      />
    </Tooltip>
  );
}

function PlayerRow({ p }: { p: LivePlayer }) {
  const empty = p.playerId === "";
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr) 56px",
        alignItems: "center",
        columnGap: 1,
        py: 0.6,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: p.gameState === "final" || empty ? 0.75 : 1,
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: 0.5 }}
      >
        {p.slot}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          {!empty ? <StateDot state={p.gameState} /> : null}
          <Typography
            variant="body2"
            noWrap
            sx={{ fontWeight: 600, fontStyle: empty ? "italic" : "normal" }}
          >
            {p.name}
          </Typography>
          {p.position ? (
            <Typography
              variant="caption"
              sx={{ color: positionColor(p.position), fontWeight: 700 }}
            >
              {p.position}
            </Typography>
          ) : null}
          {p.team ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {p.team} {opponentLabel(p)}
            </Typography>
          ) : null}
          {p.injuryStatus ? (
            <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>
              {p.injuryStatus.slice(0, 3).toUpperCase()}
            </Typography>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {p.statLine ||
            (empty
              ? ""
              : p.gameState === "pre"
                ? `proj ${fmtPts(p.projected)}`
                : p.gameState === "bye"
                  ? "No game this week"
                  : "—")}
        </Typography>
      </Box>
      <Box sx={{ textAlign: "right" }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: p.gameState === "live" ? "success.main" : "text.primary",
          }}
        >
          {empty ? "—" : fmtPts(p.points)}
        </Typography>
        {!empty && p.gameState !== "final" && p.gameState !== "bye" ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: "tabular-nums" }}
          >
            {fmtPts(p.projectedFinal)}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function TeamColumn({
  team,
  mine,
  leading,
  showBench,
}: {
  team: LiveTeam;
  mine: boolean;
  leading: boolean;
  showBench: boolean;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
        <Avatar
          src={sleeperAvatarUrl(team.avatar)}
          sx={{ width: 36, height: 36, fontSize: "0.9rem" }}
        >
          {liveTeamLabel(team).slice(0, 1)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography noWrap sx={{ fontWeight: 700 }}>
              {liveTeamLabel(team)}
            </Typography>
            {mine ? <Chip size="small" color="secondary" label="You" sx={{ height: 18 }} /> : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {team.inPlay > 0 ? `${team.inPlay} playing · ` : ""}
            {team.yetToPlay} to play · proj {fmtPts(team.projectedFinal)}
          </Typography>
        </Box>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: leading ? "text.primary" : "text.secondary",
          }}
        >
          {fmtPts(team.points)}
        </Typography>
      </Stack>
      {team.starters.map((p, i) => (
        <PlayerRow key={`${p.slot}-${p.playerId || i}`} p={p} />
      ))}
      {showBench && team.bench.length > 0 ? (
        <>
          <Typography
            variant="overline"
            sx={{ display: "block", mt: 1.25, color: "text.secondary", letterSpacing: 2 }}
          >
            Bench
          </Typography>
          {team.bench.map((p) => (
            <PlayerRow key={p.playerId} p={p} />
          ))}
        </>
      ) : null}
    </Box>
  );
}

function MatchupCard({
  teams,
  myRosterId,
  defaultOpen,
}: {
  teams: LiveTeam[];
  myRosterId: number | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showBench, setShowBench] = useState(false);
  const top = Math.max(...teams.map((t) => t.points));
  return (
    <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr auto 1fr" },
          alignItems: "center",
          gap: 1,
          cursor: "pointer",
        }}
      >
        {teams.map((t, i) => (
          <Stack
            key={t.rosterId}
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent={i === 1 ? { xs: "flex-start", sm: "flex-end" } : "flex-start"}
            sx={{ minWidth: 0, gridColumn: i === 1 ? { xs: "1", sm: "3" } : "1" }}
          >
            {i === 1 ? (
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  order: { xs: 2, sm: 0 },
                  ml: { xs: "auto", sm: 0 },
                  color: t.points >= top ? "text.primary" : "text.secondary",
                }}
              >
                {fmtPts(t.points)}
              </Typography>
            ) : null}
            <Avatar src={sleeperAvatarUrl(t.avatar)} sx={{ width: 28, height: 28, fontSize: "0.8rem" }}>
              {liveTeamLabel(t).slice(0, 1)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: t.rosterId === myRosterId ? 700 : 500 }}>
                {liveTeamLabel(t)}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                proj {fmtPts(t.projectedFinal)} · {t.yetToPlay} to play
              </Typography>
            </Box>
            {i === 0 ? (
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  ml: "auto !important",
                  color: t.points >= top ? "text.primary" : "text.secondary",
                }}
              >
                {fmtPts(t.points)}
              </Typography>
            ) : null}
          </Stack>
        ))}
        {teams.length === 2 ? (
          <Box
            sx={{
              display: { xs: "none", sm: "flex" },
              gridColumn: "2",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              vs
            </Typography>
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                color: "text.secondary",
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform 150ms",
              }}
            />
          </Box>
        ) : null}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box
          sx={{
            mt: 2,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: teams.length === 2 ? "1fr 1fr" : "1fr" },
            gap: { xs: 2.5, md: 3 },
          }}
        >
          {teams.map((t) => (
            <TeamColumn
              key={t.rosterId}
              team={t}
              mine={t.rosterId === myRosterId}
              leading={t.points >= top}
              showBench={showBench}
            />
          ))}
        </Box>
        <Box sx={{ mt: 1 }}>
          <Chip
            size="small"
            variant="outlined"
            label={showBench ? "Hide bench" : "Show bench"}
            onClick={() => setShowBench((v) => !v)}
          />
        </Box>
      </Collapse>
    </Card>
  );
}

/**
 * Live matchup scoreboard for one week. Sleeper has no push feed, so the
 * backend polls its public endpoints and this view re-fetches on a timer:
 * every 30s while any NFL game is in progress, every 3 min otherwise, and
 * immediately whenever the tab regains focus.
 */
export function LiveScoring({
  leagueId,
  myRosterId,
}: {
  leagueId: string;
  myRosterId: number | null;
}) {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anyLive = board?.anyLive ?? false;
  // The poller reads the latest week without re-arming on every load.
  const weekRef = useRef(week);
  weekRef.current = week;

  const load = useCallback(
    async (target: number | null, quiet: boolean) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await api.thrawnLeagueLive(leagueId, target ?? undefined);
        setBoard(next);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load live scores");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [leagueId]
  );

  useEffect(() => {
    void load(week, false);
  }, [load, week]);

  // Re-armed whenever the live flag flips, so the cadence tracks kickoffs
  // and finals without waiting out a stale idle interval.
  useEffect(() => {
    const interval = anyLive ? LIVE_POLL_MS : IDLE_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(weekRef.current, true);
    }, interval);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(weekRef.current, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, anyLive]);

  if (loading && !board) return <CircularProgress />;
  if (!board) return <Alert severity="error">{error ?? "Failed to load live scores"}</Alert>;

  const liveCount = board.games.filter((g) => g.state === "live").length;
  const finalCount = board.games.filter((g) => g.state === "final").length;
  const status =
    liveCount > 0
      ? `${liveCount} game${liveCount === 1 ? "" : "s"} in progress`
      : board.games.length > 0 && finalCount === board.games.length
        ? "All games final"
        : finalCount > 0
          ? `${finalCount} of ${board.games.length} games final`
          : "Waiting for kickoff";

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <IconButton
          size="small"
          aria-label="Previous week"
          disabled={board.week <= 1}
          onClick={() => setWeek(board.week - 1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="h6" sx={{ fontWeight: 600, minWidth: 90, textAlign: "center" }}>
          Week {board.week}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next week"
          disabled={board.week >= MAX_WEEK}
          onClick={() => setWeek(board.week + 1)}
        >
          <ChevronRightIcon />
        </IconButton>
        <Chip
          size="small"
          color={liveCount > 0 ? "success" : "default"}
          variant={liveCount > 0 ? "filled" : "outlined"}
          label={status}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Updated {new Date(board.fetchedAt).toLocaleTimeString()}
        </Typography>
        <Tooltip title="Refresh now">
          <span>
            <IconButton
              size="small"
              aria-label="Refresh"
              disabled={refreshing}
              onClick={() => void load(week, true)}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error ? <Alert severity="warning">{error}</Alert> : null}

      {board.games.length > 0 ? (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {board.games.map((g) => (
            <Chip
              key={g.gameId}
              size="small"
              variant={g.state === "live" ? "filled" : "outlined"}
              color={g.state === "live" ? "success" : "default"}
              sx={{ opacity: g.state === "final" ? 0.6 : 1 }}
              label={`${g.away} @ ${g.home}`}
            />
          ))}
        </Stack>
      ) : null}

      {board.matchups.length === 0 ? (
        <Alert severity="info">No matchups for this week.</Alert>
      ) : (
        board.matchups.map((m, i) => (
          <MatchupCard
            key={m.matchupId ?? `solo-${m.teams[0]?.rosterId ?? i}`}
            teams={m.teams}
            myRosterId={myRosterId}
            defaultOpen={
              myRosterId != null
                ? m.teams.some((t) => t.rosterId === myRosterId)
                : i === 0
            }
          />
        ))
      )}
    </Stack>
  );
}
