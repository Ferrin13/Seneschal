import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Rating,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateDetail,
  type Disposition,
  type EvaluationRating,
} from "../api";
import { dealTier } from "../scoring";
import { DealChip, FitChip, StatusBadge, TriageBadge } from "./DealBadges";
import {
  DISPOSITION,
  DISPOSITION_OPTIONS,
  PLATFORM_COLOR,
  STAGE_LABEL,
  ageText,
  eventReason,
  money,
} from "./shared";

/** A single 1-10 accuracy score with an optional note. */
function AccuracyRating({
  label,
  hint,
  score,
  onScore,
  note,
  onNote,
}: {
  label: string;
  hint: string;
  score: number | null;
  onScore: (v: number | null) => void;
  note: string;
  onNote: (v: string) => void;
}) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mb: 0.5 }}
      >
        {hint}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Rating
          max={10}
          value={score}
          onChange={(_e, v) => onScore(v)}
          sx={{ "& .MuiRating-icon": { fontSize: "1.25rem" } }}
        />
        <Typography variant="caption" color="text.secondary">
          {score != null ? `${score}/10` : "Not rated"}
        </Typography>
      </Stack>
      <TextField
        fullWidth
        size="small"
        multiline
        placeholder="Optional note"
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
    </Box>
  );
}

/**
 * Lets the user disposition a deal (not a fit, keep watching, reached out,
 * etc.) with an optional note. Marking a deal "Not a fit" or "Sold" freezes it
 * server-side so the hunt pipeline stops refreshing it.
 */
function DispositionSection({
  candidate,
  onSaved,
  onClose,
}: {
  candidate: Candidate;
  onSaved: (updated: Candidate) => void;
  onClose: () => void;
}) {
  const [disposition, setDisposition] = useState<Disposition>(
    candidate.disposition
  );
  const [note, setNote] = useState(candidate.dispositionNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selecting/updating the disposition saves immediately (carrying the note)
  // and closes the drawer.
  const choose = async (next: Disposition) => {
    setDisposition(next);
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setDisposition(candidate.id, {
        disposition: next,
        note: note.trim() || null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setDisposition(candidate.disposition);
      setSaving(false);
      setError(
        err instanceof Error ? err.message : "Failed to save disposition"
      );
    }
  };

  return (
    <Box sx={{ mt: 2, p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Your disposition
      </Typography>
      <TextField
        fullWidth
        size="small"
        multiline
        label="Note"
        placeholder="Optional note (saved when you set a disposition)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        sx={{ mb: 1 }}
      />
      <FormControl fullWidth size="small" disabled={saving}>
        <InputLabel id="disposition-select-label">Disposition</InputLabel>
        <Select
          labelId="disposition-select-label"
          label="Disposition"
          value={disposition}
          onChange={(e) => void choose(e.target.value as Disposition)}
        >
          {DISPOSITION_OPTIONS.map((d) => (
            <MenuItem key={d} value={d}>
              {DISPOSITION[d].label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}

/**
 * User feedback on how accurate the analysis was. Rates the fit score and the
 * deal (value) score independently on a 1-10 scale, each with an optional note.
 * Upserts one rating per deal; re-submitting overwrites it.
 */
function RatingSection({
  candidateId,
  initial,
}: {
  candidateId: string;
  initial: EvaluationRating | null;
}) {
  const [fitAccuracy, setFitAccuracy] = useState<number | null>(
    initial?.fitAccuracy ?? null
  );
  const [fitNote, setFitNote] = useState(initial?.fitNote ?? "");
  const [valueAccuracy, setValueAccuracy] = useState<number | null>(
    initial?.valueAccuracy ?? null
  );
  const [valueNote, setValueNote] = useState(initial?.valueNote ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(
    initial?.updatedAt ?? null
  );
  const [error, setError] = useState<string | null>(null);

  const hasInput =
    fitAccuracy != null ||
    valueAccuracy != null ||
    fitNote.trim() !== "" ||
    valueNote.trim() !== "";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.rateCandidate(candidateId, {
        fitAccuracy,
        fitNote: fitNote.trim() || null,
        valueAccuracy,
        valueNote: valueNote.trim() || null,
      });
      setSavedAt(saved.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rating");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{ mt: 3, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}
    >
      <Typography variant="subtitle2" gutterBottom>
        Rate this analysis
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mb: 2 }}
      >
        How accurate were the scores? Your feedback helps improve future
        evaluations.
      </Typography>
      <Stack spacing={2}>
        <AccuracyRating
          label="Fit score accuracy"
          hint="How well the fit score reflected the real match to your target."
          score={fitAccuracy}
          onScore={setFitAccuracy}
          note={fitNote}
          onNote={setFitNote}
        />
        <AccuracyRating
          label="Deal score accuracy"
          hint="How well the deal score reflected the real value vs. market price."
          score={valueAccuracy}
          onScore={setValueAccuracy}
          note={valueNote}
          onNote={setValueNote}
        />
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
        <Button
          variant="contained"
          size="small"
          disabled={saving || !hasInput}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : savedAt ? "Update rating" : "Submit rating"}
        </Button>
        {savedAt ? (
          <Typography variant="caption" color="text.secondary">
            Saved {new Date(savedAt).toLocaleString()}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

export function CandidateDetailPanel({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const [showTriage, setShowTriage] = useState(false);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setShowHistory(false);
    setShowComps(false);
    setShowTriage(false);
    api
      .candidateDetail(id)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load")
      );
    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!detail) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  const { candidate: c, listing, comps, evaluations, events, rating } = detail;
  const advanced = evaluations.find((e) => e.tier === "advanced");
  const triage = evaluations.find((e) => e.tier === "triage");
  const triageReason = triage?.rationale ?? c.triageReason;
  const cover = listing?.images.find((i) => i.url)?.url ?? c.thumbnailUrl;

  return (
    <Box sx={{ p: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 1 }}
      >
        <Typography variant="h6" sx={{ pr: 2 }}>
          {c.title ?? "(untitled)"}
        </Typography>
        <Link component="button" onClick={onClose} sx={{ flexShrink: 0 }}>
          Close
        </Link>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip size="small" color={PLATFORM_COLOR[c.platform]} label={c.platform} />
        <Chip size="small" label={money(c.priceCents)} />
        <DealChip
          value={advanced?.valueScore ?? null}
          confidence={advanced?.confidence ?? null}
        />
        <FitChip fit={advanced?.fitScore ?? triage?.fitScore ?? c.triageScore} />
        <StatusBadge status={c.status} />
        <TriageBadge candidate={c} />
      </Stack>

      {cover ? (
        <Box
          component="img"
          src={cover}
          alt={c.title ?? ""}
          referrerPolicy="no-referrer"
          sx={{ width: "100%", borderRadius: 1, mb: 2, maxHeight: 260, objectFit: "cover" }}
        />
      ) : null}

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {ageText(c.sourceListedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Listed {ageText(c.sourceListedAt)}
          </Typography>
        ) : null}
        {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Updated {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt)}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          Last seen {ageText(c.lastSeenAt) ?? "today"}
        </Typography>
      </Stack>

      {advanced ? (
        <Alert
          severity={(() => {
            const tier = dealTier(advanced.valueScore);
            if (tier === "great_deal" || tier === "good_deal") return "success";
            if (tier === "maybe") return "warning";
            if (tier === "pass") return "error";
            return "info";
          })()}
          sx={{ mb: 2 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {[
              advanced.valueScore != null
                ? `Value ${advanced.valueScore}/100`
                : null,
              advanced.fitScore != null ? `fit ${advanced.fitScore}/100` : null,
              advanced.confidence != null
                ? `${Math.round(advanced.confidence * 100)}% confident`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
          {advanced.estimatedValueCents != null ? (
            <Typography variant="body2">
              Est. value {money(advanced.estimatedValueCents)} vs asking{" "}
              {money(c.priceCents)}
            </Typography>
          ) : null}
          {advanced.rationale ? (
            <Typography variant="body2">{advanced.rationale}</Typography>
          ) : null}
          {advanced.model ? (
            <Typography variant="caption" color="text.secondary">
              {advanced.model}
            </Typography>
          ) : null}
        </Alert>
      ) : null}

      {c.triageStatus === "rejected" || triageReason
        ? (() => {
            const triageAlert = (
              <Alert
                severity={c.triageStatus === "rejected" ? "error" : "info"}
                sx={{ mb: 2 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {c.triageStatus === "rejected"
                    ? "Rejected in triage"
                    : "Triage first-pass"}
                  {c.triageScore != null ? ` · score ${c.triageScore}` : ""}
                </Typography>
                {triageReason ? (
                  <Typography variant="body2">{triageReason}</Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No reason recorded.
                  </Typography>
                )}
                {triage?.model ? (
                  <Typography variant="caption" color="text.secondary">
                    {triage.model}
                  </Typography>
                ) : null}
              </Alert>
            );
            // Once there's a full value analysis, the triage first-pass is
            // secondary — collapse it behind a toggle by default.
            return advanced ? (
              <Box sx={{ mb: 2 }}>
                <Link
                  component="button"
                  type="button"
                  onClick={() => setShowTriage((v) => !v)}
                  underline="hover"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  <Typography variant="subtitle2">
                    {showTriage ? "▾" : "▸"} Triage first-pass
                    {c.triageScore != null ? ` · score ${c.triageScore}` : ""}
                  </Typography>
                </Link>
                <Collapse in={showTriage} unmountOnExit>
                  <Box sx={{ mt: 1 }}>{triageAlert}</Box>
                </Collapse>
              </Box>
            ) : (
              triageAlert
            );
          })()
        : null}

      {listing?.description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {listing.description.slice(0, 600)}
        </Typography>
      ) : null}

      <Link href={c.listingUrl} target="_blank" rel="noreferrer">
        Open original listing
      </Link>

      {comps.length > 0 ? (
        <Box sx={{ mt: 3 }}>
          <Link
            component="button"
            type="button"
            onClick={() => setShowComps((v) => !v)}
            underline="hover"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
          >
            <Typography variant="subtitle2">
              {showComps ? "▾" : "▸"} Comparables ({comps.length})
            </Typography>
          </Link>
          <Collapse in={showComps} unmountOnExit>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell>Match</TableCell>
                  <TableCell align="right">Price</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comps.map((cp) => (
                  <TableRow key={cp.id}>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={cp.source} />
                    </TableCell>
                    <TableCell>
                      {cp.url ? (
                        <Link href={cp.url} target="_blank" rel="noreferrer">
                          {cp.matchedTitle ?? "link"}
                        </Link>
                      ) : (
                        cp.matchedTitle ?? "—"
                      )}
                    </TableCell>
                    <TableCell align="right">{money(cp.priceCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Collapse>
        </Box>
      ) : null}

      <Box sx={{ mt: 3 }}>
        <Link
          component="button"
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
        >
          <Typography variant="subtitle2">
            {showHistory ? "▾" : "▸"} History
            {events.length > 0 ? ` (${events.length})` : ""}
          </Typography>
        </Link>
        <Collapse in={showHistory} unmountOnExit>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              No events yet.
            </Typography>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {events.map((ev) => (
              <Box key={ev.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    size="small"
                    label={STAGE_LABEL[ev.stage] ?? ev.stage}
                    color={ev.stage === "error" ? "error" : "default"}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(ev.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
                {ev.message ? (
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {ev.message}
                  </Typography>
                ) : null}
                {eventReason(ev.detail) ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 0.25 }}
                  >
                    {eventReason(ev.detail)}
                  </Typography>
                ) : null}
              </Box>
              ))}
            </Stack>
          )}
        </Collapse>
      </Box>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        First seen {new Date(c.firstSeenAt).toLocaleString()}
      </Typography>

      <DispositionSection
        key={`disp-${c.id}`}
        candidate={c}
        onSaved={(updated) => {
          setDetail((d) => (d ? { ...d, candidate: updated } : d));
          onChanged?.();
        }}
        onClose={onClose}
      />

      <RatingSection key={c.id} candidateId={c.id} initial={rating} />
    </Box>
  );
}
