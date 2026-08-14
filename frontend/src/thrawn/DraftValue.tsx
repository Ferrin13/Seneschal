import { useMemo, useState } from "react";
import {
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
import { LineChart } from "@mui/x-charts/LineChart";
import type { LeagueValues, PlayerValue } from "./types";
import { fmtPar } from "./format";

type Metric = "pas" | "par";

const metricOf = (v: PlayerValue, m: Metric) =>
  m === "pas" ? v.parStarter : v.par;

/** Standard fantasy draft length used to size the curve. */
const DRAFT_ROUNDS = 15;

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * A Polian/Jimmy Johnson-style draft pick value chart built from this
 * league's projections: what each overall pick should return (our model's
 * ordering) vs what the market's ADP ordering actually delivers, plus the
 * classic normalized points column (first pick = 1000) for pricing pick
 * and keeper-cost trades.
 */
export function DraftValue({
  valuation,
  league,
}: Pick<LeagueValues, "valuation" | "league">) {
  const [metric, setMetric] = useState<Metric>("pas");
  const [includeKdef, setIncludeKdef] = useState(false);

  const numTeams = league.settings.numTeams;

  const data = useMemo(() => {
    const pool = valuation.values.filter(
      (v) =>
        includeKdef || (v.position !== "K" && v.position !== "DEF")
    );
    const model = [...pool].sort(
      (a, b) => metricOf(b, metric) - metricOf(a, metric)
    );
    const market = pool
      .filter((v) => v.adp != null)
      .sort((a, b) => a.adp! - b.adp!);

    const n = Math.min(DRAFT_ROUNDS * numTeams, model.length, market.length);
    const picks = Array.from({ length: n }, (_, i) => i + 1);
    const modelVals = picks.map((_, i) => metricOf(model[i]!, metric));
    const marketVals = picks.map((_, i) => metricOf(market[i]!, metric));
    const modelNames = picks.map((_, i) => model[i]!.name);
    const marketNames = picks.map((_, i) => market[i]!.name);

    // Jimmy Johnson normalization: value above the last pick's expectation,
    // scaled so pick 1.01 = 1000.
    const base = modelVals[n - 1] ?? 0;
    const span = (modelVals[0] ?? 0) - base || 1;
    const chartPts = modelVals.map((v) =>
      Math.max(0, Math.round((1000 * (v - base)) / span))
    );

    const rounds = Array.from(
      { length: Math.ceil(n / numTeams) },
      (_, r) => {
        const start = r * numTeams;
        const end = Math.min(start + numTeams, n);
        const avg = (xs: number[]) =>
          xs.slice(start, end).reduce((s, x) => s + x, 0) / (end - start);
        return {
          round: r + 1,
          firstPick: start + 1,
          lastPick: end,
          ptsFirst: chartPts[start]!,
          ptsLast: chartPts[end - 1]!,
          modelAvg: avg(modelVals),
          marketAvg: avg(marketVals),
        };
      }
    );

    return { picks, modelVals, marketVals, modelNames, marketNames, rounds, n };
  }, [valuation.values, metric, includeKdef, numTeams]);

  const metricLabel = metric === "pas" ? "PAS/G" : "PAR/G";

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
          Draft position value under this league's projections. The model
          curve is what each overall pick should return when everyone drafts
          optimally by {metricLabel}; the market curve is what the ADP
          ordering actually delivers at each slot — where it sags below the
          model, the market is reaching. Chart points normalize the model
          curve to the classic trade chart (first pick = 1000) for pricing
          pick swaps and keeper costs: keeping a player burns that round's
          pick, so his {metricLabel} should beat the round's value.
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center" flexShrink={0}>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel id="draft-metric-label">Metric</InputLabel>
            <Select
              labelId="draft-metric-label"
              label="Metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              <MenuItem value="pas">PAS/G</MenuItem>
              <MenuItem value="par">PAR/G</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={includeKdef}
                onChange={(e) => setIncludeKdef(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Include K/DEF</Typography>}
          />
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <LineChart
          height={360}
          series={[
            {
              data: data.modelVals,
              label: `Model (optimal order, ${metricLabel})`,
              showMark: false,
              curve: "monotoneX",
              valueFormatter: (value, { dataIndex }) =>
                `${fmtPar(value ?? 0)} — ${data.modelNames[dataIndex]}`,
            },
            {
              data: data.marketVals,
              label: `Market (ADP order, ${metricLabel})`,
              showMark: false,
              curve: "monotoneX",
              valueFormatter: (value, { dataIndex }) =>
                `${fmtPar(value ?? 0)} — ${data.marketNames[dataIndex]}`,
            },
          ]}
          xAxis={[
            {
              data: data.picks,
              label: "Overall pick",
              scaleType: "linear",
              tickMinStep: numTeams,
            },
          ]}
          yAxis={[{ label: metricLabel }]}
          grid={{ horizontal: true }}
          slotProps={{ legend: { position: { vertical: "top", horizontal: "right" } } }}
        />
      </Paper>

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Round</TableCell>
                <TableCell>Picks</TableCell>
                <TableCell align="right">
                  <Tooltip title="Normalized trade chart value across the round (first pick = 1000)">
                    <span>Chart pts</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={`Average ${metricLabel} of the players our model slots in the round`}>
                    <span>Model {metricLabel}</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={`Average ${metricLabel} the ADP ordering actually delivers in the round`}>
                    <span>Market {metricLabel}</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Market minus model: negative means the round's picks underdeliver when drafted by ADP">
                    <span>Δ</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rounds.map((r) => {
                const delta = r.marketAvg - r.modelAvg;
                return (
                  <TableRow key={r.round} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.round}</TableCell>
                    <TableCell sx={numSx}>
                      {r.firstPick}–{r.lastPick}
                    </TableCell>
                    <TableCell align="right" sx={{ ...numSx, fontWeight: 600 }}>
                      {r.ptsFirst} → {r.ptsLast}
                    </TableCell>
                    <TableCell align="right" sx={numSx}>
                      {fmtPar(r.modelAvg)}
                    </TableCell>
                    <TableCell align="right" sx={numSx}>
                      {fmtPar(r.marketAvg)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        ...numSx,
                        color:
                          delta < -0.1
                            ? "warning.main"
                            : delta > 0.1
                              ? "success.main"
                              : "text.disabled",
                      }}
                    >
                      {fmtPar(delta)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        Curve covers {DRAFT_ROUNDS} rounds ({data.n} picks) for{" "}
        {numTeams} teams. Hover the chart to see which player sits at each
        slot in each ordering. K/DEF are excluded by default because their
        late ADP misstates their value at a slot.
      </Typography>
    </Stack>
  );
}
