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
import { useMemo } from "react";
import type { PlayerValue, ReplacementLevel } from "./types";
import { fmtPts, positionColor } from "./format";
import { computeStarterRisks } from "./teamDetail";

const numSx = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * Injury resilience: for each projected starter, the per-game cost of
 * losing them (next man up on the roster, or the waiver replacement),
 * weighted by how many games they've historically missed.
 */
export function TeamResilience({
  roster,
  starterIds,
  replacement,
}: {
  roster: PlayerValue[];
  starterIds: Set<string>;
  replacement: ReplacementLevel[];
}) {
  const risks = useMemo(
    () =>
      computeStarterRisks(roster, starterIds, replacement).sort(
        (a, b) => b.expectedLoss - a.expectedLoss
      ),
    [roster, starterIds, replacement]
  );
  const totalExpected = risks.reduce((s, r) => s + r.expectedLoss, 0);

  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>
            <TableCell>Starter</TableCell>
            <TableCell align="right">PPG</TableCell>
            <TableCell align="right">
              <Tooltip title="Average games played across past seasons; — means no history (rookie)">
                <span>Avg GP</span>
              </Tooltip>
            </TableCell>
            <TableCell>Next man up</TableCell>
            <TableCell align="right">
              <Tooltip title="PPG lost per game missed: starter PPG minus the best fallback">
                <span>Drop/G</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">
              <Tooltip title="Missed-game risk x drop-off: expected PPG lost to this starter's absences">
                <span>Exp. loss/G</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {risks.map((r) => (
            <TableRow key={r.player.playerId} hover>
              <TableCell>
                <Chip
                  label={r.player.position}
                  size="small"
                  sx={{
                    bgcolor: positionColor(r.player.position),
                    color: "#fff",
                    fontWeight: 700,
                    height: 20,
                    fontSize: "0.65rem",
                    mr: 0.75,
                  }}
                />
                <Typography component="span" variant="body2">
                  {r.player.name}
                </Typography>
                {r.player.injuryStatus ? (
                  <Chip
                    label={r.player.injuryStatus}
                    size="small"
                    color="error"
                    variant="outlined"
                    sx={{ ml: 0.5, height: 16, fontSize: "0.6rem" }}
                  />
                ) : null}
              </TableCell>
              <TableCell align="right" sx={numSx}>
                {fmtPts(r.player.ppg)}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  ...numSx,
                  color:
                    r.durability.avgGp == null
                      ? "text.secondary"
                      : r.durability.avgGp >= 15
                        ? "success.main"
                        : r.durability.avgGp >= 12.5
                          ? "warning.main"
                          : "error.main",
                }}
              >
                {r.durability.avgGp != null
                  ? r.durability.avgGp.toFixed(1)
                  : "—"}
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {r.backup && r.backup.ppg >= r.backupPpg - 0.01
                    ? `${r.backup.name} (${fmtPts(r.backup.ppg)})`
                    : `Waivers (${fmtPts(r.backupPpg)})`}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={numSx}>
                {fmtPts(r.dropoff)}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  ...numSx,
                  fontWeight: 600,
                  color:
                    r.expectedLoss > 1
                      ? "error.main"
                      : r.expectedLoss > 0.4
                        ? "warning.main"
                        : "text.secondary",
                }}
              >
                {fmtPts(r.expectedLoss)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={5} sx={{ fontWeight: 600 }}>
              Team total expected loss
            </TableCell>
            <TableCell align="right" sx={{ ...numSx, fontWeight: 700 }}>
              {fmtPts(totalExpected)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}
