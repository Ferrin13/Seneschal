import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import StarIcon from "@mui/icons-material/Star";
import { api } from "../api";
import type {
  PlayerDetailReport,
  PlayerSeasonDetail,
  PlayerValue,
  RegressionRow,
} from "./types";
import {
  fmtPar,
  fmtPts,
  fmtVariance,
  positionColor,
  sourceLabel,
} from "./format";

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ ...numSx, fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: 1.5 }}
      >
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {children}
      </Stack>
    </Box>
  );
}

const fmtNum = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * One phase (passing/rushing/receiving) as a compact stat line built from
 * raw stats, annotated with the luck fit's expected values when available.
 */
function phaseLine(
  stats: Record<string, number>,
  luck: RegressionRow | null | undefined,
  phase: "pass" | "rush" | "rec"
): { label: string; text: string } | null {
  const exp = luck?.phases.find((p) => p.phase === phase);
  const parts: string[] = [];
  const expTd = exp ? ` (exp ${exp.expTd.toFixed(1)})` : "";

  if (phase === "pass") {
    if (!stats.pass_att && !stats.pass_yd) return null;
    if (stats.pass_att) {
      const rz = stats.pass_rz_att ? ` (${fmtNum(stats.pass_rz_att)} RZ)` : "";
      parts.push(`${fmtNum(stats.pass_att)} att${rz}`);
    }
    if (stats.pass_yd) parts.push(`${fmtNum(stats.pass_yd)} yds`);
    parts.push(`${fmtNum(stats.pass_td ?? 0)} TD${expTd}`);
    if (stats.pass_int) parts.push(`${fmtNum(stats.pass_int)} INT`);
    return { label: "Pass", text: parts.join(" · ") };
  }
  if (phase === "rush") {
    if (!stats.rush_att && !stats.rush_yd) return null;
    if (stats.rush_att) {
      const rz = stats.rush_rz_att ? ` (${fmtNum(stats.rush_rz_att)} RZ)` : "";
      parts.push(`${fmtNum(stats.rush_att)} att${rz}`);
    }
    if (stats.rush_yd) parts.push(`${fmtNum(stats.rush_yd)} yds`);
    parts.push(`${fmtNum(stats.rush_td ?? 0)} TD${expTd}`);
    return { label: "Rush", text: parts.join(" · ") };
  }
  if (!stats.rec_tgt && !stats.rec && !stats.rec_yd) return null;
  if (stats.rec_tgt) {
    const rz = stats.rec_rz_tgt ? ` (${fmtNum(stats.rec_rz_tgt)} RZ)` : "";
    parts.push(`${fmtNum(stats.rec_tgt)} tgt${rz}`);
  }
  if (stats.rec) {
    const expRec =
      exp?.expRec != null ? ` (exp ${exp.expRec.toFixed(0)})` : "";
    parts.push(`${fmtNum(stats.rec)} rec${expRec}`);
  }
  if (stats.rec_yd) parts.push(`${fmtNum(stats.rec_yd)} yds`);
  parts.push(`${fmtNum(stats.rec_td ?? 0)} TD${expTd}`);
  return { label: "Recv", text: parts.join(" · ") };
}

function PhaseLines({
  stats,
  luck,
}: {
  stats: Record<string, number>;
  luck?: RegressionRow | null;
}) {
  const lines = (["pass", "rush", "rec"] as const)
    .map((phase) => phaseLine(stats, luck, phase))
    .filter((l): l is { label: string; text: string } => l != null);
  if (lines.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No volume stats recorded.
      </Typography>
    );
  }
  return (
    <Stack spacing={0.25}>
      {lines.map((l) => (
        <Stack key={l.label} direction="row" spacing={1} alignItems="baseline">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ width: 34, flexShrink: 0 }}
          >
            {l.label}
          </Typography>
          <Typography variant="body2" sx={numSx}>
            {l.text}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function SeasonLuckBlock({ detail }: { detail: PlayerSeasonDetail }) {
  const luck = detail.luck;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {detail.season}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {detail.gp} gp
        </Typography>
        {luck ? (
          <Tooltip title="League-scored points per game above (+) or below (-) what overall + red-zone volume predicts. Positive tends to regress, negative tends to bounce back.">
            <Typography
              variant="body2"
              sx={{
                ...numSx,
                fontWeight: 700,
                color: luck.deltaPtsPerGame > 0 ? "#EF6C00" : "#2E7D32",
              }}
            >
              luck {fmtPar(luck.deltaPtsPerGame)}/g
            </Typography>
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.secondary">
            below volume minimums for a luck fit
          </Typography>
        )}
      </Stack>
      <Box sx={{ mt: 0.25 }}>
        <PhaseLines stats={detail.stats} luck={luck} />
      </Box>
    </Box>
  );
}

/**
 * Right-side popout with everything known about one player: projections
 * (per source + raw volume), PAS/PAR, per-season history with luck
 * analysis, and — when opened from the regression page — that page's row.
 */
export function PlayerDetailDrawer({
  open,
  onClose,
  leagueId,
  player,
  fallback,
  teamName,
}: {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  /** Full current-season valuation; null when the player isn't valued. */
  player: PlayerValue | null;
  /** Minimal identity when no valuation exists (e.g. retired players). */
  fallback?: { playerId: string; name: string; position: string } | null;
  /** Fantasy team that rosters him; null/undefined = free agent. */
  teamName?: string | null;
}) {
  const playerId = player?.playerId ?? fallback?.playerId ?? null;
  const name = player?.name ?? fallback?.name ?? "";
  const position = player?.position ?? fallback?.position ?? "";
  const sourceEntries = Object.entries(player?.sourcePoints ?? {});

  const [detail, setDetail] = useState<PlayerDetailReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!open || !playerId) return;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    api
      .thrawnPlayerDetail(leagueId, playerId)
      .then((r) => {
        if (!cancelled) setDetail(r);
      })
      .catch(() => {
        // Non-essential enrichment; the drawer still shows valuation data.
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leagueId, playerId]);

  const luckBySeason = new Map(
    (detail?.seasons ?? []).map((s) => [s.season, s.luck])
  );
  const hasProjectedStats =
    detail != null && Object.keys(detail.projectedStats).length > 0;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 560 } } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Chip
            label={position}
            size="small"
            sx={{
              bgcolor: positionColor(position),
              color: "#fff",
              fontWeight: 700,
              height: 22,
            }}
          />
          <Typography variant="h6" sx={{ flexGrow: 1, lineHeight: 1.2 }} noWrap>
            {name}
          </Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {player?.team ? (
            <Typography variant="body2" color="text.secondary">
              {player.team}
            </Typography>
          ) : null}
          {player?.age != null ? (
            <Typography variant="body2" color="text.secondary">
              age {player.age}
            </Typography>
          ) : null}
          {player?.byeWeek != null ? (
            <Typography variant="body2" color="text.secondary">
              bye wk {player.byeWeek}
            </Typography>
          ) : null}
          {player?.injuryStatus ? (
            <Chip
              label={player.injuryStatus}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.62rem" }}
            />
          ) : null}
          {player?.keeperLevel ? (
            <Chip
              icon={<StarIcon sx={{ fontSize: 13 }} />}
              label={`Keeper #${player.keeperRank}`}
              size="small"
              color="secondary"
              sx={{ height: 20, fontSize: "0.68rem" }}
            />
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {teamName ? `Rostered by ${teamName}` : "Free agent"}
        </Typography>

        <Stack spacing={2.5} sx={{ mt: 2 }} divider={<Divider />}>
          {player ? (
            <Section title="This season">
              <StatRow
                label="Projected points"
                value={
                  <>
                    {fmtPts(player.points)}
                    {player.overridden ? "*" : ""}
                  </>
                }
              />
              <StatRow label="Projected PPG" value={fmtPts(player.ppg)} />
              <StatRow
                label="Position rank"
                value={`${player.position}${player.positionRank}`}
              />
              <StatRow
                label="PAS/G (vs avg starter)"
                value={fmtPar(player.parStarter)}
              />
              <StatRow
                label="PAR/G (vs replacement)"
                value={fmtPar(player.par)}
              />
              <StatRow
                label="Replacement baseline"
                value={`${fmtPts(player.replacementPpg)}/g`}
              />
              <StatRow
                label="ADP"
                value={player.adp != null ? player.adp.toFixed(1) : "—"}
              />
              {player.overridden ? (
                <Typography variant="caption" color="secondary.main">
                  * your custom projection
                  {player.overrideNote ? ` — ${player.overrideNote}` : ""}{" "}
                  (public: {fmtPts(player.basePoints)})
                </Typography>
              ) : null}
              {hasProjectedStats ? (
                <Box sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Projected volume (mean of sources reporting each stat):
                  </Typography>
                  <PhaseLines stats={detail!.projectedStats} />
                </Box>
              ) : null}
            </Section>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No current-season projection for this player.
            </Typography>
          )}

          {sourceEntries.length > 1 ? (
            <Section title="Projection sources">
              {sourceEntries.map(([source, pts]) => (
                <StatRow
                  key={source}
                  label={sourceLabel(source)}
                  value={fmtPts(pts)}
                />
              ))}
            </Section>
          ) : null}

          {player && player.history.length > 0 ? (
            <Section title="Past seasons">
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 460 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Season</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Position finish that season by total points">
                        <span>Rank</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">GP</TableCell>
                    <TableCell align="right">PPG</TableCell>
                    <TableCell align="right">PAS/G</TableCell>
                    <TableCell align="right">PAR/G</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Scored points per game above/below what volume predicts that season">
                        <span>Luck/G</span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {player.history.map((h) => {
                    const luck = luckBySeason.get(h.season);
                    return (
                      <TableRow key={h.season}>
                        <TableCell>{h.season}</TableCell>
                        <TableCell align="right" sx={{ ...numSx, fontWeight: 600 }}>
                          {h.posRank > 0 ? `${position}${h.posRank}` : "—"}
                        </TableCell>
                        <TableCell align="right" sx={numSx}>
                          {h.gp}
                        </TableCell>
                        <TableCell align="right" sx={numSx}>
                          {fmtPts(h.ppg)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            ...numSx,
                            fontWeight: 600,
                            color:
                              h.pas > 0 ? "success.main" : "text.disabled",
                          }}
                        >
                          {fmtPar(h.pas)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            ...numSx,
                            color: h.par > 0 ? "success.main" : "text.disabled",
                          }}
                        >
                          {fmtPar(h.par)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            ...numSx,
                            color:
                              luck == null
                                ? "text.disabled"
                                : luck.deltaPtsPerGame > 0
                                  ? "#EF6C00"
                                  : "#2E7D32",
                          }}
                        >
                          {luck ? fmtPar(luck.deltaPtsPerGame) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </Box>
              <StatRow
                label="Year-to-year PAR variance"
                value={fmtVariance(player.parVariance)}
              />
            </Section>
          ) : null}

          {detailLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
              <CircularProgress size={20} />
            </Box>
          ) : null}

          {detail && detail.seasons.length > 0 ? (
            <Section title="Season stat detail & luck">
              <Stack spacing={1.25}>
                {detail.seasons.map((s) => (
                  <SeasonLuckBlock key={s.season} detail={s} />
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Expected TDs/receptions come from overall + red-zone (RZ)
                volume at league-wide positional rates. Overperformance tends
                to regress; underperformance tends to bounce back.
              </Typography>
            </Section>
          ) : null}
        </Stack>
      </Box>
    </Drawer>
  );
}
