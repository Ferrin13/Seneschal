import { Box, Tooltip } from "@mui/material";
import { GENDER_ABBR, GENDER_LABEL, genderColor } from "./stats";
import type { Gender } from "./types";

/** Tiny solid M / W tag in the player's gender colour; "?" when unknown. */
export function GenderBadge({ gender }: { gender: Gender | null }) {
  const color = genderColor(gender);
  return (
    <Tooltip title={gender ? GENDER_LABEL[gender] : "Gender not set"} placement="top">
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 18,
          height: 18,
          px: 0.5,
          borderRadius: 0.75,
          bgcolor: color,
          color: "common.white",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {gender ? GENDER_ABBR[gender] : "?"}
      </Box>
    </Tooltip>
  );
}
