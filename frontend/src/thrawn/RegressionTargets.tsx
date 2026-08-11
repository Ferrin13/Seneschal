import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type {
  RegressionReport,
  RegressionRow,
  ThrawnTeam,
  ValuationResult,
} from "./types";
import { fmtPts, positionColor, teamLabel } from "./format";
import { PlayerDetailDrawer } from "./PlayerDetailDrawer";

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

const PHASE_LABELS: Record<string, string> = {
  pass: "Passing",
  rush: "Rushing",
  rec: "Receiving",
};

function phaseTooltip(row: RegressionRow): string {
  return row.phases
    .map((p) => {
      const parts = [
        `${p.actualTd} TD vs ${p.expTd.toFixed(1)} expected`,
        `${p.actualYd} yds vs ${p.expYd.toFixed(0)} expected`,
      ];
      if (p.actualRec != null && p.expRec != null) {
        parts.push(`${p.actualRec} rec vs ${p.expRec.toFixed(0)} expected`);
      }
      return `${PHASE_LABELS[p.phase]} (${p.volume} opp, ${p.rzVolume} RZ): ${parts.join(", ")}`;
    })
    .join(" · ");
}

function RegressionTable({
  rows,
  teamByPlayer,
  projPpgByPlayer,
  positive,
  onSelect,
}: {
  rows: RegressionRow[];
  teamByPlayer: Map<string, string>;
  projPpgByPlayer: Map<string, number>;
  positive: boolean;
  onSelect: (row: RegressionRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No qualifying players.
      </Typography>
    );
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            <TableCell align="right">GP</TableCell>
            <TableCell align="right">
              <Tooltip title="Actual touchdowns vs expected from overall + red-zone volume">
                <span>TD vs exp</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Actual yards minus expected from opportunities at the cohort rate">
                <span>Yds Δ</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="League-scored points per game above/below volume expectation">
                <span>Luck PPG</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="This season's projected points per game">
                <span>Proj PPG</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const tdActual = r.phases.reduce((s, p) => s + p.actualTd, 0);
            const tdExp = r.phases.reduce((s, p) => s + p.expTd, 0);
            const ydDelta = r.phases.reduce(
              (s, p) => s + (p.actualYd - p.expYd),
              0
            );
            const proj = projPpgByPlayer.get(r.playerId);
            return (
              <TableRow
                key={r.playerId}
                hover
                onClick={() => onSelect(r)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Chip
                      label={r.position}
                      size="small"
                      sx={{
                        bgcolor: positionColor(r.position),
                        color: "#fff",
                        fontWeight: 700,
                        height: 20,
                        fontSize: "0.65rem",
                      }}
                    />
                    <Tooltip title={phaseTooltip(r)}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {r.name}
                      </Typography>
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {teamByPlayer.get(r.playerId) ?? "FA"}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {r.gp}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {tdActual} vs {tdExp.toFixed(1)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {ydDelta >= 0 ? "+" : ""}
                  {ydDelta.toFixed(0)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    ...numSx,
                    fontWeight: 700,
                    color: positive ? "#EF6C00" : "#2E7D32",
                  }}
                >
                  {r.deltaPtsPerGame >= 0 ? "+" : ""}
                  {fmtPts(r.deltaPtsPerGame)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {proj != null ? fmtPts(proj) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * Regression/progression targets: players whose last-season TDs, yards, or
 * receptions deviated from what their volume predicts. Overperformers are
 * sell-high (regression) candidates; underperformers are buy-low
 * (progression) candidates.
 */
export function RegressionTargets({
  leagueId,
  teams,
  valuation,
}: {
  leagueId: string;
  teams: ThrawnTeam[];
  valuation: ValuationResult;
}) {
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState<string>("ALL");
  const [minPpg, setMinPpg] = useState<number>(5);
  const [rosteredOnly, setRosteredOnly] = useState(false);
  const [selected, setSelected] = useState<RegressionRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .thrawnLeagueRegression(leagueId, season ?? undefined)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load analysis"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, season]);

  const teamByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      for (const pid of t.players) map.set(pid, teamLabel(t));
    }
    return map;
  }, [teams]);

  const valueById = useMemo(
    () => new Map(valuation.values.map((v) => [v.playerId, v])),
    [valuation]
  );
  const projPpgByPlayer = useMemo(
    () => new Map(valuation.values.map((v) => [v.playerId, v.ppg])),
    [valuation]
  );

  const { regression, progression } = useMemo(() => {
    const rows = (report?.rows ?? []).filter((r) => {
      if (position !== "ALL" && r.position !== position) return false;
      // Relevance: this season's projection. Players with no projection
      // (retired, out of the league) count as 0 and drop with any floor.
      if ((projPpgByPlayer.get(r.playerId) ?? 0) < minPpg) return false;
      if (rosteredOnly && !teamByPlayer.has(r.playerId)) return false;
      return true;
    });
    return {
      regression: rows.filter((r) => r.deltaPtsPerGame > 0).slice(0, 15),
      progression: rows
        .filter((r) => r.deltaPtsPerGame < 0)
        .sort((a, b) => a.deltaPtsPerGame - b.deltaPtsPerGame)
        .slice(0, 15),
    };
  }, [report, position, minPpg, rosteredOnly, projPpgByPlayer, teamByPlayer]);

  if (loading && !report) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!report) return null;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
          Players whose {report.season} production deviated from what their
          volume predicts. Expected TDs come from overall + red-zone
          opportunities at league-wide positional rates; expected yards and
          receptions from per-opportunity cohort rates. The delta is priced in
          your league's scoring — big overperformance tends to regress, big
          underperformance tends to bounce back.
        </Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="regression-season-label">Season</InputLabel>
          <Select
            labelId="regression-season-label"
            label="Season"
            value={report.season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {report.availableSeasons.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ sm: "center" }}
      >
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel id="regression-pos-label">Position</InputLabel>
          <Select
            labelId="regression-pos-label"
            label="Position"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            {["ALL", "QB", "RB", "WR", "TE"].map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel id="regression-ppg-label">Min proj PPG (this yr)</InputLabel>
          <Select
            labelId="regression-ppg-label"
            label="Min proj PPG (this yr)"
            value={minPpg}
            onChange={(e) => setMinPpg(Number(e.target.value))}
          >
            <MenuItem value={0}>Any player</MenuItem>
            <MenuItem value={5}>5+ (fantasy relevant)</MenuItem>
            <MenuItem value={8}>8+ (roster worthy)</MenuItem>
            <MenuItem value={10}>10+ (startable)</MenuItem>
            <MenuItem value={13}>13+ (weekly starter)</MenuItem>
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={rosteredOnly}
              onChange={(e) => setRosteredOnly(e.target.checked)}
            />
          }
          label={<Typography variant="body2">Rostered only</Typography>}
        />
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, pt: 1.5 }}
            >
              <TrendingDownIcon sx={{ color: "#EF6C00" }} />
              <Typography variant="subtitle1" fontWeight={700}>
                Regression candidates
              </Typography>
              <Typography variant="caption" color="text.secondary">
                outperformed their volume — sell high
              </Typography>
            </Stack>
            <RegressionTable
              rows={regression}
              teamByPlayer={teamByPlayer}
              projPpgByPlayer={projPpgByPlayer}
              positive
              onSelect={setSelected}
            />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, pt: 1.5 }}
            >
              <TrendingUpIcon sx={{ color: "#2E7D32" }} />
              <Typography variant="subtitle1" fontWeight={700}>
                Progression candidates
              </Typography>
              <Typography variant="caption" color="text.secondary">
                underperformed their volume — buy low
              </Typography>
            </Stack>
            <RegressionTable
              rows={progression}
              teamByPlayer={teamByPlayer}
              projPpgByPlayer={projPpgByPlayer}
              positive={false}
              onSelect={setSelected}
            />
          </Paper>
        </Grid>
      </Grid>

      <Typography variant="caption" color="text.secondary">
        Hover a player for the phase-by-phase breakdown (passing, rushing,
        receiving). Minimum volume: 100 pass attempts, 25 carries, or 30
        targets. Yardage deltas partly reflect real skill, so weigh the TD
        component most — TD rate over expectation is the least sticky stat
        year to year. Click a player for full details.
      </Typography>

      <PlayerDetailDrawer
        open={selected != null}
        onClose={() => setSelected(null)}
        leagueId={leagueId}
        player={selected ? (valueById.get(selected.playerId) ?? null) : null}
        fallback={selected}
        teamName={selected ? (teamByPlayer.get(selected.playerId) ?? null) : null}
      />
    </Stack>
  );
}
