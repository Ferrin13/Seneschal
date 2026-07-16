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
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { api, type HuntRun } from "../api";
import { ageTextFine } from "../deals/shared";
import { formatCost, RUN_STATUS } from "./shared";

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
