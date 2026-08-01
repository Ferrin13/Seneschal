import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { CreateGameForm } from "./CreateGameForm";
import type { LazaxGame } from "./types";
import { PHASE_LABELS } from "./format";

/** Game list + create wizard for /lazax */
export function LazaxView() {
  const navigate = useNavigate();
  const [games, setGames] = useState<LazaxGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGames(await api.lazaxGames());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load games");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (creating) {
    return (
      <CreateGameForm
        onCreated={(id) => navigate(`/lazax/${id}`)}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={2}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ letterSpacing: 4, color: "secondary.main" }}
          >
            Lazax
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 500, fontSize: { xs: "1.85rem", md: "2.4rem" } }}
          >
            Turn timer
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Twilight Imperium — strategy, action, and agenda clocks.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setCreating(true)}>
          New game
        </Button>
      </Stack>

      {loading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : games.length === 0 ? (
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
            No games yet. Create one to start the clock.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {games.map((g) => (
            <Box
              key={g.id}
              onClick={() => navigate(`/lazax/${g.id}`)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                px: 2.5,
                py: 2,
                borderRadius: 2.5,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                cursor: "pointer",
                transition: "border-color 120ms ease, box-shadow 120ms ease",
                "&:hover": {
                  borderColor: "secondary.light",
                  boxShadow: 1,
                },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={600} noWrap>
                  {g.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Round {g.roundNumber} · {PHASE_LABELS[g.phase] ?? g.phase}
                </Typography>
              </Box>
              <Chip size="small" label={g.status} variant="outlined" />
              <Chip
                size="small"
                label={g.clockState}
                color={g.clockState === "running" ? "success" : "default"}
                variant="outlined"
              />
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
