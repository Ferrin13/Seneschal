import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatDuration, formatDurationLong, PHASE_LABELS } from "./format";
import type { Faction, LazaxStats } from "./types";

export function StatsView({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<LazaxStats | null>(null);
  const [factions, setFactions] = useState<Record<string, Faction>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, f] = await Promise.all([
          api.lazaxStats(gameId),
          api.lazaxFactions(),
        ]);
        if (cancelled) return;
        setStats(s);
        setFactions(Object.fromEntries(f.factions.map((x) => [x.id, x])));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load stats");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const playerSeries = useMemo(() => {
    if (!stats) return null;
    const ids = stats.players.map((p) => p.id);
    return {
      labels: stats.players.map((p) => p.displayName),
      values: ids.map((id) => (stats.byPlayer[id] ?? 0) / 60000),
      colors: stats.players.map(
        (p) => factions[p.factionId]?.color ?? "#888"
      ),
    };
  }, [stats, factions]);

  const phaseSeries = useMemo(() => {
    if (!stats) return null;
    const phases = ["strategy", "action", "status", "agenda"] as const;
    return {
      labels: phases.map((p) => PHASE_LABELS[p] ?? p),
      values: phases.map((p) => (stats.byPhase[p] ?? 0) / 60000),
    };
  }, [stats]);

  const roundSeries = useMemo(() => {
    if (!stats) return null;
    const rounds = Object.keys(stats.byRound)
      .map(Number)
      .sort((a, b) => a - b);
    return {
      labels: rounds.map((r) => `R${r}`),
      values: rounds.map((r) => (stats.byRound[r] ?? 0) / 60000),
    };
  }, [stats]);

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ mt: 6 }}>
        <CircularProgress />
      </Stack>
    );
  }
  if (error || !stats) {
    return <Alert severity="error">{error ?? "No data"}</Alert>;
  }

  return (
    <Stack spacing={4}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Typography variant="h4">Time breakdown</Typography>
          <Typography color="text.secondary">{stats.game.name}</Typography>
        </Box>
        <Button onClick={() => navigate(`/lazax/${gameId}`)}>Back to game</Button>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <StatTile label="Total time" value={formatDurationLong(stats.totalMs)} />
        <StatTile
          label="General / paused"
          value={formatDurationLong(stats.generalMs)}
        />
        <StatTile
          label="Player time"
          value={formatDurationLong(stats.totalMs - stats.generalMs)}
        />
      </Stack>

      {playerSeries && playerSeries.labels.length > 0 ? (
        <ChartBlock title="By player (minutes)">
          <BarChart
            height={280}
            xAxis={[{ data: playerSeries.labels, scaleType: "band" }]}
            series={[
              {
                data: playerSeries.values,
                label: "Minutes",
                color: "#8B7355",
              },
            ]}
            margin={{ left: 50, right: 20, top: 20, bottom: 40 }}
          />
        </ChartBlock>
      ) : null}

      {phaseSeries ? (
        <ChartBlock title="By phase (minutes)">
          <BarChart
            height={240}
            xAxis={[{ data: phaseSeries.labels, scaleType: "band" }]}
            series={[
              {
                data: phaseSeries.values,
                label: "Minutes",
                color: "#5C4B7A",
              },
            ]}
            margin={{ left: 50, right: 20, top: 20, bottom: 40 }}
          />
        </ChartBlock>
      ) : null}

      {roundSeries && roundSeries.labels.length > 0 ? (
        <ChartBlock title="By round (minutes)">
          <BarChart
            height={240}
            xAxis={[{ data: roundSeries.labels, scaleType: "band" }]}
            series={[
              {
                data: roundSeries.values,
                label: "Minutes",
                color: "#3D6B5A",
              },
            ]}
            margin={{ left: 50, right: 20, top: 20, bottom: 40 }}
          />
        </ChartBlock>
      ) : null}

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Turn segments
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Round</TableCell>
              <TableCell>Phase</TableCell>
              <TableCell>Player</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell align="right">Duration</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[...stats.segments].reverse().map((s) => {
              const player = stats.players.find((p) => p.id === s.playerId);
              return (
                <TableRow key={s.segmentId}>
                  <TableCell>{s.roundNumber}</TableCell>
                  <TableCell>{PHASE_LABELS[s.phase] ?? s.phase}</TableCell>
                  <TableCell>{player?.displayName ?? "—"}</TableCell>
                  <TableCell>{s.kind}</TableCell>
                  <TableCell align="right">
                    {formatDuration(s.durationMs)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 2.5,
        borderRadius: 2,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

function ChartBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
