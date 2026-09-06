import { Box, Typography } from "@mui/material";
import { fmtScore, scoreTone } from "./stats";

const TONE_BG: Record<ReturnType<typeof scoreTone>, string> = {
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
  default: "grey.500",
};

/**
 * Madden-style rating tile: a coloured square with the number, optionally a
 * tiny caption underneath (OVR / OFF / DEF / GEN).
 */
export function ScoreBadge({
  value,
  label,
  size = "md",
}: {
  value: number | null | undefined;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "lg" ? 72 : size === "md" ? 44 : 34;
  const font = size === "lg" ? 34 : size === "md" ? 18 : 14;
  return (
    <Box
      sx={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.25,
      }}
    >
      <Box
        sx={{
          width: dim,
          height: dim,
          borderRadius: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: TONE_BG[scoreTone(value)],
          color: "common.white",
          fontWeight: 800,
          fontSize: font,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          boxShadow: 1,
        }}
      >
        {fmtScore(value)}
      </Box>
      {label ? (
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, letterSpacing: 1, color: "text.secondary" }}
        >
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}
