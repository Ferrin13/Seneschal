import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_ROLE_WEIGHTS,
  DEFAULT_WEIGHTS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  ROLES,
  ROLE_LABELS,
  statsInCategory,
  type Role,
  type RoleWeights,
  type Weights,
} from "./stats";

type FormulaTab = "overall" | Role;

const TAB_BLURB: Record<FormulaTab, string> = {
  overall:
    "Weighted mean of the team's average per stat. Category scores use the same weights restricted to their stats.",
  handler: "How much each stat feeds the Handler OVR.",
  cutter: "How much each stat feeds the Cutter OVR.",
  defender: "How much each stat feeds the Defender OVR.",
};

/**
 * Edits the shared formulas: the OVR weight per stat, plus one weight table
 * per role (handler/cutter/defender OVRs). Weight 0 drops a stat entirely.
 * Saving affects everyone — the tables are shared, like the roster.
 */
export function WeightsDialog({
  open,
  weights,
  roleWeights,
  onClose,
  onSaved,
}: {
  open: boolean;
  weights: Weights;
  roleWeights: RoleWeights;
  onClose: () => void;
  onSaved: (weights: Weights, roleWeights: RoleWeights) => void;
}) {
  const [tab, setTab] = useState<FormulaTab>("overall");
  const [draft, setDraft] = useState<Weights>(weights);
  const [roleDraft, setRoleDraft] = useState<RoleWeights>(roleWeights);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(weights);
      setRoleDraft(roleWeights);
      setError(null);
    }
  }, [open, weights, roleWeights]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.moneyballSetWeights(draft, roleDraft);
      onSaved(res.weights, res.roleWeights);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save weights");
    } finally {
      setSaving(false);
    }
  };

  const table: Weights = tab === "overall" ? draft : roleDraft[tab];
  const setValue = (key: keyof Weights, v: number) => {
    if (tab === "overall") setDraft((d) => ({ ...d, [key]: v }));
    else setRoleDraft((rw) => ({ ...rw, [tab]: { ...rw[tab], [key]: v } }));
  };
  const resetTab = () => {
    if (tab === "overall") setDraft(DEFAULT_WEIGHTS);
    else setRoleDraft((rw) => ({ ...rw, [tab]: { ...DEFAULT_ROLE_WEIGHTS[tab] } }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Formulas
        <Typography variant="body2" color="text.secondary">
          Weight 0 drops a stat entirely. Shared with every rater.
        </Typography>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v as FormulaTab)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="overall" label="Overall" />
        {ROLES.map((r) => (
          <Tab key={r} value={r} label={ROLE_LABELS[r]} />
        ))}
      </Tabs>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {TAB_BLURB[tab]}
          </Typography>
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
                      sx={{
                        width: 150,
                        flexShrink: 0,
                        cursor: "help",
                        // Zero-weight stats read as "not part of this formula".
                        color: table[s.key] > 0 ? "text.primary" : "text.disabled",
                      }}
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
                    value={table[s.key]}
                    onChange={(_e, v) => setValue(s.key, v as number)}
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
                    {table[s.key].toFixed(1)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ))}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={resetTab} disabled={saving}>
          Reset {tab === "overall" ? "to 1.0" : `${ROLE_LABELS[tab]} to default`}
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
