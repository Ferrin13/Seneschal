import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useState } from "react";
import { api, ApiError, type SearchTarget } from "../api";
import { ageTextFine } from "../deals/shared";
import { formatInterval } from "./shared";
import { ScheduleControls } from "./ScheduleControls";
import { SearchesSection } from "./SearchesSection";
import { RunHistory } from "./RunHistory";

export function TargetCard({
  target,
  onChanged,
  onError,
}: {
  target: SearchTarget;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [hunting, setHunting] = useState(false);
  const [huntMsg, setHuntMsg] = useState<string | null>(null);
  const [runsSeq, setRunsSeq] = useState(0);

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

  const hunt = async () => {
    setHunting(true);
    setHuntMsg(null);
    try {
      const res = await api.hunt(target.id);
      setHuntMsg(res.started ? "Hunt started ✓" : "Already running");
      // A new run row will exist shortly; nudge the history to reload.
      setRunsSeq((n) => n + 1);
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

  const remove = async () => {
    try {
      await api.deleteTarget(target.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete target");
    }
  };

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderLeft: 4,
        borderLeftColor: (theme) =>
          target.isActive ? theme.palette.success.main : theme.palette.divider,
      }}
    >
      <CardContent sx={{ flex: 1 }}>
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
              <Button
                variant="text"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start"
              spacing={1}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
                    {target.title}
                  </Typography>
                  <Chip
                    size="small"
                    color={target.isActive ? "success" : "default"}
                    variant={target.isActive ? "filled" : "outlined"}
                    label={target.isActive ? "Active" : "Paused"}
                  />
                </Stack>
                <Typography
                  color="text.secondary"
                  variant="body2"
                  sx={{ mt: 0.5 }}
                >
                  {target.prompt}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Tooltip title="Edit target">
                  <IconButton
                    size="small"
                    aria-label="edit"
                    onClick={startEdit}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete target">
                  <IconButton
                    size="small"
                    aria-label="delete"
                    onClick={() => void remove()}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                disabled={hunting}
                onClick={() => void hunt()}
              >
                {hunting ? "Starting..." : "Hunt now"}
              </Button>
              <Chip
                size="small"
                variant="outlined"
                label={
                  target.isActive
                    ? `Every ${formatInterval(target.huntIntervalMin)}`
                    : "Schedule paused"
                }
              />
              <Typography variant="caption" color="text.secondary">
                Added {ageTextFine(target.createdAt)}
              </Typography>
              {huntMsg ? (
                <Typography variant="caption" color="text.secondary">
                  · {huntMsg}
                </Typography>
              ) : null}
            </Stack>

            {target.evalInstructions ? (
              <Typography
                color="text.secondary"
                variant="caption"
                sx={{ display: "block" }}
              >
                Rules: {target.evalInstructions}
              </Typography>
            ) : null}
          </Stack>
        )}

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 1 }}>
          <ScheduleControls
            target={target}
            onChanged={onChanged}
            onError={onError}
          />
        </Box>

        <Accordion
          disableGutters
          elevation={0}
          slotProps={{ transition: { unmountOnExit: true } }}
          sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Typography variant="subtitle2">Searches</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <SearchesSection targetId={target.id} onError={onError} />
          </AccordionDetails>
        </Accordion>

        <Accordion
          disableGutters
          elevation={0}
          slotProps={{ transition: { unmountOnExit: true } }}
          sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Typography variant="subtitle2">Run history</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            {/* Remount on runsSeq bump so a fresh "Hunt now" shows up. */}
            <RunHistory key={runsSeq} targetId={target.id} onError={onError} />
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}
