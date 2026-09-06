import { memo } from "react";
import { Box, Typography } from "@mui/material";
import type { NodeProps } from "@xyflow/react";
import type { ClusterNode } from "./flowTypes";
import { withAlpha } from "./format";

/**
 * Dashed frame drawn behind a group's members. The frame itself ignores the
 * pointer (so you can pan/box-select through it); only the label tab is
 * clickable, which selects the group for editing.
 */
function ClusterNodeViewInner({ data, selected, width, height }: NodeProps<ClusterNode>) {
  const { cluster, memberCount } = data;
  return (
    <Box
      sx={{
        width: width ?? 0,
        height: height ?? 0,
        boxSizing: "border-box",
        borderRadius: 3,
        border: `2px dashed ${withAlpha(cluster.color, selected ? 0.9 : 0.55)}`,
        bgcolor: withAlpha(cluster.color, selected ? 0.1 : 0.06),
        position: "relative",
        pointerEvents: "none",
        transition: "background-color 120ms, border-color 120ms",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: -1,
          left: 14,
          transform: "translateY(-50%)",
          pointerEvents: "auto",
          cursor: "pointer",
          bgcolor: cluster.color,
          color: "#fff",
          borderRadius: 999,
          px: 1.25,
          py: 0.25,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          boxShadow: selected
            ? `0 0 0 3px ${withAlpha(cluster.color, 0.3)}`
            : "0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.4 }}
        >
          {cluster.label || "Untitled group"}
        </Typography>
        <Typography
          variant="caption"
          sx={{ opacity: 0.8, lineHeight: 1.4, fontVariantNumeric: "tabular-nums" }}
        >
          {memberCount}
        </Typography>
      </Box>
    </Box>
  );
}

export const ClusterNodeView = memo(ClusterNodeViewInner);
