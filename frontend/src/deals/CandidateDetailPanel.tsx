import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
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
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useEffect, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateDetail,
  type Disposition,
  type EvaluationRating,
} from "../api";
import { DEAL_TIER, dealTier } from "../scoring";
import { DealScoreBadge, ScorePill, StatusBadge } from "./DealBadges";
import {
  DISPOSITION,
  DISPOSITION_OPTIONS,
  DISPOSITION_PANEL_BG,
  PLATFORM_COLOR,
  STAGE_LABEL,
  ageText,
  combineDealScore,
  eventReason,
  money,
} from "./shared";

/**
 * Large, clickable image carousel for the detail view. Shows one image at a
 * time so photos stay big; clicking the image (or the arrows) advances, and the
 * dots jump to a specific photo. Falls back to a plain image when there's only
 * one.
 */
function ImageCarousel({ images, alt }: { images: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const count = images.length;
  const go = (n: number) => setIdx((prev) => (prev + n + count) % count);

  const imgSx = {
    width: "100%",
    borderRadius: 1,
    display: "block",
    maxHeight: { xs: 360, sm: 420 },
    objectFit: "contain",
    bgcolor: "action.hover",
  } as const;

  if (count === 1) {
    return (
      <Box
        component="img"
        src={images[0]}
        alt={alt}
        referrerPolicy="no-referrer"
        sx={{ ...imgSx, mb: 2 }}
      />
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ position: "relative" }}>
        <Box
          component="img"
          src={images[idx]}
          alt={`${alt} ${idx + 1} of ${count}`}
          referrerPolicy="no-referrer"
          onClick={() => go(1)}
          sx={{ ...imgSx, cursor: "pointer" }}
        />
        <IconButton
          aria-label="Previous image"
          onClick={() => go(-1)}
          size="small"
          sx={{
            position: "absolute",
            top: "50%",
            left: 8,
            transform: "translateY(-50%)",
            bgcolor: "rgba(0,0,0,0.45)",
            color: "#fff",
            "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
        <IconButton
          aria-label="Next image"
          onClick={() => go(1)}
          size="small"
          sx={{
            position: "absolute",
            top: "50%",
            right: 8,
            transform: "translateY(-50%)",
            bgcolor: "rgba(0,0,0,0.45)",
            color: "#fff",
            "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
        <Box
          sx={{
            position: "absolute",
            bottom: 8,
            right: 8,
            px: 1,
            py: 0.25,
            borderRadius: 1,
            bgcolor: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontSize: 12,
          }}
        >
          {idx + 1} / {count}
        </Box>
      </Box>
      <Stack
        direction="row"
        spacing={0.75}
        justifyContent="center"
        sx={{ mt: 1, flexWrap: "wrap" }}
        useFlexGap
      >
        {images.map((_, i) => (
          <Box
            key={i}
            role="button"
            aria-label={`Go to image ${i + 1}`}
            onClick={() => setIdx(i)}
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              cursor: "pointer",
              bgcolor: i === idx ? "primary.main" : "action.disabled",
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

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

  // Sticky close affordance. It blends into the panel by using the same
  // (opaque) background as the content beneath it, with no divider, so it reads
  // as part of the sidebar rather than a separate bar.
  const makeCloseBar = (bg?: string) => (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        bgcolor: bg ?? "background.paper",
        px: 1,
        py: 0.5,
      }}
    >
      <IconButton onClick={onClose} size="small" aria-label="Close deal details">
        <CloseIcon />
      </IconButton>
    </Box>
  );

  if (error) {
    return (
      <>
        {makeCloseBar()}
        <Box sx={{ p: 3 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        {makeCloseBar()}
        <Box sx={{ p: 3, textAlign: "center" }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  const { candidate: c, listing, comps, evaluations, events, rating } = detail;
  const advanced = evaluations.find((e) => e.tier === "advanced");
  const triage = evaluations.find((e) => e.tier === "triage");
  const triageReason = triage?.rationale ?? c.triageReason;
  // All saved images for this listing, in order; fall back to the candidate
  // thumbnail when the listing hasn't been deep-scraped yet.
  const savedImages = (listing?.images ?? [])
    .filter((im): im is typeof im & { url: string } => Boolean(im.url))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((im) => im.url);
  const gallery =
    savedImages.length > 0
      ? savedImages
      : c.thumbnailUrl
        ? [c.thumbnailUrl]
        : [];
  const fitValue = advanced?.fitScore ?? triage?.fitScore ?? c.triageScore ?? null;
  const dealScoreValue = combineDealScore(advanced?.valueScore ?? null, fitValue);

  const dispositionSection = (
    <DispositionSection
      key={`disp-${c.id}`}
      candidate={c}
      onSaved={(updated) => {
        setDetail((d) => (d ? { ...d, candidate: updated } : d));
        onChanged?.();
      }}
      onClose={onClose}
    />
  );

  const triageSection =
    c.triageStatus === "rejected" || triageReason
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
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
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
      : null;

  const panelBg = DISPOSITION_PANEL_BG[c.disposition];

  return (
    <>
      {makeCloseBar(panelBg)}
      <Box
        sx={{
          p: { xs: 2, sm: 3 },
          bgcolor: panelBg,
        }}
      >
      {c.disposition !== "none" ? (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: `${DISPOSITION[c.disposition].color}.main`,
            mb: 0.5,
          }}
        >
          {DISPOSITION[c.disposition].label}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <Link
          href={c.listingUrl}
          target="_blank"
          rel="noreferrer"
          variant="h6"
          sx={{ flex: 1, minWidth: 0 }}
        >
          {c.title ?? "(untitled)"}
        </Link>
        <Typography variant="h6" sx={{ fontWeight: 700, flexShrink: 0 }}>
          {money(c.priceCents)}
        </Typography>
        <DealScoreBadge
          score={dealScoreValue}
          confidence={advanced?.confidence ?? null}
        />
      </Stack>

      <Stack
        direction="row"
        spacing={0.75}
        flexWrap="wrap"
        useFlexGap
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <ScorePill
          label="Value"
          score={advanced?.valueScore ?? null}
          hint="how good the price is vs. estimated market value"
        />
        <ScorePill
          label="Fit"
          score={fitValue}
          hint="how well this matches your search target and rules"
        />
        <Chip size="small" color={PLATFORM_COLOR[c.platform]} label={c.platform} />
        <StatusBadge status={c.status} />
      </Stack>

      {gallery.length > 0 ? (
        <ImageCarousel images={gallery} alt={c.title ?? "image"} />
      ) : null}

      <Stack
        direction="row"
        spacing={2}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Updated {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt)}
          </Typography>
        ) : null}
        {ageText(c.sourceListedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Listed {ageText(c.sourceListedAt)}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          Last seen {ageText(c.lastSeenAt) ?? "today"}
        </Typography>
      </Stack>

      {advanced ? (
        <Alert
          severity={(() => {
            const tier = dealTier(dealScoreValue);
            if (tier === "great_deal" || tier === "good_deal") return "success";
            if (tier === "maybe") return "warning";
            if (tier === "pass") return "error";
            return "info";
          })()}
          sx={{ mb: 2 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {(() => {
              const tier = dealTier(dealScoreValue);
              const label = tier ? DEAL_TIER[tier].label : null;
              return dealScoreValue != null
                ? `${label} · deal score ${Math.round(dealScoreValue)}/100`
                : "Not evaluated";
            })()}
          </Typography>
          <Typography variant="body2">
            {[
              advanced.valueScore != null
                ? `Value ${advanced.valueScore}/100`
                : null,
              advanced.fitScore != null ? `Fit ${advanced.fitScore}/100` : null,
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

      {dispositionSection}

      {listing?.description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 2 }}>
          {listing.description.slice(0, 600)}
        </Typography>
      ) : null}

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
                  <TableCell>Condition</TableCell>
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
                      {cp.condition ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={cp.condition === "new" ? "info" : "default"}
                          label={cp.condition}
                        />
                      ) : (
                        "—"
                      )}
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

      {triageSection ? <Box sx={{ mt: 3 }}>{triageSection}</Box> : null}

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

      <RatingSection key={c.id} candidateId={c.id} initial={rating} />
      </Box>
    </>
  );
}
