import { Chip, Tooltip } from "@mui/material";
import type { Candidate, CandidateStatus } from "../api";
import { DEAL_TIER, dealTier, fitColor } from "../scoring";
import { TRIAGE } from "./shared";

/**
 * Deal-quality chip driven by the 0-100 value score (price vs. market). The
 * label/color come from fixed thresholds; the model's confidence is demoted to
 * the tooltip so a red "Pass · 30" is never confused with a high "84%".
 */
export function DealChip({
  value,
  confidence,
}: {
  value: number | null;
  confidence: number | null;
}) {
  const tier = dealTier(value);
  if (tier == null || value == null)
    return <Chip size="small" variant="outlined" label="Not evaluated" />;
  const t = DEAL_TIER[tier];
  const confPct = confidence != null ? Math.round(confidence * 100) : null;
  const tip =
    `Value ${value}/100 — how good the price is vs. estimated market value.` +
    (confPct != null ? ` Model ${confPct}% confident.` : "");
  return (
    <Tooltip title={tip}>
      <Chip size="small" color={t.color} label={`${t.label} · ${value}`} />
    </Tooltip>
  );
}

/** How well the listing matches the user's target + rules (0-100). */
export function FitChip({ fit }: { fit: number | null | undefined }) {
  if (fit == null) return null;
  return (
    <Tooltip
      title={`Fit ${fit}/100 — how well this matches your search target and rules.`}
    >
      <Chip
        size="small"
        variant="outlined"
        color={fitColor(fit)}
        label={`Fit ${fit}`}
      />
    </Tooltip>
  );
}

export function StatusBadge({ status }: { status: CandidateStatus }) {
  if (status === "active") return null;
  return (
    <Chip
      size="small"
      color={status === "sold" ? "warning" : "default"}
      label={status === "sold" ? "Likely sold" : "Disappeared"}
    />
  );
}

/**
 * Cheap first-pass triage result with its 0-100 score folded in. Distinct from
 * the promise/ranking score (which the advanced evaluation overwrites) and from
 * the verdict chip (the advanced verdict). Hidden until the candidate is triaged.
 */
export function TriageBadge({ candidate: c }: { candidate: Candidate }) {
  if (c.triageStatus === "pending") return null;
  const t = TRIAGE[c.triageStatus];
  const score = c.triageScore;
  const scoreText = score != null ? `score ${score}` : "no score";
  const tip = c.triageReason
    ? `Triage ${t.label} (${scoreText}): ${c.triageReason}`
    : `Cheap first-pass triage: ${t.label} (${scoreText}).`;
  return (
    <Tooltip title={tip}>
      <Chip
        size="small"
        variant="outlined"
        color={t.color}
        label={score != null ? `Triage ${t.label} · ${score}` : `Triage ${t.label}`}
      />
    </Tooltip>
  );
}
