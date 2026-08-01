import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { FactionIcon } from "./FactionIcon";
import type { CreatePlayerInput, Faction } from "./types";

type Row = {
  displayName: string;
  factionId: string;
};

const DEFAULT_COUNT = 6;

export function CreateGameForm({
  onCreated,
  onCancel,
}: {
  onCreated: (gameId: string) => void;
  onCancel: () => void;
}) {
  const [factions, setFactions] = useState<Faction[]>([]);
  const [name, setName] = useState("Twilight Imperium");
  const [playerCount, setPlayerCount] = useState(DEFAULT_COUNT);
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
      displayName: `Player ${i + 1}`,
      factionId: "",
    }))
  );
  const [speakerSeat, setSpeakerSeat] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.lazaxFactions().then((r) => setFactions(r.factions));
  }, []);

  useEffect(() => {
    setRows((prev) => {
      const next = [...prev];
      while (next.length < playerCount) {
        next.push({
          displayName: `Player ${next.length + 1}`,
          factionId: "",
        });
      }
      return next.slice(0, playerCount);
    });
    setSpeakerSeat((s) => Math.min(s, playerCount - 1));
  }, [playerCount]);

  const usedFactions = useMemo(
    () => new Set(rows.map((r) => r.factionId).filter(Boolean)),
    [rows]
  );

  const submit = async () => {
    setError(null);
    for (const r of rows) {
      if (!r.displayName.trim() || !r.factionId) {
        setError("Every seat needs a name and faction.");
        return;
      }
    }
    const players: CreatePlayerInput[] = rows.map((r, seatIndex) => ({
      displayName: r.displayName.trim(),
      factionId: r.factionId,
      seatIndex,
    }));
    setSaving(true);
    try {
      const snap = await api.lazaxCreateGame({
        name: name.trim() || "Twilight Imperium",
        players,
        speakerSeatIndex: speakerSeat,
      });
      onCreated(snap.game.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Typography variant="h5">New game</Typography>
      <TextField
        label="Game name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
      />
      <FormControl sx={{ maxWidth: 200 }}>
        <InputLabel>Players</InputLabel>
        <Select
          label="Players"
          value={playerCount}
          onChange={(e) => setPlayerCount(Number(e.target.value))}
        >
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Stack spacing={2}>
        {rows.map((row, i) => (
          <Box
            key={i}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "80px 1fr 1.4fr" },
              gap: 1.5,
              alignItems: "center",
            }}
          >
            <Typography color="text.secondary">Seat {i + 1}</Typography>
            <TextField
              size="small"
              label="Name"
              value={row.displayName}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...row, displayName: e.target.value };
                setRows(next);
              }}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Faction</InputLabel>
              <Select
                label="Faction"
                value={row.factionId}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, factionId: e.target.value };
                  setRows(next);
                }}
              >
                {factions.map((f) => (
                  <MenuItem
                    key={f.id}
                    value={f.id}
                    disabled={usedFactions.has(f.id) && row.factionId !== f.id}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FactionIcon factionId={f.id} color={f.color} size={22} />
                      <span>{f.name}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        ))}
      </Stack>

      <FormControl sx={{ maxWidth: 280 }}>
        <InputLabel>Speaker</InputLabel>
        <Select
          label="Speaker"
          value={speakerSeat}
          onChange={(e) => setSpeakerSeat(Number(e.target.value))}
        >
          {rows.map((r, i) => (
            <MenuItem key={i} value={i}>
              Seat {i + 1}
              {r.displayName ? ` — ${r.displayName}` : ""}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack direction="row" spacing={2}>
        <Button variant="contained" disabled={saving} onClick={() => void submit()}>
          Create game
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Stack>
    </Stack>
  );
}
