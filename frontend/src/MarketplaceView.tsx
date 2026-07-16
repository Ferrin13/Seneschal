import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { api, type SearchTarget } from "./api";
import { TargetCard } from "./targets/TargetCard";
import { CADENCE_PRESETS, formatInterval } from "./targets/shared";

export function MarketplaceView() {
  const [targets, setTargets] = useState<SearchTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTargets(await api.targets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load targets");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = targets?.filter((t) => t.isActive).length ?? 0;

  return (
    <Stack spacing={3}>
      <Box>
        <Stack
          direction="row"
          spacing={2}
          alignItems="baseline"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="h5">Marketplace targets</Typography>
          {targets && targets.length > 0 ? (
            <Typography variant="body2" color="text.secondary">
              {targets.length} target{targets.length === 1 ? "" : "s"} ·{" "}
              {activeCount} active
            </Typography>
          ) : null}
        </Stack>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
          Describe what you're hunting for. We expand each target into concrete
          Facebook and Craigslist searches. "Hunt now" runs the full pipeline
          (search → triage → deep-scrape → comps → evaluate); each active target
          also hunts automatically on its own schedule.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <NewTargetForm onCreated={load} onError={setError} />

      {targets === null ? (
        <Stack alignItems="center" sx={{ mt: 4 }}>
          <CircularProgress />
        </Stack>
      ) : targets.length === 0 ? (
        <Typography color="text.secondary">No targets yet.</Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            alignItems: "stretch",
            gridTemplateColumns: {
              xs: "1fr",
              lg: "repeat(auto-fill, minmax(680px, 1fr))",
            },
          }}
        >
          {targets.map((t) => (
            <TargetCard
              key={t.id}
              target={t}
              onChanged={load}
              onError={setError}
            />
          ))}
        </Box>
      )}
    </Stack>
  );
}

function NewTargetForm({
  onCreated,
  onError,
}: {
  onCreated: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [evalInstructions, setEvalInstructions] = useState("");
  const [cadence, setCadence] = useState(30);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setPrompt("");
    setEvalInstructions("");
    setCadence(30);
  };

  const submit = async () => {
    if (!title.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      await api.createTarget({
        title: title.trim(),
        prompt: prompt.trim(),
        evalInstructions: evalInstructions.trim() || null,
        huntIntervalMin: cadence,
      });
      reset();
      setOpen(false);
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create target");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Box>
        <Button variant="contained" onClick={() => setOpen(true)}>
          + New target
        </Button>
      </Box>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="subtitle1">New target</Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems="flex-start"
          >
            <TextField
              label="Title"
              placeholder="High quality books"
              size="small"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />
            <TextField
              select
              label="Cadence"
              size="small"
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
              sx={{ minWidth: 160 }}
            >
              {CADENCE_PRESETS.map((min) => (
                <MenuItem key={min} value={min}>
                  Every {formatInterval(min)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="What are you looking for?"
            placeholder="Hardcover sets, first editions, collectible non-fiction in good condition"
            size="small"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            label="Evaluation instructions (optional)"
            placeholder="Ignore textbooks and anything with water damage"
            size="small"
            value={evalInstructions}
            onChange={(e) => setEvalInstructions(e.target.value)}
            multiline
            minRows={1}
            fullWidth
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={saving || !title.trim() || !prompt.trim()}
              onClick={() => void submit()}
            >
              {saving ? "Adding..." : "Add target"}
            </Button>
            <Button
              variant="text"
              disabled={saving}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
