import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import type { ThrawnLeague } from "./types";

/** League list + add-league form for /thrawn */
export function ThrawnView() {
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<ThrawnLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeagues(await api.thrawnLeagues());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load leagues");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    const id = leagueId.trim();
    if (!id) return;
    setAdding(true);
    setError(null);
    try {
      const league = await api.thrawnCreateLeague(id);
      navigate(`/thrawn/${league.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to add league — check the ID"
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.thrawnDeleteLeague(id);
      setLeagues((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete league");
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Box>
        <Typography
          variant="overline"
          sx={{ letterSpacing: 4, color: "secondary.main" }}
        >
          Thrawn
        </Typography>
        <Typography
          variant="h3"
          sx={{ fontWeight: 500, fontSize: { xs: "1.85rem", md: "2.4rem" } }}
        >
          Trade analyzer
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Fantasy football player values, keeper analysis, and trade targets
          built on your Sleeper league.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          label="Sleeper league ID"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          size="small"
          fullWidth
          placeholder="e.g. 1389331192800636928"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
        />
        <Button
          variant="contained"
          onClick={() => void handleAdd()}
          disabled={adding || leagueId.trim() === ""}
          sx={{ whiteSpace: "nowrap", minWidth: 140 }}
        >
          {adding ? "Syncing…" : "Track league"}
        </Button>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {loading ? (
        <CircularProgress />
      ) : leagues.length === 0 ? (
        <Box
          sx={{
            p: 4,
            borderRadius: 2.5,
            border: "1px dashed",
            borderColor: "divider",
            textAlign: "center",
            bgcolor: "background.paper",
          }}
        >
          <Typography color="text.secondary">
            No leagues yet. Paste your Sleeper league ID above to pull rosters
            and projections.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {leagues.map((l) => (
            <Card key={l.id} variant="outlined">
              <Stack direction="row" alignItems="center">
                <CardActionArea
                  onClick={() => navigate(`/thrawn/${l.id}`)}
                  sx={{ p: 2 }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Typography sx={{ fontWeight: 600 }}>{l.name}</Typography>
                    <Chip size="small" label={`${l.season} season`} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${l.settings.numTeams} teams · ${l.settings.maxKeepers} keepers`}
                    />
                    {l.lastSyncedAt ? (
                      <Typography variant="caption" color="text.secondary">
                        synced {new Date(l.lastSyncedAt).toLocaleString()}
                      </Typography>
                    ) : null}
                  </Stack>
                </CardActionArea>
                <IconButton
                  aria-label="Delete league"
                  onClick={() => void handleDelete(l.id)}
                  sx={{ mr: 1 }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
