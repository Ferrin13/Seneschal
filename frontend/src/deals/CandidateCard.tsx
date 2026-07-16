import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import UpdateOutlinedIcon from "@mui/icons-material/UpdateOutlined";
import type { ReactNode } from "react";
import type { Candidate } from "../api";
import {
  DealScoreBadge,
  PlatformIcon,
  ScorePill,
  StatusBadge,
} from "./DealBadges";
import {
  DISPOSITION,
  DISPOSITION_TINT,
  ageText,
  ageTextFine,
  candidateDealScore,
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
  const iconSx = { fontSize: 15, opacity: 0.7 } as const;
  const posted = ageText(c.sourceListedAt);
  const updated = ageTextFine(c.sourceUpdatedAt);
  const added = ageTextFine(c.firstSeenAt);
  const meta: { key: string; icon: ReactNode; text: string; tip: string }[] = [];
  if (updated)
    meta.push({
      key: "updated",
      icon: <UpdateOutlinedIcon sx={iconSx} />,
      text: updated,
      tip: "Updated on the source",
    });
  if (posted)
    meta.push({
      key: "posted",
      icon: <ScheduleOutlinedIcon sx={iconSx} />,
      text: posted,
      tip: "Created on the source",
    });
  if (added)
    meta.push({
      key: "added",
      icon: <AddCircleOutlineIcon sx={iconSx} />,
      text: added,
      tip: "Added to your deals",
    });
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        cursor: "pointer",
        bgcolor: DISPOSITION_TINT[c.disposition],
        "&:hover": { boxShadow: 3 },
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
        {c.disposition !== "none" ? (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: `${DISPOSITION[c.disposition].color}.main`,
              mb: 0.25,
            }}
          >
            {DISPOSITION[c.disposition].label}
          </Typography>
        ) : null}
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
          {c.title ?? "(untitled)"}{" "}
          <PlatformIcon
            platform={c.platform}
            sx={{ fontSize: "1rem", verticalAlign: "text-bottom" }}
          />
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
          <DealScoreBadge
            score={candidateDealScore(c)}
            confidence={e?.confidence ?? null}
          />
          <Box sx={{ flexGrow: 1 }} />
          <StatusBadge status={c.status} />
        </Stack>

        <Stack
          direction="row"
          spacing={0.75}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1 }}
        >
          <ScorePill
            label="Value"
            score={e?.valueScore ?? null}
            hint="how good the price is vs. estimated market value"
          />
          <ScorePill
            label="Fit"
            score={e?.fitScore ?? c.triageScore}
            hint="how well this matches your search target and rules"
          />
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

        {meta.length > 0 ? (
          <>
            <Divider sx={{ my: 1 }} />
            <Stack
              direction="row"
              spacing={1.5}
              flexWrap="wrap"
              useFlexGap
              alignItems="center"
              sx={{ color: "text.secondary" }}
            >
              {meta.map((m) => (
                <Stack
                  key={m.key}
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  title={m.tip}
                >
                  {m.icon}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ lineHeight: 1 }}
                  >
                    {m.text}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
