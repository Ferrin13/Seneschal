import { Box, Chip, SvgIcon, Tooltip } from "@mui/material";
import type { SvgIconProps, SxProps, Theme } from "@mui/material/styles";
import FacebookIcon from "@mui/icons-material/Facebook";
import type { Candidate, CandidateStatus, Platform } from "../api";
import { DEAL_TIER, dealTier } from "../scoring";
import { TRIAGE } from "./shared";

/** Brand-ish colors for each source. */
const PLATFORM_ICON_COLOR: Record<Platform, string> = {
  facebook: "#1877F2",
  craigslist: "#5A2D91",
};

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook Marketplace",
  craigslist: "Craigslist",
};

/** Craigslist's mark: a white peace symbol on the brand purple disc. */
function CraigslistIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="M12 2 V22 M12 12 L4.6 19.4 M12 12 L19.4 19.4"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </SvgIcon>
  );
}

/**
 * Small source icon shown inline with a listing title. Facebook uses its brand
 * mark; Craigslist uses its purple peace-symbol logo. Wrapped in a tooltip
 * naming the source.
 */
export function PlatformIcon({
  platform,
  sx,
}: {
  platform: Platform;
  sx?: SxProps<Theme>;
}) {
  const color = PLATFORM_ICON_COLOR[platform];
  return (
    <Tooltip title={PLATFORM_LABEL[platform]}>
      {platform === "facebook" ? (
        <FacebookIcon sx={{ color, ...sx }} />
      ) : (
        <CraigslistIcon sx={{ color, ...sx }} />
      )}
    </Tooltip>
  );
}

/**
 * Continuous green→red color for a 0-100 score (0 = red/worse, 100 =
 * green/better). Lets value/fit read as a heat scale instead of coarse tiers.
 */
function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  const hue = (s / 100) * 120; // 0 = red, 60 = amber, 120 = green
  return `hsl(${hue}, 68%, 36%)`;
}

/**
 * Headline deal-score badge: the 0-100 blend of value + fit. Shows just the
 * number (bold, colored on the green→red scale) so it reads cleanly next to the
 * price; the tier label (Great deal / Pass / …) and confidence live in the
 * tooltip.
 */
export function DealScoreBadge({
  score,
  confidence,
}: {
  score: number | null;
  confidence?: number | null;
}) {
  const rounded = score != null ? Math.round(score) : null;
  const tier = dealTier(rounded);
  if (tier == null || rounded == null)
    return <Chip size="small" variant="outlined" label="—" />;
  const confPct = confidence != null ? Math.round(confidence * 100) : null;
  const tip =
    `Deal score ${rounded}/100 — ${DEAL_TIER[tier].label}. The blend of value (price vs. market) and fit.` +
    (confPct != null ? ` Model ${confPct}% confident.` : "");
  return (
    <Tooltip title={tip}>
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: scoreColor(rounded),
          color: "#fff",
          px: 1,
          py: 0.25,
          borderRadius: 1.5,
          fontWeight: 800,
          fontSize: "1.05rem",
          lineHeight: 1.35,
          minWidth: 34,
        }}
      >
        {rounded}
      </Box>
    </Tooltip>
  );
}

/**
 * Secondary, color-coded score pill for the value/fit sub-metrics. Smaller and
 * lighter than {@link DealScoreBadge} so it clearly sits below the headline
 * deal score, while still conveying good/bad at a glance via the color scale.
 */
export function ScorePill({
  label,
  score,
  hint,
}: {
  label: string;
  score: number | null | undefined;
  hint: string;
}) {
  if (score == null) return null;
  const rounded = Math.round(score);
  return (
    <Tooltip title={`${label} ${rounded}/100 — ${hint}`}>
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          bgcolor: scoreColor(rounded),
          color: "#fff",
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontSize: "0.72rem",
          lineHeight: 1.5,
        }}
      >
        <Box component="span" sx={{ fontWeight: 500, opacity: 0.85 }}>
          {label}
        </Box>
        <Box component="span" sx={{ fontWeight: 700 }}>
          {rounded}
        </Box>
      </Box>
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
