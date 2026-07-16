import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Search, type SearchTarget } from "./api";

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

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Marketplace targets</Typography>
        <Typography color="text.secondary" variant="body2">
          Describe what you're hunting for. We expand each target into concrete
          Facebook and Craigslist searches. "Hunt now" runs the full pipeline
          (search → triage → deep-scrape → comps → evaluate); each target also
          hunts automatically on a schedule.
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
        <Stack spacing={2}>
          {targets.map((t) => (
            <TargetCard
              key={t.id}
              target={t}
              onChanged={load}
              onError={setError}
            />
          ))}
        </Stack>
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
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [evalInstructions, setEvalInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      await api.createTarget({
        title: title.trim(),
        prompt: prompt.trim(),
        evalInstructions: evalInstructions.trim() || null,
      });
      setTitle("");
      setPrompt("");
      setEvalInstructions("");
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create target");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="subtitle1">New target</Typography>
          <TextField
            label="Title"
            placeholder="High quality books"
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />
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
          <Box>
            <Button
              variant="contained"
              disabled={saving || !title.trim() || !prompt.trim()}
              onClick={() => void submit()}
            >
              {saving ? "Adding..." : "Add target"}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function TargetCard({
  target,
  onChanged,
  onError,
}: {
  target: SearchTarget;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [searches, setSearches] = useState<Search[] | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [hunting, setHunting] = useState(false);
  const [huntMsg, setHuntMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(target.title);
  const [prompt, setPrompt] = useState(target.prompt);
  const [evalInstructions, setEvalInstructions] = useState(
    target.evalInstructions ?? ""
  );
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setTitle(target.title);
    setPrompt(target.prompt);
    setEvalInstructions(target.evalInstructions ?? "");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const dirty =
    title.trim() !== target.title ||
    prompt.trim() !== target.prompt ||
    (evalInstructions.trim() || "") !== (target.evalInstructions ?? "");

  const save = async () => {
    if (!title.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      await api.updateTarget(target.id, {
        title: title.trim(),
        prompt: prompt.trim(),
        evalInstructions: evalInstructions.trim() || null,
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update target");
    } finally {
      setSaving(false);
    }
  };

  const loadSearches = useCallback(async () => {
    try {
      setSearches(await api.targetSearches(target.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load searches");
    }
  }, [target.id, onError]);

  const hunt = async () => {
    setHunting(true);
    setHuntMsg(null);
    try {
      const res = await api.hunt(target.id);
      setHuntMsg(res.started ? "Hunt started ✓" : "Already running");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setHuntMsg("Already running");
      } else {
        onError(err instanceof Error ? err.message : "Failed to start hunt");
      }
    } finally {
      setHunting(false);
    }
  };

  const expand = async () => {
    setExpanding(true);
    try {
      await api.expandTarget(target.id);
      await loadSearches();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        onError("LLM not configured on the server (set LLM_API_KEY).");
      } else {
        onError(err instanceof Error ? err.message : "Failed to expand target");
      }
    } finally {
      setExpanding(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteTarget(target.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete target");
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        {editing ? (
          <Stack spacing={2}>
            <TextField
              label="Title"
              size="small"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />
            <TextField
              label="What are you looking for?"
              size="small"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            <TextField
              label="Evaluation instructions (optional)"
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
                disabled={saving || !dirty || !title.trim() || !prompt.trim()}
                onClick={() => void save()}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button variant="text" disabled={saving} onClick={cancelEdit}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
          >
            <Box>
              <Typography variant="h6">{target.title}</Typography>
              <Typography color="text.secondary" variant="body2">
                {target.prompt}
              </Typography>
              {target.evalInstructions ? (
                <Typography
                  color="text.secondary"
                  variant="caption"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Rules: {target.evalInstructions}
                </Typography>
              ) : null}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              {huntMsg ? (
                <Typography variant="caption" color="text.secondary">
                  {huntMsg}
                </Typography>
              ) : null}
              <Button
                size="small"
                variant="contained"
                disabled={hunting}
                onClick={() => void hunt()}
              >
                {hunting ? "Starting..." : "Hunt now"}
              </Button>
              <Button size="small" variant="outlined" onClick={startEdit}>
                Edit
              </Button>
              <IconButton
                size="small"
                aria-label="delete"
                onClick={() => void remove()}
              >
                &times;
              </IconButton>
            </Stack>
          </Stack>
        )}

        <Divider sx={{ my: 2 }} />

        <Accordion
          disableGutters
          onChange={(_e, expanded) => {
            if (expanded && searches === null) void loadSearches();
          }}
        >
          <AccordionSummary>
            <Typography variant="subtitle2">Searches</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Button
                size="small"
                variant="outlined"
                disabled={expanding}
                onClick={() => void expand()}
              >
                {expanding ? "Expanding..." : "Expand with AI"}
              </Button>
              {searches === null ? (
                <Typography color="text.secondary" variant="body2">
                  Expand this target to generate searches.
                </Typography>
              ) : searches.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                  No searches yet.
                </Typography>
              ) : (
                searches.map((s) => <SearchRow key={s.id} search={s} />)
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function SearchRow({ search }: { search: Search }) {
  const max = search.filters?.maxPriceCents;
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="space-between"
    >
      <Box>
        <Typography variant="body2">{search.query}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            color={search.platform === "facebook" ? "primary" : "secondary"}
            label={search.platform}
          />
          <Chip size="small" variant="outlined" label={search.source} />
          {max != null ? (
            <Chip size="small" label={`<= $${Math.round(max / 100)}`} />
          ) : null}
        </Stack>
      </Box>
      {search.searchUrl ? (
        <Link href={search.searchUrl} target="_blank" rel="noreferrer">
          Open
        </Link>
      ) : null}
    </Stack>
  );
}
