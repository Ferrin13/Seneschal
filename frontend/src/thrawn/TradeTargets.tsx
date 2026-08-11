import { useMemo, useState } from "react";
import {
  Alert,
  Chip,
  FormControl,
  FormControlLabel,
  Grid2 as Grid,
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
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import type { LeagueValues, PlayerValue, ThrawnTeam } from "./types";
import { fmtPar, positionColor, teamLabel } from "./format";
import { PlayerDetailDrawer } from "./PlayerDetailDrawer";

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

/** One player's market-vs-model comparison. */
type ValueGap = {
  v: PlayerValue;
  /** Overall rank implied by Sleeper ADP (1 = first pick). */
  marketRank: number;
  /** Overall rank in our model, by PAS/G. */
  ourRank: number;
  /**
   * PAS/G edge over the market's slot: his PAS/G minus the PAS/G of the
   * player our model puts at his ADP-implied rank. Positive = the market
   * underprices him; negative = ADP overrates him.
   */
  edge: number;
  /** Same idea priced in PAR/G against the PAR/G ordering. */
  edgePar: number;
};

/** Ignore players irrelevant on both boards; deep-pool ADP is noise. */
const RELEVANT_RANK = 150;

function computeGaps(values: PlayerValue[]): ValueGap[] {
  const pool = values.filter((v) => v.adp != null);
  const byMarket = [...pool].sort((a, b) => a.adp! - b.adp!);
  const byPas = [...pool].sort((a, b) => b.parStarter - a.parStarter);
  const byPar = [...pool].sort((a, b) => b.par - a.par);
  const marketRank = new Map(byMarket.map((v, i) => [v.playerId, i + 1]));
  const ourRank = new Map(byPas.map((v, i) => [v.playerId, i + 1]));
  const pasAtRank = byPas.map((v) => v.parStarter);
  const parAtRank = byPar.map((v) => v.par);

  return pool
    .map((v) => {
      const mkt = marketRank.get(v.playerId)!;
      const slot = Math.min(mkt - 1, pool.length - 1);
      return {
        v,
        marketRank: mkt,
        ourRank: ourRank.get(v.playerId)!,
        edge: v.parStarter - pasAtRank[slot]!,
        edgePar: v.par - parAtRank[slot]!,
      };
    })
    .filter((g) => Math.min(g.marketRank, g.ourRank) <= RELEVANT_RANK);
}

function GapTable({
  gaps,
  teamByRoster,
  showOwner,
  positive,
  onSelect,
}: {
  gaps: ValueGap[];
  teamByRoster: Map<number, ThrawnTeam>;
  showOwner: boolean;
  positive: boolean;
  onSelect: (v: PlayerValue) => void;
}) {
  if (gaps.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No meaningful gaps at this filter.
      </Typography>
    );
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            {showOwner ? <TableCell>Owner</TableCell> : null}
            <TableCell align="right">
              <Tooltip title="Sleeper average draft position">
                <span>ADP</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Overall rank implied by ADP vs our overall rank by PAS/G">
                <span>Mkt / ours</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">PAS/G</TableCell>
            <TableCell align="right">PAR/G</TableCell>
            <TableCell align="right">
              <Tooltip title="PAS/G minus the PAS/G of the player our model slots at his ADP-implied rank — per-game starter value the market is missing (+) or imagining (-)">
                <span>Edge PAS</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Same gap priced in PAR/G: his PAR/G minus the PAR/G at his ADP-implied slot in our PAR ordering">
                <span>Edge PAR</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {gaps.map(({ v, marketRank, ourRank, edge, edgePar }) => {
            const owner =
              v.rosterId != null ? teamByRoster.get(v.rosterId) : undefined;
            return (
              <TableRow
                key={v.playerId}
                hover
                onClick={() => onSelect(v)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell>
                  <Stack direction="row" spacing={0.75} alignItems="center">
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
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {v.name}
                    </Typography>
                    {v.injuryStatus ? (
                      <Chip
                        label={v.injuryStatus}
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={{ height: 16, fontSize: "0.6rem" }}
                      />
                    ) : null}
                  </Stack>
                </TableCell>
                {showOwner ? (
                  <TableCell>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {owner ? teamLabel(owner) : "—"}
                    </Typography>
                  </TableCell>
                ) : null}
                <TableCell align="right" sx={numSx}>
                  {v.adp!.toFixed(1)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  #{marketRank} / #{ourRank}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {fmtPar(v.parStarter)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {fmtPar(v.par)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    ...numSx,
                    fontWeight: 700,
                    color: positive ? "#2E7D32" : "#EF6C00",
                  }}
                >
                  {fmtPar(edge)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    ...numSx,
                    color: positive ? "#2E7D32" : "#EF6C00",
                  }}
                >
                  {fmtPar(edgePar)}
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
 * Market-inefficiency trade finder: our model's PAS/G ordering against
 * Sleeper's ADP, which is what most league-mates price players by. Players
 * on other teams the market underrates are buy targets; players on my
 * roster the market overrates are sell-high bait.
 */
export function TradeTargets({
  leagueId,
  teams,
  valuation,
  league,
}: Pick<LeagueValues, "teams" | "valuation" | "league"> & {
  leagueId: string;
}) {
  const [position, setPosition] = useState<string>("ALL");
  // K/DEF are drafted last regardless of quality, so their ADP-implied rank
  // manufactures huge fake edges; hide them unless explicitly requested.
  const [includeKdef, setIncludeKdef] = useState(false);
  const [minPas, setMinPas] = useState<number>(-99);
  const [minPar, setMinPar] = useState<number>(-99);
  const [selected, setSelected] = useState<PlayerValue | null>(null);

  const teamByRoster = useMemo(
    () => new Map(teams.map((t) => [t.rosterId, t])),
    [teams]
  );

  const gaps = useMemo(
    () => computeGaps(valuation.values),
    [valuation.values]
  );

  const myRosterId = league.myRosterId;

  const { buy, sell } = useMemo(() => {
    const filtered = gaps.filter((g) => {
      if (g.v.parStarter < minPas || g.v.par < minPar) return false;
      if (position !== "ALL") return g.v.position === position;
      if (!includeKdef && (g.v.position === "K" || g.v.position === "DEF")) {
        return false;
      }
      return true;
    });
    return {
      buy: filtered
        .filter(
          (g) =>
            g.v.rosterId != null &&
            g.v.rosterId !== myRosterId &&
            g.edge > 0
        )
        .sort((a, b) => b.edge - a.edge)
        .slice(0, 15),
      sell: filtered
        .filter((g) => g.v.rosterId === myRosterId && g.edge < 0)
        .sort((a, b) => a.edge - b.edge)
        .slice(0, 10),
    };
  }, [gaps, position, includeKdef, minPas, minPar, myRosterId]);

  if (myRosterId == null) {
    return (
      <Alert severity="info">
        Pick your team in the "My team" selector above to see trade targets.
      </Alert>
    );
  }

  const ownerTeam =
    selected?.rosterId != null
      ? teamByRoster.get(selected.rosterId)
      : undefined;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
          Most league-mates price players the way Sleeper does, so its ADP is
          the market. This compares that market rank against our model's
          PAS/G ordering: players on other rosters the market underrates are
          worth pursuing — their owners may sell at the ADP price — while
          players on your roster the market overrates are bait you can move
          for more than our model says they're worth.
        </Typography>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexShrink={0}
          flexWrap="wrap"
          useFlexGap
        >
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel id="targets-pos-label">Position</InputLabel>
            <Select
              labelId="targets-pos-label"
              label="Position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              {["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="targets-min-pas-label">Min PAS/G</InputLabel>
            <Select
              labelId="targets-min-pas-label"
              label="Min PAS/G"
              value={minPas}
              onChange={(e) => setMinPas(Number(e.target.value))}
            >
              <MenuItem value={-99}>Any</MenuItem>
              <MenuItem value={-2}>-2+</MenuItem>
              <MenuItem value={0}>0+</MenuItem>
              <MenuItem value={1}>+1+</MenuItem>
              <MenuItem value={2}>+2+</MenuItem>
              <MenuItem value={4}>+4+</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="targets-min-par-label">Min PAR/G</InputLabel>
            <Select
              labelId="targets-min-par-label"
              label="Min PAR/G"
              value={minPar}
              onChange={(e) => setMinPar(Number(e.target.value))}
            >
              <MenuItem value={-99}>Any</MenuItem>
              <MenuItem value={0}>0+</MenuItem>
              <MenuItem value={2}>+2+</MenuItem>
              <MenuItem value={4}>+4+</MenuItem>
              <MenuItem value={6}>+6+</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="K/DEF go at the end of drafts no matter how good they are, so their ADP-implied rank inflates their edge — off by default">
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
          </Tooltip>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, pt: 1.5 }}
            >
              <TrendingUpIcon sx={{ color: "#2E7D32" }} />
              <Typography variant="subtitle1" fontWeight={700}>
                Pursue
              </Typography>
              <Typography variant="caption" color="text.secondary">
                on other teams, underpriced by ADP
              </Typography>
            </Stack>
            <GapTable
              gaps={buy}
              teamByRoster={teamByRoster}
              showOwner
              positive
              onSelect={setSelected}
            />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, pt: 1.5 }}
            >
              <TrendingDownIcon sx={{ color: "#EF6C00" }} />
              <Typography variant="subtitle1" fontWeight={700}>
                Shop
              </Typography>
              <Typography variant="caption" color="text.secondary">
                on your roster, overpriced by ADP
              </Typography>
            </Stack>
            <GapTable
              gaps={sell}
              teamByRoster={teamByRoster}
              showOwner={false}
              positive={false}
              onSelect={setSelected}
            />
          </Paper>
        </Grid>
      </Grid>

      <Typography variant="caption" color="text.secondary">
        Edge/G prices the gap in per-game points: e.g. +1.5 means he projects
        for 1.5 more PAS/G than the player our model slots at his ADP-implied
        rank. Only players inside the top {RELEVANT_RANK} on either board are
        shown. Click a player for full details.
      </Typography>

      <PlayerDetailDrawer
        open={selected != null}
        onClose={() => setSelected(null)}
        leagueId={leagueId}
        player={selected}
        teamName={ownerTeam ? teamLabel(ownerTeam) : null}
      />
    </Stack>
  );
}
