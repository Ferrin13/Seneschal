import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type BrowserAgentState,
  type BrowserAgentStatus as Status,
} from "../api";

/** Re-probe cadence while the panel is mounted. Each probe is a live round trip. */
const POLL_MS = 60_000;

type Busy = "status" | "reconnect" | "rebuild_tunnel" | null;

const CHIP: Record<
  BrowserAgentState,
  { label: string; color: "success" | "warning" | "error" | "default" }
> = {
  connected: { label: "Connected", color: "success" },
  needs_login: { label: "Login needed", color: "warning" },
  wrong_browser: { label: "Wrong browser", color: "error" },
  tunnel_down: { label: "Tunnel down", color: "error" },
  agent_offline: { label: "Agent offline", color: "error" },
  error: { label: "Check failed", color: "default" },
};

/**
 * Live health of the Facebook scraping path (agent host -> SSH reverse tunnel
 * -> the operator's logged-in Chrome), with the two remote fixes the box can
 * apply on its own. Anything on the operator's machine (Chrome closed, tunnel
 * script not running, logged out) still needs a human there; the panel says so.
 */
export function BrowserAgentStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const busyRef = useRef<Busy>(null);

  const run = useCallback(
    async (action: Exclude<Busy, null>) => {
      if (busyRef.current) return;
      busyRef.current = action;
      setBusy(action);
      setError(null);
      try {
        const next =
          action === "reconnect"
            ? await api.browserAgentReconnect()
            : action === "rebuild_tunnel"
              ? await api.browserAgentRebuildTunnel()
              : await api.browserAgent();
        setStatus(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Status check failed");
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    []
  );

  useEffect(() => {
    void run("status");
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void run("status");
    }, POLL_MS);
    return () => clearInterval(id);
  }, [run]);

  const summary = status?.summary;
  const chip = summary ? CHIP[summary.state] : null;
  const probe = status?.probe ?? null;

  return (
    <Card variant="outlined">
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="subtitle1">Facebook browser</Typography>
            {chip ? (
              <Chip size="small" label={chip.label} color={chip.color} />
            ) : (
              <Chip size="small" label="Checking…" />
            )}
            {busy ? <CircularProgress size={16} /> : null}
            <Box sx={{ flex: 1 }} />
            {status ? (
              <Typography variant="caption" color="text.secondary">
                Checked {formatAgo(status.checkedAt)}
                {status.action !== "status"
                  ? ` · after ${status.action === "reconnect" ? "reconnect" : "tunnel rebuild"}`
                  : ""}
              </Typography>
            ) : null}
          </Stack>

          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : summary ? (
            <Typography variant="body2" color="text.secondary">
              <strong>{summary.headline}.</strong> {summary.detail}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Probing the agent host and tunnel…
            </Typography>
          )}

          {status?.needsLoginSince && summary?.state !== "connected" ? (
            <Typography variant="caption" color="warning.main">
              A hunt hit a Facebook login wall{" "}
              {formatAgo(status.needsLoginSince)}; this clears once the browser
              is seen logged in.
            </Typography>
          ) : null}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="outlined"
              disabled={busy !== null}
              onClick={() => void run("status")}
            >
              {busy === "status" ? "Checking…" : "Re-check"}
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={busy !== null || !(summary?.canReconnect ?? false)}
              onClick={() => void run("reconnect")}
              title="Drop the agent's cached CDP connection and redial the tunnel"
            >
              {busy === "reconnect" ? "Reconnecting…" : "Reconnect browser"}
            </Button>
            <Button
              size="small"
              variant="contained"
              color={summary?.state === "wrong_browser" ? "error" : "primary"}
              disabled={busy !== null || !(summary?.canRebuildTunnel ?? false)}
              onClick={() => void run("rebuild_tunnel")}
              title="On the agent host: stop any legacy Chrome on port 9222 and bounce the SSH session so the operator's keep-alive script reconnects (takes up to ~30s)"
            >
              {busy === "rebuild_tunnel" ? "Rebuilding…" : "Rebuild tunnel"}
            </Button>
            {probe ? (
              <Button
                size="small"
                variant="text"
                onClick={() => setShowDetails((v) => !v)}
              >
                {showDetails ? "Hide details" : "Details"}
              </Button>
            ) : null}
          </Stack>

          {probe ? (
            <Collapse in={showDetails}>
              <Box
                component="dl"
                sx={{
                  m: 0,
                  display: "grid",
                  gridTemplateColumns: "max-content 1fr",
                  columnGap: 2,
                  rowGap: 0.25,
                  "& dt": { color: "text.secondary" },
                  "& dd": { m: 0, fontFamily: "monospace", fontSize: 13 },
                }}
              >
                <dt>Agent</dt>
                <dd>{probe.agentName}</dd>
                <dt>CDP</dt>
                <dd>
                  {probe.cdp.url} —{" "}
                  {probe.cdp.reachable
                    ? probe.cdp.browser ?? "reachable"
                    : `unreachable${probe.cdp.error ? ` (${probe.cdp.error})` : ""}`}
                </dd>
                {probe.cdp.userAgent ? (
                  <>
                    <dt>User agent</dt>
                    <dd>{probe.cdp.userAgent}</dd>
                  </>
                ) : null}
                <dt>Facebook session</dt>
                <dd>
                  {probe.facebookLoggedIn === null
                    ? "unknown"
                    : probe.facebookLoggedIn
                      ? "logged in"
                      : "logged out"}
                </dd>
                <dt>Port 9222 on box</dt>
                <dd>
                  {probe.tunnel.available
                    ? `ipv4: ${probe.tunnel.ipv4Holder ?? "—"} · ipv6: ${probe.tunnel.ipv6Holder ?? "—"}` +
                      (probe.tunnel.legacyChromeActive
                        ? " · legacy Chrome ACTIVE"
                        : "")
                    : `helper unavailable${probe.tunnel.error ? ` (${probe.tunnel.error})` : ""}`}
                </dd>
              </Box>
            </Collapse>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
