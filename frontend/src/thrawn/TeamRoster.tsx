import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import LockIcon from "@mui/icons-material/Lock";
import type { PlayerValue, SeasonBoardPlayer } from "./types";
import { fmtPar, fmtPts, fmtVariance, positionColor } from "./format";
import { durability } from "./teamDetail";

function PositionChip({ position }: { position: string | null }) {
  return (
    <Chip
      label={position ?? "?"}
      size="small"
      sx={{
        bgcolor: positionColor(position ?? ""),
        color: "#fff",
        fontWeight: 700,
        height: 20,
        fontSize: "0.65rem",
      }}
    />
  );
}

/** Compact past-season PAR line, e.g. "'25 +3.1 · '24 +1.9". */
function historyLabel(v: PlayerValue): string {
  if (v.history.length === 0) return "—";
  return v.history
    .map((h) => `'${h.season.slice(2)} ${fmtPar(h.par)}`)
    .join(" · ");
}

function durabilityColor(avgGp: number | null): string {
  if (avgGp == null) return "text.secondary";
  if (avgGp >= 15) return "success.main";
  if (avgGp >= 12.5) return "warning.main";
  return "error.main";
}

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

/** Secondary columns collapse below md; tap a row for the detail drawer. */
const hideOnMobile = { display: { xs: "none", md: "table-cell" } } as const;

/**
 * Full current-season roster with every player metric: projections, both
 * PAS and PAR, variance, past-season PAR, bye, injury status, and
 * durability (average games played in past seasons).
 */
export function TeamRoster({
  players,
  declaredKeepers,
  starterIds,
  onSelect,
}: {
  players: PlayerValue[];
  declaredKeepers: Set<string>;
  starterIds: Set<string>;
  onSelect?: (player: PlayerValue) => void;
}) {
  const rows = [...players].sort((a, b) => b.parStarter - a.parStarter);
  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth: { xs: 0, md: 920 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Pos</TableCell>
            <TableCell>Player</TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              Age
            </TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              Bye
            </TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              Proj
            </TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              PPG
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Points above starter: per-game points vs. the league-average starter">
                <span>PAS/G</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Points above replacement: per-game points vs. the fringe bench-level replacement">
                <span>PAR/G</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              <Tooltip title="Year-to-year variance of past per-game PAR">
                <span>Var</span>
              </Tooltip>
            </TableCell>
            <TableCell sx={hideOnMobile}>Past PAR/G</TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              <Tooltip title="Average games played across the past seasons on record">
                <span>Avg GP</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((v) => {
            const d = durability(v);
            const starter = starterIds.has(v.playerId);
            return (
              <TableRow
                key={v.playerId}
                hover
                onClick={onSelect ? () => onSelect(v) : undefined}
                sx={{
                  ...(starter ? {} : { "& td": { color: "text.secondary" } }),
                  ...(onSelect ? { cursor: "pointer" } : {}),
                }}
              >
                <TableCell>
                  <PositionChip position={v.position} />
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    noWrap
                    component="span"
                    sx={{ fontWeight: v.keeperLevel ? 600 : 400 }}
                  >
                    {v.name}
                  </Typography>{" "}
                  {declaredKeepers.has(v.playerId) ? (
                    <Tooltip title="Declared keeper on Sleeper">
                      <LockIcon
                        sx={{ fontSize: 13, color: "text.secondary", verticalAlign: "middle" }}
                      />
                    </Tooltip>
                  ) : null}
                  {v.keeperLevel ? (
                    <Tooltip
                      title={`Keeper level (#${v.keeperRank} league-wide by PAS)`}
                    >
                      <StarIcon
                        sx={{ fontSize: 14, color: "#F9A825", verticalAlign: "middle" }}
                      />
                    </Tooltip>
                  ) : null}
                  {!starter ? (
                    <Typography component="span" variant="caption" color="text.disabled">
                      {" "}
                      bench
                    </Typography>
                  ) : null}
                  {v.injuryStatus ? (
                    <Chip
                      label={v.injuryStatus}
                      size="small"
                      color="error"
                      variant="outlined"
                      sx={{ ml: 0.5, height: 16, fontSize: "0.6rem" }}
                    />
                  ) : null}
                </TableCell>
                <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                  {v.age ?? "—"}
                </TableCell>
                <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                  {v.byeWeek ?? "—"}
                </TableCell>
                <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                  {fmtPts(v.points)}
                  {v.overridden ? "*" : ""}
                </TableCell>
                <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                  {fmtPts(v.ppg)}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    ...numSx,
                    fontWeight: 600,
                    color: v.parStarter > 0 ? "success.main" : "text.disabled",
                  }}
                >
                  {fmtPar(v.parStarter)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {fmtPar(v.par)}
                </TableCell>
                <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                  {fmtVariance(v.parVariance)}
                </TableCell>
                <TableCell sx={hideOnMobile}>
                  <Tooltip
                    title={
                      v.history.length > 0
                        ? v.history
                            .map(
                              (h) =>
                                `${h.season}: ${fmtPar(h.par)} PAR/G, ${fmtPts(h.ppg)} ppg over ${h.gp} games`
                            )
                            .join(" · ")
                        : "No past-season data (rookie or didn't play)"
                    }
                  >
                    <Typography variant="body2" noWrap sx={numSx}>
                      {historyLabel(v)}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ ...numSx, color: durabilityColor(d.avgGp), ...hideOnMobile }}
                >
                  {d.avgGp != null ? d.avgGp.toFixed(1) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Historical roster: the real end-of-season roster at actual stats. */
export function SeasonTeamRoster({
  players,
  onSelect,
}: {
  players: SeasonBoardPlayer[];
  onSelect?: (player: SeasonBoardPlayer) => void;
}) {
  const rows = [...players].sort((a, b) =>
    a.gp > 0 && b.gp > 0 ? b.parStarter - a.parStarter : b.gp - a.gp
  );
  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth: { xs: 0, md: 560 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Pos</TableCell>
            <TableCell>Player</TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              GP
            </TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              Points
            </TableCell>
            <TableCell align="right">PPG</TableCell>
            <TableCell align="right">PAS/G</TableCell>
            <TableCell align="right" sx={hideOnMobile}>
              PAR/G
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((p) => (
            <TableRow
              key={p.playerId}
              hover
              onClick={onSelect ? () => onSelect(p) : undefined}
              sx={onSelect ? { cursor: "pointer" } : undefined}
            >
              <TableCell>
                <PositionChip position={p.position} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap>
                  {p.name}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                {p.gp}
              </TableCell>
              <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                {fmtPts(p.points)}
              </TableCell>
              <TableCell align="right" sx={numSx}>
                {p.gp > 0 ? fmtPts(p.ppg) : "—"}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  ...numSx,
                  fontWeight: 600,
                  color: p.parStarter > 0 ? "success.main" : "text.disabled",
                }}
              >
                {p.gp > 0 ? fmtPar(p.parStarter) : "—"}
              </TableCell>
              <TableCell align="right" sx={{ ...numSx, ...hideOnMobile }}>
                {p.gp > 0 ? fmtPar(p.par) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
