import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import type { LeagueValues, ProjectionSource } from "./types";
import { sourceLabel, teamLabel } from "./format";
import { LeagueBoard } from "./LeagueBoard";
import { PlayerTable } from "./PlayerTable";
import { TeamAnalysis } from "./TeamAnalysis";
import { TradeTargets } from "./TradeTargets";
import { TradeAnalyzer } from "./TradeAnalyzer";
import { RegressionTargets } from "./RegressionTargets";
import { DraftValue } from "./DraftValue";

type TabId =
  | "board"
  | "players"
  | "analysis"
  | "targets"
  | "analyzer"
  | "regression"
  | "draft";

/** League workspace for /thrawn/:leagueId — board, players, trades. */
export function LeagueView({ leagueId }: { leagueId: string }) {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<LeagueValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("board");

  const load = useCallback(async () => {
    setError(null);
    try {
      setSnapshot(await api.thrawnLeagueValues(leagueId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        navigate("/thrawn", { replace: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to load league");
    } finally {
      setLoading(false);
    }
  }, [leagueId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.thrawnSyncLeague(leagueId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSource = async (source: ProjectionSource) => {
    if (!snapshot) return;
    // Every PAR number depends on the source, so save then fully reload.
    setLoading(true);
    setError(null);
    try {
      await api.thrawnUpdateLeague(leagueId, { projectionSource: source });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save source");
      setLoading(false);
    }
  };

  const handleMyTeam = async (rosterId: number | null) => {
    if (!snapshot) return;
    // Optimistic: the picker drives the trade views immediately.
    setSnapshot({
      ...snapshot,
      league: { ...snapshot.league, myRosterId: rosterId },
    });
    try {
      await api.thrawnUpdateLeague(leagueId, { myRosterId: rosterId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save team");
      await load();
    }
  };

  if (loading) return <CircularProgress />;
  if (!snapshot) {
    return <Alert severity="error">{error ?? "Failed to load league"}</Alert>;
  }

  const { league, teams, valuation, rosterHistorySeasons, availableSources } =
    snapshot;
  // Offer synced sources only, but always include the saved selection so
  // the Select never holds an out-of-range value.
  const sourceOptions: ProjectionSource[] = [
    ...new Set<ProjectionSource>([
      "average",
      ...(["sleeper", "espn", "sharks"] as const).filter((s) =>
        availableSources.includes(s)
      ),
      league.projectionSource,
    ]),
  ];

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ md: "center" }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ letterSpacing: 4, color: "secondary.main" }}
          >
            Thrawn
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="h4" sx={{ fontWeight: 500 }}>
              {league.name}
            </Typography>
            <Chip size="small" label={`${league.season}`} />
            <Chip
              size="small"
              variant="outlined"
              label={`${league.settings.numTeams} teams · ${league.settings.maxKeepers} keepers`}
            />
          </Stack>
          {league.lastSyncedAt ? (
            <Typography variant="caption" color="text.secondary">
              Rosters synced {new Date(league.lastSyncedAt).toLocaleString()}
            </Typography>
          ) : null}
        </Box>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <FormControl size="small" sx={{ minWidth: 190, flexGrow: { xs: 1, sm: 0 } }}>
            <InputLabel id="projection-source-label">Projections</InputLabel>
            <Select
              labelId="projection-source-label"
              label="Projections"
              value={league.projectionSource}
              onChange={(e) =>
                void handleSource(e.target.value as ProjectionSource)
              }
            >
              {sourceOptions.map((s) => (
                <MenuItem key={s} value={s}>
                  {sourceLabel(s)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200, flexGrow: { xs: 1, sm: 0 } }}>
            <InputLabel id="my-team-label">My team</InputLabel>
            <Select
              labelId="my-team-label"
              label="My team"
              value={league.myRosterId ?? ""}
              onChange={(e) =>
                void handleMyTeam(
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {teams.map((t) => (
                <MenuItem key={t.rosterId} value={t.rosterId}>
                  {teamLabel(t)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Tooltip title="Re-pull rosters and projections from Sleeper">
            <span>
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={() => void handleSync()}
                disabled={syncing}
              >
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Tabs
        value={tab}
        onChange={(_e, v: TabId) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab value="board" label="League Board" />
        <Tab value="players" label="Players" />
        <Tab value="analysis" label="Team Analysis" />
        <Tab value="targets" label="Trade Targets" />
        <Tab value="analyzer" label="Trade Analyzer" />
        <Tab value="regression" label="Regression" />
        <Tab value="draft" label="Draft Value" />
      </Tabs>

      {tab === "board" ? (
        <LeagueBoard
          leagueId={leagueId}
          teams={teams}
          valuation={valuation}
          league={league}
          rosterHistorySeasons={rosterHistorySeasons}
        />
      ) : tab === "players" ? (
        <PlayerTable
          leagueId={leagueId}
          teams={teams}
          valuation={valuation}
          onChanged={load}
        />
      ) : tab === "analysis" ? (
        <TeamAnalysis
          leagueId={leagueId}
          teams={teams}
          valuation={valuation}
          league={league}
          rosterHistorySeasons={rosterHistorySeasons}
        />
      ) : tab === "targets" ? (
        <TradeTargets
          leagueId={leagueId}
          teams={teams}
          valuation={valuation}
          league={league}
        />
      ) : tab === "analyzer" ? (
        <TradeAnalyzer teams={teams} valuation={valuation} league={league} />
      ) : tab === "regression" ? (
        <RegressionTargets
          leagueId={leagueId}
          teams={teams}
          valuation={valuation}
        />
      ) : (
        <DraftValue valuation={valuation} league={league} />
      )}
    </Stack>
  );
}
