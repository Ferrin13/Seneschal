import {
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api, type HuntRun } from "../api";
import { ageTextFine } from "../deals/shared";
import { formatCost, RUN_STATUS } from "./shared";

/** Compact label/value row used in the mobile (stacked-card) layouts. */
function Stat({
  label,
  value,
  error,
}: {
  label: string;
  value: ReactNode;
  error?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, color: error ? "error.main" : undefined }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function duration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return "<1s";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

/**
 * Lazy-loaded run history for a target, driven by mp_hunt_runs. Shows the most
 * recent scheduled/manual hunts with their outcome counts, cost, and status.
 */
export function RunHistory({
  targetId,
  onError,
}: {
  targetId: string;
  onError: (msg: string) => void;
}) {
  const [runs, setRuns] = useState<HuntRun[] | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const load = useCallback(async () => {
    try {
      setRuns(await api.targetRuns(targetId, 20));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load run history");
    }
  }, [targetId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (runs === null) {
    return (
      <Stack alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={22} />
      </Stack>
    );
  }

  if (runs.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No hunt runs yet. Runs appear here after the target hunts (on schedule or
        via “Hunt now”).
      </Typography>
    );
  }

  if (isMobile) {
    return (
      <Stack spacing={1.5}>
        {runs.map((r) => {
          const status = RUN_STATUS[r.status];
          return (
            <Box
              key={r.id}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1, gap: 1 }}
              >
                <Chip size="small" color={status.color} label={status.label} />
                <Typography variant="caption" color="text.secondary">
                  {ageTextFine(r.startedAt)} · {duration(r.startedAt, r.finishedAt)}
                </Typography>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  columnGap: 2,
                  rowGap: 0.5,
                }}
              >
                <Stat label="Found" value={r.discovered} />
                <Stat label="Promising" value={r.promising} />
                <Stat label="Evaluated" value={r.evaluated} />
                <Stat label="Errors" value={r.errors} error={r.errors > 0} />
                <Stat label="Cost" value={formatCost(r.costUsd)} />
              </Box>
              {r.error ? (
                <Typography
                  variant="caption"
                  color="error.main"
                  sx={{ mt: 1, display: "block" }}
                >
                  {r.error}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Stack>
    );
  }

  return (
    <Table size="small" sx={{ "& td, & th": { px: 1, whiteSpace: "nowrap" } }}>
      <TableHead>
        <TableRow>
          <TableCell>Started</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Took</TableCell>
          <Tooltip title="Listings discovered this run">
            <TableCell align="right">Found</TableCell>
          </Tooltip>
          <Tooltip title="Promising after triage">
            <TableCell align="right">Promising</TableCell>
          </Tooltip>
          <Tooltip title="Fully evaluated (scrape + comps + LLM)">
            <TableCell align="right">Evaluated</TableCell>
          </Tooltip>
          <TableCell align="right">Errors</TableCell>
          <TableCell align="right">Cost</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {runs.map((r) => {
          const status = RUN_STATUS[r.status];
          return (
            <TableRow key={r.id} hover>
              <TableCell>
                <Tooltip title={new Date(r.startedAt).toLocaleString()}>
                  <span>{ageTextFine(r.startedAt)}</span>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{ whiteSpace: "normal" }}
                >
                  <Chip size="small" color={status.color} label={status.label} />
                  {r.error ? (
                    <Tooltip title={r.error}>
                      <Box
                        component="span"
                        sx={{
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "error.main",
                          fontSize: "0.72rem",
                        }}
                      >
                        {r.error}
                      </Box>
                    </Tooltip>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell align="right">
                {duration(r.startedAt, r.finishedAt)}
              </TableCell>
              <TableCell align="right">{r.discovered}</TableCell>
              <TableCell align="right">{r.promising}</TableCell>
              <TableCell align="right">{r.evaluated}</TableCell>
              <TableCell
                align="right"
                sx={{ color: r.errors > 0 ? "error.main" : undefined }}
              >
                {r.errors}
              </TableCell>
              <TableCell align="right">{formatCost(r.costUsd)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
