import { memo } from "react";
import { Box, Typography } from "@mui/material";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import NotesIcon from "@mui/icons-material/Notes";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BeliefNode } from "./flowTypes";
import {
  KIND_META,
  SCOPE_META,
  confidenceColor,
  confidenceLabel,
  withAlpha,
} from "./format";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

const handleSx = (color: string) => ({
  width: 10,
  height: 10,
  background: "#fff",
  border: `2px solid ${color}`,
});

/**
 * A belief on the canvas. Fixed size so cluster frames can be computed from
 * positions alone. Coloured by kind, with a confidence badge; connect by dragging
 * from the bottom handle of one card to the top handle of another.
 */
function BeliefNodeViewInner({ data, selected }: NodeProps<BeliefNode>) {
  const { belief, dimmed, inCount, outCount } = data;
  const kind = KIND_META[belief.kind];
  const confColor = confidenceColor(belief.confidence);
  const linkCount = inCount + outCount;

  return (
    <Box
      sx={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        boxSizing: "border-box",
        bgcolor: "background.paper",
        borderRadius: 2,
        border: `1px solid ${selected ? kind.color : "rgba(0,0,0,0.12)"}`,
        borderLeft: `5px solid ${kind.color}`,
        boxShadow: selected
          ? `0 0 0 3px ${withAlpha(kind.color, 0.25)}, 0 6px 16px rgba(0,0,0,0.12)`
          : "0 2px 6px rgba(0,0,0,0.08)",
        px: 1.5,
        py: 1,
        display: "flex",
        flexDirection: "column",
        opacity: dimmed ? 0.25 : 1,
        transition: "opacity 120ms, box-shadow 120ms",
        cursor: "grab",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={handleSx(kind.color)}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: kind.color,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontSize: "0.62rem",
            lineHeight: 1.2,
          }}
        >
          {kind.label}
          <Box
            component="span"
            sx={{
              ml: 0.75,
              color: "text.disabled",
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {SCOPE_META[belief.scope].label}
          </Box>
        </Typography>
        <Box
          title={`Confidence ${belief.confidence}/10 — ${confidenceLabel(belief.confidence)}`}
          sx={{
            minWidth: 18,
            height: 16,
            px: 0.5,
            borderRadius: 999,
            bgcolor: withAlpha(confColor, 0.15),
            color: confColor,
            fontSize: "0.62rem",
            fontWeight: 800,
            lineHeight: "16px",
            textAlign: "center",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {belief.confidence}
        </Box>
      </Box>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          lineHeight: 1.25,
          mt: 0.25,
          flexGrow: 1,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {belief.title || <em style={{ opacity: 0.5 }}>Untitled belief</em>}
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 1.25,
          alignItems: "center",
          color: "text.secondary",
          fontSize: "0.68rem",
          lineHeight: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.35 }}>
          <MenuBookIcon sx={{ fontSize: 12 }} />
          {belief.references.length}
        </Box>
        {belief.notes.trim() ? <NotesIcon sx={{ fontSize: 12 }} /> : null}
        <Box sx={{ ml: "auto" }}>
          {linkCount} link{linkCount === 1 ? "" : "s"}
        </Box>
      </Box>
      <Handle
        type="source"
        position={Position.Bottom}
        style={handleSx(kind.color)}
      />
    </Box>
  );
}

export const BeliefNodeView = memo(BeliefNodeViewInner);
