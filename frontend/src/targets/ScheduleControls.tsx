import {
  Box,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { api, type SearchTarget } from "../api";
import { CADENCE_PRESETS, formatInterval } from "./shared";

/**
 * Inline schedule controls for a target: an on/off switch that pauses/resumes
 * the recurring hunt, and a cadence picker that changes how often it runs. Both
 * PATCH immediately and refresh the parent; the schedule is reconciled server-side.
 */
export function ScheduleControls({
  target,
  onChanged,
  onError,
}: {
  target: SearchTarget;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [savingActive, setSavingActive] = useState(false);
  const [savingCadence, setSavingCadence] = useState(false);

  // Ensure the target's current cadence is always selectable, even if it isn't
  // one of the presets (e.g. set via an env default like 30 or a custom value).
  const options = CADENCE_PRESETS.includes(target.huntIntervalMin)
    ? CADENCE_PRESETS
    : [...CADENCE_PRESETS, target.huntIntervalMin].sort((a, b) => a - b);

  const toggleActive = async (isActive: boolean) => {
    setSavingActive(true);
    try {
      await api.updateTarget(target.id, { isActive });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update schedule");
    } finally {
      setSavingActive(false);
    }
  };

  const changeCadence = async (huntIntervalMin: number) => {
    if (huntIntervalMin === target.huntIntervalMin) return;
    setSavingCadence(true);
    try {
      await api.updateTarget(target.id, { huntIntervalMin });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to change cadence");
    } finally {
      setSavingCadence(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <FormControlLabel
          control={
            <Switch
              checked={target.isActive}
              disabled={savingActive}
              onChange={(e) => void toggleActive(e.target.checked)}
            />
          }
          label={
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">Auto-hunt</Typography>
              <Chip
                size="small"
                color={target.isActive ? "success" : "default"}
                variant={target.isActive ? "filled" : "outlined"}
                label={target.isActive ? "Active" : "Paused"}
              />
            </Stack>
          }
        />
        <TextField
          select
          size="small"
          label="Cadence"
          value={target.huntIntervalMin}
          disabled={savingCadence || !target.isActive}
          onChange={(e) => void changeCadence(Number(e.target.value))}
          sx={{ minWidth: 160 }}
        >
          {options.map((min) => (
            <MenuItem key={min} value={min}>
              Every {formatInterval(min)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  );
}
