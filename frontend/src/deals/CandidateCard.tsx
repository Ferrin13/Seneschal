import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import type { Candidate } from "../api";
import { DealChip, FitChip, StatusBadge, TriageBadge } from "./DealBadges";
import {
  DISPOSITION,
  PLATFORM_COLOR,
  ageText,
  ageTextFine,
  money,
} from "./shared";

export function CandidateCard({
  candidate: c,
  onClick,
}: {
  candidate: Candidate;
  onClick: () => void;
}) {
  const e = c.evaluation;
  const dates = [
    ageText(c.sourceListedAt) && `Posted ${ageText(c.sourceListedAt)}`,
    ageTextFine(c.sourceUpdatedAt) && `Updated ${ageTextFine(c.sourceUpdatedAt)}`,
    ageTextFine(c.firstSeenAt) && `Added ${ageTextFine(c.firstSeenAt)}`,
  ].filter(Boolean);
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{ cursor: "pointer", "&:hover": { boxShadow: 3 } }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
        <Typography
          variant="subtitle1"
          title={c.title ?? ""}
          sx={{
            fontWeight: 700,
            lineHeight: 1.25,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {c.title ?? "(untitled)"}
        </Typography>
      </Box>

      {c.thumbnailUrl ? (
        <CardMedia
          component="img"
          height="150"
          image={c.thumbnailUrl}
          alt={c.title ?? ""}
          referrerPolicy="no-referrer"
        />
      ) : null}

      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1 }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {money(c.priceCents)}
          </Typography>
          <StatusBadge status={c.status} />
          {c.disposition !== "none" ? (
            <Chip
              size="small"
              color={DISPOSITION[c.disposition].color}
              label={DISPOSITION[c.disposition].label}
            />
          ) : null}
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 1 }}
          flexWrap="wrap"
          useFlexGap
        >
          <DealChip value={e?.valueScore ?? null} confidence={e?.confidence ?? null} />
          <FitChip fit={e?.fitScore ?? c.triageScore} />
        </Stack>

        {e?.estimatedValueCents != null ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Est. value {money(e.estimatedValueCents)}
            {c.compsCount ? ` · ${c.compsCount} comps` : ""}
          </Typography>
        ) : c.compsCount ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {c.compsCount} comps
          </Typography>
        ) : null}
        {e?.rationale ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {e.rationale}
          </Typography>
        ) : null}

        <Divider sx={{ my: 1 }} />

        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            variant="outlined"
            color={PLATFORM_COLOR[c.platform]}
            label={c.platform}
          />
          <TriageBadge candidate={c} />
        </Stack>
        {c.triageStatus === "rejected" && c.triageReason ? (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.5 }}
          >
            Rejected in triage: {c.triageReason}
          </Typography>
        ) : null}

        {dates.length > 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 1 }}
          >
            {dates.join(" · ")}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
