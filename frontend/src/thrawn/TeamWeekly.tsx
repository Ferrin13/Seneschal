import { Alert, Box, Stack, Tooltip, Typography } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useMemo } from "react";
import type { PlayerValue } from "./types";
import { fmtPts } from "./format";
import { computeWeeklyOutlook, type WeekOutlook } from "./teamDetail";

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function barColor(w: WeekOutlook): string {
  if (w.unfilled > 0) return "error.main";
  if (w.starterByes.length >= 2) return "warning.main";
  if (w.starterByes.length === 1) return "warning.light";
  return "primary.main";
}

/**
 * Week-by-week best-lineup projection with bye congestion callouts. Weekly
 * shapes come from ESPN's weekly feed scaled to each player's effective
 * (league-scored, override-aware) season total.
 */
export function TeamWeekly({
  roster,
  rosterPositions,
  starterIds,
}: {
  roster: PlayerValue[];
  rosterPositions: string[];
  starterIds: Set<string>;
}) {
  const outlook = useMemo(
    () => computeWeeklyOutlook(roster, rosterPositions, starterIds),
    [roster, rosterPositions, starterIds]
  );
  const med = median(outlook.map((w) => w.points));
  const max = Math.max(...outlook.map((w) => w.points), 1);

  const crunches = outlook
    .filter((w) => w.starterByes.length > 0 || w.unfilled > 0)
    .sort((a, b) => a.points - b.points);

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0.75,
          height: 120,
          pt: 1,
        }}
      >
        {outlook.map((w) => (
          <Tooltip
            key={w.week}
            title={
              <>
                Week {w.week}: {fmtPts(w.points)} pts
                {w.byes.length > 0
                  ? ` · byes: ${w.byes.map((v) => v.name).join(", ")}`
                  : ""}
                {w.unfilled > 0 ? ` · ${w.unfilled} empty slot(s)` : ""}
              </>
            }
          >
            <Box sx={{ flex: 1, textAlign: "center", minWidth: 0 }}>
              <Box
                sx={{
                  height: `${Math.max(4, (w.points / max) * 96)}px`,
                  bgcolor: barColor(w),
                  borderRadius: 0.5,
                  opacity: 0.85,
                  "&:hover": { opacity: 1 },
                }}
              />
              <Typography
                variant="caption"
                color={w.starterByes.length > 0 ? "warning.main" : "text.secondary"}
                sx={{
                  fontSize: "0.6rem",
                  display: {
                    xs: w.week % 2 === 0 ? "none" : "block",
                    sm: "block",
                  },
                }}
              >
                {w.week}
              </Typography>
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Median week: {fmtPts(med)} pts. Amber bars have projected starters on
        bye; red bars leave a starting slot empty.
      </Typography>

      {crunches.length === 0 ? (
        <Alert severity="success">
          No bye-week congestion: no projected starters are on bye at the
          same time.
        </Alert>
      ) : (
        <Stack spacing={0.5}>
          {crunches.map((w) => (
            <Stack
              key={w.week}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ flexWrap: "wrap" }}
            >
              {w.starterByes.length >= 2 || w.unfilled > 0 ? (
                <WarningAmberIcon
                  sx={{ fontSize: 16 }}
                  color={w.unfilled > 0 ? "error" : "warning"}
                />
              ) : (
                <Box sx={{ width: 16 }} />
              )}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Week {w.week}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {w.starterByes.length} starter
                {w.starterByes.length === 1 ? "" : "s"} on bye
                {w.starterByes.length > 0
                  ? ` (${w.starterByes.map((v) => v.name).join(", ")})`
                  : ""}
                {" · "}projected {fmtPts(w.points)} ({fmtPts(w.points - med)}{" "}
                vs median)
                {w.unfilled > 0 ? ` · ${w.unfilled} slot(s) unfillable` : ""}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
