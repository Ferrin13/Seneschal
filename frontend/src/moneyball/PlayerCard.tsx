import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { RatingGuideDialog } from "./RatingGuideDialog";
import { ScoreBadge } from "./ScoreBadge";
import {
  CATEGORIES,
  CATEGORY_ABBR,
  CATEGORY_LABELS,
  MAX_SCORE,
  ROLE_ABBR,
  ROLE_LABELS,
  ROLES,
  fmtScore,
  meansFromScores,
  roleScores,
  score,
  scoreTone,
  statsInCategory,
  type RoleScores,
  type RoleWeights,
  type Scorecard,
  type Scores,
  type Weights,
} from "./stats";
import type { BoardPlayer, PlayerDetail } from "./types";

const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
  default: "grey.400",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Stat label with its rubric description on hover. */
function StatLabel({ label, description }: { label: string; description: string }) {
  return (
    <Tooltip title={description} placement="top-start" enterDelay={300}>
      <Typography
        variant="body2"
        sx={{
          width: 140,
          flexShrink: 0,
          cursor: "help",
          textDecoration: "underline dotted",
          textDecorationColor: "rgba(0,0,0,0.25)",
          textUnderlineOffset: 3,
        }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}

/**
 * One stat row in view mode: label, bar, value, plus a thin marker for a
 * reference score. By default the bar is the team mean and the marker is the
 * viewer's own score; when a single rater is being viewed the bar is that
 * rater's score and the marker holds the team mean for comparison.
 */
function StatRow({
  label,
  description,
  mean,
  count,
  mine,
  rater,
}: {
  label: string;
  description: string;
  mean: number | null;
  count: number;
  mine: number | undefined;
  /** Set when the card is showing one rater's scores instead of the mean. */
  rater: { label: string; value: number | undefined } | null;
}) {
  const bar = rater ? rater.value ?? null : mean;
  const marker = rater ? mean : mine ?? null;
  const tooltip = rater
    ? `${rater.label}: ${rater.value ?? "not rated"} · team avg ${fmtScore(mean)}`
    : count === 0
      ? "No ratings yet"
      : `${count} rater${count === 1 ? "" : "s"}${mine != null ? ` · you: ${mine}` : ""}`;
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <StatLabel label={label} description={description} />
      <Tooltip title={tooltip} placement="top" enterDelay={400}>
        <Box sx={{ flexGrow: 1, position: "relative" }}>
          <LinearProgress
            variant="determinate"
            value={bar == null ? 0 : (bar / MAX_SCORE) * 100}
            sx={{
              height: 10,
              borderRadius: 5,
              bgcolor: "action.hover",
              "& .MuiLinearProgress-bar": {
                bgcolor: TONE_COLOR[scoreTone(bar)],
                borderRadius: 5,
              },
            }}
          />
          {marker != null ? (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                top: -3,
                left: `calc(${(marker / MAX_SCORE) * 100}% - 2px)`,
                width: 4,
                height: 16,
                borderRadius: 1,
                bgcolor: "text.primary",
                opacity: 0.7,
              }}
            />
          ) : null}
        </Box>
      </Tooltip>
      <Typography
        variant="body2"
        sx={{
          width: 32,
          textAlign: "right",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rater ? (rater.value != null ? rater.value : "–") : fmtScore(mean)}
      </Typography>
    </Stack>
  );
}

/** One stat row in edit mode: slider 0 (unrated) .. 10. */
function StatEditor({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <StatLabel label={label} description={description} />
      <Slider
        size="small"
        min={0}
        max={MAX_SCORE}
        step={1}
        marks
        value={value ?? 0}
        onChange={(_e, v) => onChange((v as number) === 0 ? undefined : (v as number))}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => (v === 0 ? "–" : String(v))}
        sx={{ flexGrow: 1 }}
      />
      <Typography
        variant="body2"
        sx={{
          width: 32,
          textAlign: "right",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value ?? "–"}
      </Typography>
    </Stack>
  );
}

/**
 * Madden-style player card. View mode shows the team's averaged ratings with
 * a marker for the viewer's own score; tapping a rater chip swaps the card to
 * that rater's individual scores (the marker then holds the team mean); edit
 * mode swaps in sliders and previews the OVR the viewer's rating alone would
 * produce.
 */
const EMPTY_SCORECARD: Scorecard = {
  overall: null,
  offense: null,
  defense: null,
  general: null,
};

const EMPTY_ROLES: RoleScores = { handler: null, cutter: null, defender: null };

export function PlayerCard({
  player,
  weights,
  roleWeights,
  masked = false,
  onSaved,
  onClose,
}: {
  player: BoardPlayer;
  weights: Weights;
  roleWeights: RoleWeights;
  /**
   * Hide everyone else's ratings (consensus scores, stat means, rater chips)
   * because the viewer hasn't rated this player yet.
   */
  masked?: boolean;
  /** Called with the fresh detail after a save/clear so the board can update. */
  onSaved: (detail: PlayerDetail | null) => void;
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Scores>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  /** Rater whose individual scores the card is showing; null = team average. */
  const [viewRaterId, setViewRaterId] = useState<string | null>(null);

  // Reset when switching players.
  useEffect(() => {
    setEditing(false);
    setError(null);
    setDetail(null);
    setViewRaterId(null);
    let cancelled = false;
    api
      .moneyballPlayer(player.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        // Breakdown is a nice-to-have; the board data is enough to render.
      });
    return () => {
      cancelled = true;
    };
  }, [player.id]);

  const startEditing = () => {
    setDraft({ ...(player.myRating ?? {}) });
    setEditing(true);
    setError(null);
  };

  const preview: Scorecard = useMemo(
    () => score(meansFromScores(draft), weights),
    [draft, weights]
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const d = await api.moneyballSetRating(player.id, draft);
      setDetail(d);
      onSaved(d);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save rating");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.moneyballClearRating(player.id);
      const d = await api.moneyballPlayer(player.id);
      setDetail(d);
      onSaved(d);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to clear rating");
    } finally {
      setSaving(false);
    }
  };

  // The rater whose card is being viewed, when one is selected and viewable.
  const viewedRater =
    !editing && !masked && viewRaterId != null
      ? detail?.raters.find((r) => r.userId === viewRaterId) ?? null
      : null;

  const scores = editing
    ? preview
    : viewedRater
      ? viewedRater.scorecard
      : masked
        ? EMPTY_SCORECARD
        : player.scores;

  // Role OVRs follow whatever the card is showing: the edit preview, one
  // rater's scores, or the consensus (which the server already computed).
  const roles: RoleScores = useMemo(() => {
    if (editing) return roleScores(meansFromScores(draft), roleWeights);
    if (viewedRater) return roleScores(meansFromScores(viewedRater.scores), roleWeights);
    return masked ? EMPTY_ROLES : player.roles;
  }, [editing, draft, viewedRater, masked, player.roles, roleWeights]);

  const othersHidden = masked && !editing && player.raterCount > 0;

  return (
    <Box
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        boxShadow: 3,
      }}
    >
      {/* Header: photo + identity + OVR */}
      <Box
        sx={{
          position: "relative",
          background:
            "linear-gradient(160deg, #1f1147 0%, #3b2a7a 55%, #5b46b8 100%)",
          color: "common.white",
          p: 2,
        }}
      >
        {onClose ? (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close card"
            sx={{
              position: "absolute",
              top: 6,
              right: 6,
              color: "inherit",
              display: { xs: "inline-flex", md: "none" },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : null}
        <Stack direction="row" spacing={2} alignItems="flex-end">
          <Box
            sx={{
              width: 128,
              height: 160,
              flexShrink: 0,
              borderRadius: 1.5,
              overflow: "hidden",
              bgcolor: "rgba(255,255,255,0.12)",
              boxShadow: 2,
            }}
          >
            {player.photoUrl ? (
              <Box
                component="img"
                src={player.photoUrl}
                alt={player.name}
                sx={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ) : (
              <Avatar
                variant="square"
                sx={{
                  width: "100%",
                  height: "100%",
                  fontSize: 40,
                  bgcolor: "transparent",
                }}
              >
                {initials(player.name)}
              </Avatar>
            )}
          </Box>
          <Stack spacing={1} sx={{ minWidth: 0, flexGrow: 1 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <ScoreBadge value={scores.overall} label="OVR" size="lg" />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="h5"
                  sx={{ fontWeight: 800, lineHeight: 1.1, wordBreak: "break-word" }}
                >
                  {player.name}
                </Typography>
                {player.team ? (
                  <Typography
                    variant="caption"
                    sx={{ opacity: 0.85, fontWeight: 600, letterSpacing: 0.5 }}
                    noWrap
                    display="block"
                  >
                    {player.team}
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {player.number != null ? `#${player.number} · ` : ""}
                  {editing
                    ? "Preview of your rating"
                    : viewedRater
                      ? viewedRater.isMe
                        ? "Viewing your rating"
                        : `Viewing ${viewedRater.label}'s rating`
                      : player.raterCount === 0
                        ? "Not rated yet"
                        : `${player.raterCount} rater${player.raterCount === 1 ? "" : "s"}`}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1}>
              {CATEGORIES.map((c) => (
                <ScoreBadge
                  key={c}
                  value={scores[c]}
                  label={CATEGORY_ABBR[c]}
                  size="sm"
                />
              ))}
            </Stack>
            {/* Role OVRs: what kind of player this is, per the role formulas. */}
            <Stack direction="row" spacing={1}>
              {ROLES.map((r) => (
                <Tooltip key={r} title={`${ROLE_LABELS[r]} OVR`} enterDelay={300}>
                  <Box sx={{ display: "inline-flex" }}>
                    <ScoreBadge value={roles[r]} label={ROLE_ABBR[r]} size="sm" />
                  </Box>
                </Tooltip>
              ))}
            </Stack>
          </Stack>
        </Stack>
      </Box>

      {/* Body: stats grouped by category */}
      <Stack spacing={2.5} sx={{ p: 2 }}>
        {othersHidden ? (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={startEditing} disabled={saving}>
                Rate player
              </Button>
            }
          >
            {player.raterCount === 1 ? "1 rating is" : `${player.raterCount} ratings are`}{" "}
            hidden until you rate this player.
          </Alert>
        ) : null}
        {CATEGORIES.map((c) => (
          <Stack key={c} spacing={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography
                variant="overline"
                sx={{ fontWeight: 700, letterSpacing: 1.5 }}
              >
                {CATEGORY_LABELS[c]}
              </Typography>
              <Chip
                size="small"
                label={fmtScore(scores[c])}
                color={
                  scoreTone(scores[c]) === "default"
                    ? "default"
                    : scoreTone(scores[c])
                }
                sx={{ fontWeight: 700 }}
              />
            </Stack>
            {statsInCategory(c).map((s) =>
              editing ? (
                <StatEditor
                  key={s.key}
                  label={s.label}
                  description={s.description}
                  value={draft[s.key]}
                  onChange={(v) =>
                    setDraft((d) => {
                      const next = { ...d };
                      if (v == null) delete next[s.key];
                      else next[s.key] = v;
                      return next;
                    })
                  }
                />
              ) : (
                <StatRow
                  key={s.key}
                  label={s.label}
                  description={s.description}
                  mean={masked ? null : player.stats[s.key]}
                  count={masked ? 0 : player.statCounts[s.key]}
                  mine={player.myRating?.[s.key]}
                  rater={
                    viewedRater
                      ? {
                          label: viewedRater.isMe ? "You" : viewedRater.label,
                          value: viewedRater.scores[s.key],
                        }
                      : null
                  }
                />
              )
            )}
          </Stack>
        ))}

        {!editing && !masked && detail && detail.raters.length > 0 ? (
          <Stack spacing={0.75}>
            <Stack direction="row" alignItems="baseline" spacing={1}>
              <Typography
                variant="overline"
                sx={{ fontWeight: 700, letterSpacing: 1.5 }}
              >
                Raters
              </Typography>
              <Typography variant="caption" color="text.secondary">
                tap one to see their scores
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                variant={viewRaterId == null ? "filled" : "outlined"}
                color={viewRaterId == null ? "primary" : "default"}
                label={`Team avg · ${fmtScore(player.scores.overall)}`}
                onClick={() => setViewRaterId(null)}
              />
              {detail.raters.map((r) => {
                const selected = r.userId === viewRaterId;
                return (
                  <Tooltip
                    key={r.userId}
                    title={`Updated ${new Date(r.updatedAt).toLocaleDateString()}`}
                  >
                    <Chip
                      size="small"
                      variant={selected ? "filled" : "outlined"}
                      color={selected ? "primary" : r.isMe ? "primary" : "default"}
                      label={`${r.isMe ? "You" : r.label} · ${fmtScore(r.scorecard.overall)}`}
                      // Tapping the selected rater again returns to the mean.
                      onClick={() => setViewRaterId(selected ? null : r.userId)}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          </Stack>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          {editing ? (
            <>
              <Button
                size="small"
                color="inherit"
                onClick={() => setGuideOpen(true)}
                sx={{ mr: "auto" }}
              >
                How to rate
              </Button>
              <Button onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  void save();
                }}
                disabled={saving}
              >
                Save my rating
              </Button>
            </>
          ) : (
            <>
              {player.myRating ? (
                <Button
                  color="inherit"
                  onClick={() => {
                    void clear();
                  }}
                  disabled={saving}
                >
                  Clear my rating
                </Button>
              ) : null}
              <Button variant="contained" onClick={startEditing} disabled={saving}>
                {player.myRating ? "Edit my rating" : "Rate player"}
              </Button>
            </>
          )}
        </Stack>
      </Stack>
      <RatingGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </Box>
  );
}