import {
  Alert,
  Box,
  Card,
  CardContent,
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
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { LeagueAnalysis, LeagueValues } from "./types";
import { fmtPar, positionColor, teamLabel } from "./format";
import { useSeasonBoard } from "./useSeasonBoard";
import { fillLineup } from "./teamDetail";
import { SeasonTeamRoster, TeamRoster } from "./TeamRoster";
import { TeamWeekly } from "./TeamWeekly";
import { TeamResilience } from "./TeamResilience";
import { PlayerDetailDrawer } from "./PlayerDetailDrawer";

/** Minimal identity for the detail drawer, current or historical. */
type SelectedPlayer = { playerId: string; name: string; position: string };

const BASE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** Which base positions may fill each flex-style roster slot. */
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

/** Minimal shape the lineup simulation needs, current or historical. */
type BreakdownPlayer = {
  playerId: string;
  name: string;
  position: string;
  ppg: number;
  /** Points above starter — the headline strength metric. */
  pas: number;
  /** Points above replacement — used for bench depth. */
  par: number;
};

type PosBreakdown = {
  position: string;
  /** Starters this roster fields at the position (dedicated + flex share). */
  starters: { name: string; pas: number }[];
  /** Sum of the starters' per-game PAS. */
  starterPas: number;
  best: { name: string; pas: number } | null;
  /** Non-starters at the position worth rostering (PAR > 0). */
  depthCount: number;
  /** Total positive PAR sitting on the bench at the position. */
  benchPar: number;
};

/**
 * Simulate this roster's best lineup — dedicated slots first, then flex
 * seats greedily by ppg — and aggregate starter strength and bench depth
 * per position.
 */
function breakdownForRoster(
  rosterPlayers: BreakdownPlayer[],
  rosterPositions: string[]
): Map<string, PosBreakdown> {
  const players = [...rosterPlayers].sort((a, b) => b.ppg - a.ppg);

  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }

  const used = new Set<string>();
  const startersByPos = new Map<string, { name: string; pas: number }[]>();
  const addStarter = (p: BreakdownPlayer) => {
    used.add(p.playerId);
    const list = startersByPos.get(p.position) ?? [];
    list.push({ name: p.name, pas: p.pas });
    startersByPos.set(p.position, list);
  };

  for (const pos of BASE_POSITIONS) {
    let seats = slotCounts.get(pos) ?? 0;
    for (const p of players) {
      if (seats === 0) break;
      if (p.position !== pos || used.has(p.playerId)) continue;
      addStarter(p);
      seats--;
    }
  }
  for (const [slot, count] of slotCounts) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (!eligible) continue;
    let seats = count;
    for (const p of players) {
      if (seats === 0) break;
      if (used.has(p.playerId) || !eligible.includes(p.position)) continue;
      addStarter(p);
      seats--;
    }
  }

  const result = new Map<string, PosBreakdown>();
  for (const pos of BASE_POSITIONS) {
    const starters = startersByPos.get(pos) ?? [];
    const atPos = players.filter((p) => p.position === pos);
    const bench = atPos.filter((p) => !used.has(p.playerId));
    const best = atPos.reduce<{ name: string; pas: number } | null>(
      (acc, p) =>
        acc == null || p.pas > acc.pas ? { name: p.name, pas: p.pas } : acc,
      null
    );
    result.set(pos, {
      position: pos,
      starters,
      starterPas: starters.reduce((s, x) => s + x.pas, 0),
      best,
      depthCount: bench.filter((p) => p.par > 0).length,
      benchPar: bench.reduce((s, p) => s + Math.max(0, p.par), 0),
    });
  }
  return result;
}

/**
 * Deep-dive on one team: lineup-aware positional strength vs. the league,
 * bench depth, and (for past seasons) schedule luck. Historical seasons use
 * the REAL rosters from that year, priced at actual stats.
 */
export function TeamAnalysis({
  leagueId,
  teams,
  valuation,
  league,
  rosterHistorySeasons,
}: Pick<LeagueValues, "teams" | "valuation" | "league" | "rosterHistorySeasons"> & {
  leagueId: string;
}) {
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [season, setSeason] = useState<string>("current");
  const [rosterId, setRosterId] = useState<number>(
    league.myRosterId ?? teams[0]?.rosterId ?? 1
  );
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);

  const valueById = useMemo(
    () => new Map(valuation.values.map((v) => [v.playerId, v])),
    [valuation.values]
  );
  const selectedValue = selected
    ? (valueById.get(selected.playerId) ?? null)
    : null;
  const ownerTeam =
    selectedValue?.rosterId != null
      ? teams.find((t) => t.rosterId === selectedValue.rosterId)
      : undefined;

  const historical = season !== "current";
  const board = useSeasonBoard(leagueId, historical ? season : null);
  const boardReady =
    board != null && board !== "loading" && board !== "error" ? board : null;

  useEffect(() => {
    let cancelled = false;
    api
      .thrawnLeagueAnalysis(leagueId)
      .then((a) => {
        if (!cancelled) setAnalysis(a);
      })
      .catch((err) => {
        if (!cancelled) {
          setAnalysisError(
            err instanceof ApiError
              ? err.message
              : "Failed to load matchup history"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // One breakdown per team (keyed by CURRENT roster id where possible), plus
  // league averages, for whichever season is selected.
  const { perTeam, leagueAvg } = useMemo(() => {
    const perTeam = new Map<number, Map<string, PosBreakdown>>();
    const all: Map<string, PosBreakdown>[] = [];
    if (!historical) {
      for (const t of teams) {
        const players: BreakdownPlayer[] = valuation.values
          .filter((v) => v.rosterId === t.rosterId)
          .map((v) => ({
            playerId: v.playerId,
            name: v.name,
            position: v.position,
            ppg: v.ppg,
            pas: v.parStarter,
            par: v.par,
          }));
        const b = breakdownForRoster(players, league.settings.rosterPositions);
        perTeam.set(t.rosterId, b);
        all.push(b);
      }
    } else if (boardReady) {
      for (const t of boardReady.teams) {
        const players: BreakdownPlayer[] = t.players
          .filter((p) => p.gp > 0 && p.position != null)
          .map((p) => ({
            playerId: p.playerId,
            name: p.name,
            position: p.position!,
            ppg: p.ppg,
            pas: p.parStarter,
            par: p.par,
          }));
        const b = breakdownForRoster(players, league.settings.rosterPositions);
        if (t.currentRosterId != null) perTeam.set(t.currentRosterId, b);
        all.push(b);
      }
    }
    const leagueAvg = new Map<string, number>();
    for (const pos of BASE_POSITIONS) {
      const vals = all.map((b) => b.get(pos)?.starterPas ?? 0);
      leagueAvg.set(
        pos,
        vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0
      );
    }
    return { perTeam, leagueAvg };
  }, [
    historical,
    boardReady,
    teams,
    valuation.values,
    league.settings.rosterPositions,
  ]);

  const breakdown = perTeam.get(rosterId);

  const deltas = useMemo(() => {
    if (!breakdown) return [];
    return BASE_POSITIONS.map((pos) => ({
      position: pos,
      delta: (breakdown.get(pos)?.starterPas ?? 0) - (leagueAvg.get(pos) ?? 0),
    })).sort((a, b) => b.delta - a.delta);
  }, [breakdown, leagueAvg]);

  const luckSeason = historical
    ? analysis?.seasons.find((s) => s.season === season)
    : undefined;
  const selectedTeam = teams.find((t) => t.rosterId === rosterId);

  // Current-season deep-dive inputs: the selected roster's full values and
  // its projected season lineup (dedicated slots, then flex by ppg).
  const rosterPlayers = useMemo(
    () => valuation.values.filter((v) => v.rosterId === rosterId),
    [valuation.values, rosterId]
  );
  const starterIds = useMemo(
    () =>
      fillLineup(
        rosterPlayers.map((v) => ({
          playerId: v.playerId,
          position: v.position,
          pts: v.ppg,
        })),
        league.settings.rosterPositions
      ).starterIds,
    [rosterPlayers, league.settings.rosterPositions]
  );
  const historicalTeam = boardReady?.teams.find(
    (t) => t.currentRosterId === rosterId
  );

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="ta-team-label">Team</InputLabel>
          <Select
            labelId="ta-team-label"
            label="Team"
            value={rosterId}
            onChange={(e) => setRosterId(Number(e.target.value))}
          >
            {teams.map((t) => (
              <MenuItem key={t.rosterId} value={t.rosterId}>
                {teamLabel(t)}
                {league.myRosterId === t.rosterId ? " (me)" : ""}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="ta-season-label">Season</InputLabel>
          <Select
            labelId="ta-season-label"
            label="Season"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <MenuItem value="current">{league.season} (projections)</MenuItem>
            {rosterHistorySeasons.map((s) => (
              <MenuItem key={s} value={s}>
                {s} (actual)
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            Roster detail
            {selectedTeam ? ` — ${teamLabel(selectedTeam)}` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {historical ? (
              <>
                The real end-of-season {season} roster, each player priced by
                that year's actual stats under this league's scoring.
              </>
            ) : (
              <>
                Every rostered player with PAS (vs. league-average starter)
                and PAR (vs. fringe-bench replacement), year-to-year
                variance, past-season PAR, bye week, and durability (average
                games played over the past seasons on record). Grayed rows
                are projected bench players.
              </>
            )}
          </Typography>
          {!historical ? (
            rosterPlayers.length > 0 ? (
              <TeamRoster
                players={rosterPlayers}
                declaredKeepers={new Set(selectedTeam?.keepers ?? [])}
                starterIds={starterIds}
                onSelect={(v) =>
                  setSelected({
                    playerId: v.playerId,
                    name: v.name,
                    position: v.position,
                  })
                }
              />
            ) : (
              <Alert severity="info">No valued players on this roster.</Alert>
            )
          ) : board === "loading" ? (
            <CircularProgress size={24} />
          ) : historicalTeam ? (
            <SeasonTeamRoster
              players={historicalTeam.players}
              onSelect={(p) =>
                setSelected({
                  playerId: p.playerId,
                  name: p.name,
                  position: p.position ?? "",
                })
              }
            />
          ) : (
            <Alert severity="info">
              No {season} roster for this owner — they may not have been in
              the league yet.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            Positional strength
            {selectedTeam ? ` — ${teamLabel(selectedTeam)}` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Best lineup simulated from{" "}
            {historical
              ? `the team's real end-of-season ${season} roster and actual per-game stats`
              : "current rosters and projections"}
            : dedicated slots first, then flex seats by points per game.
            Starter PAS/G sums the starters' per-game points above the
            league-average starter; depth counts bench players above
            replacement (PAR).
          </Typography>

          {historical && board === "loading" ? <CircularProgress size={24} /> : null}
          {historical && board === "error" ? (
            <Alert severity="error">Failed to load {season} rosters.</Alert>
          ) : null}
          {historical && boardReady && boardReady.teams.length === 0 ? (
            <Alert severity="info">
              No roster history for {season} yet — press Sync to pull it from
              Sleeper.
            </Alert>
          ) : null}
          {historical && boardReady && boardReady.teams.length > 0 && !breakdown ? (
            <Alert severity="info">
              This owner wasn't in the league in {season}.
            </Alert>
          ) : null}

          {breakdown ? (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{ mb: 1.5 }}
                flexWrap="wrap"
                useFlexGap
              >
                {deltas.length > 0 && deltas[0]!.delta > 0 ? (
                  <Chip
                    size="small"
                    color="success"
                    label={`Strength: ${
                      deltas
                        .filter((d) => d.delta > 0.5)
                        .map((d) => d.position)
                        .join(", ") || deltas[0]!.position
                    }`}
                  />
                ) : null}
                {deltas.length > 0 && deltas[deltas.length - 1]!.delta < 0 ? (
                  <Chip
                    size="small"
                    color="warning"
                    label={`Weakness: ${
                      deltas
                        .filter((d) => d.delta < -0.5)
                        .map((d) => d.position)
                        .join(", ") || deltas[deltas.length - 1]!.position
                    }`}
                  />
                ) : null}
              </Stack>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Pos</TableCell>
                      <TableCell align="right">Starter PAS/G</TableCell>
                      <TableCell align="right">Lg avg</TableCell>
                      <TableCell align="right">Δ</TableCell>
                      <TableCell>Best player</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Bench players above replacement level">
                          <span>Depth</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Total positive PAR/G on the bench">
                          <span>Bench PAR/G</span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {BASE_POSITIONS.map((pos) => {
                      const b = breakdown.get(pos);
                      const avg = leagueAvg.get(pos) ?? 0;
                      const delta = (b?.starterPas ?? 0) - avg;
                      return (
                        <TableRow key={pos}>
                          <TableCell>
                            <Chip
                              label={pos}
                              size="small"
                              sx={{
                                bgcolor: positionColor(pos),
                                color: "#fff",
                                fontWeight: 700,
                                height: 20,
                                fontSize: "0.65rem",
                              }}
                            />
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            <Tooltip
                              title={
                                b && b.starters.length > 0
                                  ? b.starters
                                      .map((s) => `${s.name} ${fmtPar(s.pas)}`)
                                      .join(" · ")
                                  : "No starters"
                              }
                            >
                              <span>{fmtPar(b?.starterPas ?? 0)}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontVariantNumeric: "tabular-nums",
                              color: "text.secondary",
                            }}
                          >
                            {fmtPar(avg)}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: 600,
                              color:
                                delta > 0.05
                                  ? "success.main"
                                  : delta < -0.05
                                    ? "warning.main"
                                    : "text.disabled",
                            }}
                          >
                            {fmtPar(delta)}
                          </TableCell>
                          <TableCell>
                            {b?.best ? (
                              <Typography variant="body2" noWrap>
                                {b.best.name}{" "}
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  ({fmtPar(b.best.pas)})
                                </Typography>
                              </Typography>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {b?.depthCount ?? 0}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {fmtPar(b?.benchPar ?? 0)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : null}
        </CardContent>
      </Card>

      {!historical ? (
        <Card variant="outlined">
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
              Week-by-week outlook
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Best-lineup projection for each week: ESPN's weekly curves give
              the shape (byes and ramps), scaled to each player's effective
              season projection under this league's scoring. Players without
              a weekly feed are spread evenly across non-bye weeks.
            </Typography>
            {rosterPlayers.length > 0 ? (
              <TeamWeekly
                roster={rosterPlayers}
                rosterPositions={league.settings.rosterPositions}
                starterIds={starterIds}
              />
            ) : (
              <Alert severity="info">No valued players on this roster.</Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!historical ? (
        <Card variant="outlined">
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
              Injury resilience
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              What each starter's absence costs per game: the drop to the next
              man up on the roster (or the waiver-wire replacement when the
              bench is bare), weighted by games they've actually missed over
              the past seasons. High expected loss means production that is
              both fragile and hard to replace.
            </Typography>
            {rosterPlayers.length > 0 ? (
              <TeamResilience
                roster={rosterPlayers}
                starterIds={starterIds}
                replacement={valuation.replacement}
              />
            ) : (
              <Alert severity="info">No valued players on this roster.</Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card variant="outlined">
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Luck</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Expected wins come from the all-play record: each week, the share
            of the league a team outscored. Luck is actual wins minus expected
            wins — positive means the schedule was kind.
          </Typography>
          {!historical ? (
            <Alert severity="info">
              Luck needs completed games — pick a past season above.
            </Alert>
          ) : analysisError ? (
            <Alert severity="error">{analysisError}</Alert>
          ) : analysis == null ? (
            <CircularProgress size={24} />
          ) : !luckSeason || luckSeason.teams.length === 0 ? (
            <Alert severity="info">
              No matchup history for {season} yet — press Sync to pull it from
              Sleeper.
            </Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Team</TableCell>
                    <TableCell align="right">Record</TableCell>
                    <TableCell align="right">PF</TableCell>
                    <TableCell align="right">PA</TableCell>
                    <TableCell align="right">
                      <Tooltip title="All-play expected wins">
                        <span>xW</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">Luck</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {luckSeason.teams.map((t) => {
                    const isSelected = t.currentRosterId === rosterId;
                    const name =
                      t.teamName ||
                      t.displayName ||
                      `Roster ${t.rosterId} (${season})`;
                    return (
                      <TableRow
                        key={t.rosterId}
                        selected={isSelected}
                        sx={
                          isSelected
                            ? { "& td": { fontWeight: 700 } }
                            : undefined
                        }
                      >
                        <TableCell>
                          {name}
                          {t.currentRosterId == null ? (
                            <Typography
                              component="span"
                              variant="caption"
                              color="text.secondary"
                            >
                              {" "}
                              (left league)
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {t.wins}-{t.losses}
                          {t.ties > 0 ? `-${t.ties}` : ""}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {t.pointsFor.toFixed(0)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {t.pointsAgainst.toFixed(0)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {t.expectedWins.toFixed(1)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                            color:
                              t.luck > 0.5
                                ? "success.main"
                                : t.luck < -0.5
                                  ? "warning.main"
                                  : "text.secondary",
                          }}
                        >
                          {fmtPar(t.luck)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Box>
        <Typography variant="caption" color="text.secondary">
          Historical views use the real end-of-season rosters from Sleeper
          (mid-season trades aren't reconstructed week by week) and each
          player's actual stats scored with this league's settings. Luck uses
          the real weekly matchup results.
        </Typography>
      </Box>

      <PlayerDetailDrawer
        open={selected != null}
        onClose={() => setSelected(null)}
        leagueId={leagueId}
        player={selectedValue}
        fallback={selected}
        teamName={ownerTeam ? teamLabel(ownerTeam) : null}
      />
    </Stack>
  );
}
