import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { MONEYBALL_PATH, MoneyballTabs } from "./MoneyballTabs";
import { ScoreBadge } from "./ScoreBadge";
import { MAX_SCORE, MIN_SCORE, fmtScore, scoreTone } from "./stats";
import type { Concentration, TeamSummary } from "./types";

const LINE_SIZE = 7;

const TONE_HEX: Record<ReturnType<typeof scoreTone>, string> = {
  success: "#2e7d32",
  info: "#0288d1",
  warning: "#ed6c02",
  error: "#d32f2f",
  default: "#9e9e9e",
};

const hideOnMobile = { display: { xs: "none", md: "table-cell" } } as const;

function pct(v: number): string {
  return `${((v - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100}%`;
}

/**
 * Pure-CSS box plot on the 1-10 axis: whiskers min→max, box p25→p75, a
 * median line, and a dot for the top-7 mean so the line/bench gap is visible.
 */
function SpreadBar({ c }: { c: Concentration }) {
  return (
    <Tooltip
      title={`min ${fmtScore(c.min)} · p25 ${fmtScore(c.p25)} · median ${fmtScore(
        c.median
      )} · p75 ${fmtScore(c.p75)} · max ${fmtScore(c.max)} · top-7 mean ${fmtScore(c.topMean)}`}
      placement="top"
    >
      <Box sx={{ position: "relative", height: 22, minWidth: 160 }}>
        {/* axis */}
        <Box
          sx={{
            position: "absolute",
            top: 10,
            left: 0,
            right: 0,
            height: 2,
            bgcolor: "divider",
          }}
        />
        {/* whiskers */}
        <Box
          sx={{
            position: "absolute",
            top: 10,
            left: pct(c.min),
            width: `calc(${pct(c.max)} - ${pct(c.min)})`,
            height: 2,
            bgcolor: "text.secondary",
          }}
        />
        {/* box */}
        <Box
          sx={{
            position: "absolute",
            top: 4,
            left: pct(c.p25),
            width: `max(3px, calc(${pct(c.p75)} - ${pct(c.p25)}))`,
            height: 14,
            borderRadius: 0.5,
            bgcolor: "primary.light",
            opacity: 0.6,
          }}
        />
        {/* median */}
        <Box
          sx={{
            position: "absolute",
            top: 2,
            left: `calc(${pct(c.median)} - 1px)`,
            width: 2,
            height: 18,
            bgcolor: "primary.dark",
          }}
        />
        {/* top-7 mean */}
        <Box
          sx={{
            position: "absolute",
            top: 6,
            left: `calc(${pct(c.topMean)} - 5px)`,
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: "success.main",
            border: "2px solid",
            borderColor: "background.paper",
          }}
        />
      </Box>
    </Tooltip>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  const body = (
    <Stack spacing={0.25} sx={{ minWidth: 96 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Stack>
  );
  return hint ? (
    <Tooltip title={hint} placement="top">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

/**
 * Concentration sub-tab: how evenly ability is spread across each roster.
 * Cross-team table with box plots and dispersion stats, overlaid "talent
 * curves" (OVR by roster rank), and a sorted OVR bar chart for one team.
 */
export function ConcentrationView() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await api.moneyballTeams();
      setTeams(res.teams);
      setSelectedName((cur) => cur ?? res.teams.find((t) => t.concentration)?.team ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** Rated teams, most concentrated (highest Gini) first. */
  const rows = useMemo(
    () =>
      (teams ?? [])
        .filter((t) => t.concentration)
        .sort((a, b) => b.concentration!.gini - a.concentration!.gini),
    [teams]
  );
  const unrated = (teams ?? []).filter((t) => !t.concentration);
  const selected = rows.find((t) => t.team === selectedName) ?? rows[0] ?? null;

  const curves = useMemo(() => {
    const maxN = Math.max(0, ...rows.map((t) => t.players.length));
    const ranks = Array.from({ length: maxN }, (_, i) => i + 1);
    const series = rows.map((t, i) => ({
      id: `t${i}`,
      label: t.team,
      data: ranks.map((r) => t.players[r - 1]?.scores.overall ?? null),
      showMark: false,
      connectNulls: false,
    }));
    return { ranks, series };
  }, [rows]);

  const selectedIdx = selected ? rows.indexOf(selected) : -1;

  return (
    <Stack spacing={2}>
      <MoneyballTabs value="concentration" />
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Roster ability concentration
        </Typography>
        <Typography variant="body2" color="text.secondary">
          How much of a team's ability sits in its top players versus its bench. Flat
          curves and low Gini mean depth; steep curves and a big top-7 gap mean the team
          leans on a few stars.
        </Typography>
      </Box>

      {loading ? (
        <Stack alignItems="center" sx={{ mt: 8 }}>
          <CircularProgress />
        </Stack>
      ) : null}

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

      {teams && rows.length === 0 && !loading ? (
        <Alert severity="info">Rate some players first; concentration needs OVRs to compare.</Alert>
      ) : null}

      {rows.length > 0 ? (
        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.paper",
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Team</TableCell>
                <TableCell align="right">Rated</TableCell>
                <TableCell>
                  <Tooltip title="Whiskers min–max, box p25–p75, bar median, green dot top-7 mean. Axis 1–10.">
                    <span>Spread</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">Top 7</TableCell>
                <TableCell align="right">Bench</TableCell>
                <TableCell align="right">
                  <Tooltip title="Top-7 mean minus bench mean">
                    <span>Gap</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={hideOnMobile}>
                  Range
                </TableCell>
                <TableCell align="right" sx={hideOnMobile}>
                  <Tooltip title="Standard deviation of OVR">
                    <span>σ</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Gini of OVR above 1: 0 = perfectly even, 1 = one player has everything">
                    <span>Gini</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((t) => {
                const c = t.concentration!;
                return (
                  <TableRow
                    key={t.team}
                    hover
                    selected={selected?.team === t.team}
                    onClick={() => setSelectedName(t.team)}
                    sx={{ cursor: "pointer", "& td": { fontVariantNumeric: "tabular-nums" } }}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>{t.team}</TableCell>
                    <TableCell align="right">
                      {t.ratedCount}/{t.playerCount}
                    </TableCell>
                    <TableCell sx={{ width: { xs: 160, md: 260 } }}>
                      <SpreadBar c={c} />
                    </TableCell>
                    <TableCell align="right">{fmtScore(c.topMean)}</TableCell>
                    <TableCell align="right">{fmtScore(c.restMean)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {c.topGap == null ? "–" : `+${fmtScore(c.topGap)}`}
                    </TableCell>
                    <TableCell align="right" sx={hideOnMobile}>
                      {fmtScore(c.range)}
                    </TableCell>
                    <TableCell align="right" sx={hideOnMobile}>
                      {c.stdDev.toFixed(2)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {c.gini.toFixed(2)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {unrated.length > 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Typography variant="caption" color="text.secondary">
                      No ratings yet: {unrated.map((t) => t.team).join(", ")}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {rows.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            alignItems: "start",
            gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          }}
        >
          <Stack
            spacing={1}
            sx={{
              p: 2,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "background.paper",
            }}
          >
            <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>
              Talent curves — OVR by roster rank
            </Typography>
            <LineChart
              height={320}
              xAxis={[
                {
                  data: curves.ranks,
                  label: "Roster rank",
                  scaleType: "point",
                  valueFormatter: (v: number) => String(v),
                },
              ]}
              yAxis={[{ min: MIN_SCORE, max: MAX_SCORE }]}
              series={curves.series}
              margin={{ left: 40, right: 20, top: 20, bottom: 60 }}
              slotProps={{ legend: { hidden: rows.length > 8 } }}
              sx={
                selectedIdx >= 0
                  ? {
                      "& .MuiLineElement-root": { opacity: 0.35, strokeWidth: 1.5 },
                      [`& .MuiLineElement-series-t${selectedIdx}`]: {
                        opacity: 1,
                        strokeWidth: 3.5,
                      },
                    }
                  : undefined
              }
            />
            <Typography variant="caption" color="text.secondary">
              Each line is one team, best player on the left. The selected team is bold; the
              vertical span between the left and right ends of a line is its range.
            </Typography>
          </Stack>

          {selected && selected.concentration ? (
            <Stack
              spacing={2}
              sx={{
                p: 2,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                bgcolor: "background.paper",
              }}
            >
              <Stack direction="row" alignItems="center" spacing={2}>
                <ScoreBadge value={selected.scores.overall} label="OVR" size="md" />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                    {selected.team}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selected.concentration.count} rated of {selected.playerCount}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={`Gini ${selected.concentration.gini.toFixed(2)}`}
                  sx={{ fontWeight: 700 }}
                />
              </Stack>

              <Stack direction="row" spacing={3} useFlexGap flexWrap="wrap">
                <Stat
                  label={`Top ${LINE_SIZE}`}
                  value={fmtScore(selected.concentration.topMean)}
                  hint="Mean OVR of the seven best rated players"
                />
                <Stat
                  label="Bench"
                  value={fmtScore(selected.concentration.restMean)}
                  hint="Mean OVR of everyone outside the top seven"
                />
                <Stat
                  label="Gap"
                  value={
                    selected.concentration.topGap == null
                      ? "–"
                      : `+${fmtScore(selected.concentration.topGap)}`
                  }
                  hint="Top-7 mean minus bench mean"
                />
                <Stat
                  label="Range"
                  value={`${fmtScore(selected.concentration.min)}–${fmtScore(selected.concentration.max)}`}
                />
                <Stat label="Median" value={fmtScore(selected.concentration.median)} />
                <Stat label="σ" value={selected.concentration.stdDev.toFixed(2)} />
              </Stack>

              <BarChart
                height={300}
                xAxis={[
                  {
                    data: selected.players.map((p) => p.name),
                    scaleType: "band",
                    tickLabelStyle: { angle: -40, textAnchor: "end", fontSize: 10 },
                    colorMap: {
                      type: "ordinal",
                      values: selected.players.map((p) => p.name),
                      colors: selected.players.map((p, i) =>
                        i < LINE_SIZE ? TONE_HEX[scoreTone(p.scores.overall)] : "#b0bec5"
                      ),
                    },
                  },
                ]}
                yAxis={[{ min: 0, max: MAX_SCORE }]}
                series={[
                  {
                    data: selected.players.map((p) => p.scores.overall ?? 0),
                    label: "OVR",
                    valueFormatter: (v) => fmtScore(v),
                  },
                ]}
                onItemClick={(_e, item) => {
                  const p = selected.players[item.dataIndex];
                  if (p) navigate(`${MONEYBALL_PATH}/${p.playerId}`);
                }}
                margin={{ left: 40, right: 10, top: 10, bottom: 90 }}
                slotProps={{ legend: { hidden: true } }}
              />
              <Typography variant="caption" color="text.secondary">
                Rated players sorted by OVR; the top seven are coloured by rating band, the
                bench is grey. Click a bar to open the card.
              </Typography>
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
