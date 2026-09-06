import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_WEIGHTS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  statsInCategory,
  type Weights,
} from "./stats";

/**
 * Edits the shared OVR formula: one weight per stat. Category scores use the
 * same weights restricted to their stats. Saving affects everyone.
 */
export function WeightsDialog({
  open,
  weights,
  onClose,
  onSaved,
}: {
  open: boolean;
  weights: Weights;
  onClose: () => void;
  onSaved: (weights: Weights) => void;
}) {
  const [draft, setDraft] = useState<Weights>(weights);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(weights);
      setError(null);
    }
  }, [open, weights]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.moneyballSetWeights(draft);
      onSaved(res.weights);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save weights");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        OVR formula
        <Typography variant="body2" color="text.secondary">
          Weighted mean of the team's average per stat. Weight 0 drops a stat
          entirely. Shared with every rater.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          {CATEGORIES.map((c) => (
            <Stack key={c} spacing={0.5}>
              <Typography
                variant="overline"
                sx={{ fontWeight: 700, letterSpacing: 1.5 }}
              >
                {CATEGORY_LABELS[c]}
              </Typography>
              {statsInCategory(c).map((s) => (
                <Stack
                  key={s.key}
                  direction="row"
                  alignItems="center"
                  spacing={2}
                >
                  <Tooltip title={s.description} placement="top-start" enterDelay={300}>
                    <Typography
                      sx={{ width: 150, flexShrink: 0, cursor: "help" }}
                      variant="body2"
                    >
                      {s.label}
                    </Typography>
                  </Tooltip>
                  <Slider
                    size="small"
                    min={MIN_WEIGHT}
                    max={MAX_WEIGHT}
                    step={0.5}
                    marks
                    value={draft[s.key]}
                    onChange={(_e, v) =>
                      setDraft((d) => ({ ...d, [s.key]: v as number }))
                    }
                    valueLabelDisplay="auto"
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      width: 32,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {draft[s.key].toFixed(1)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ))}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDraft(DEFAULT_WEIGHTS)} disabled={saving}>
          Reset to 1.0
        </Button>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void save();
          }}
          disabled={saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
