import { Box } from "@mui/material";
import { factionIconSrc } from "./assets";

export function FactionIcon({
  factionId,
  color,
  size = 28,
}: {
  factionId: string;
  color?: string;
  size?: number;
}) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        bgcolor: color ?? "grey.200",
        boxShadow: color ? `0 0 0 2px ${color}55` : "none",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box
        component="img"
        src={factionIconSrc(factionId)}
        alt=""
        sx={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </Box>
  );
}
