import { Box, Typography } from "@mui/material";
import { strategyCardName, strategyCardSrc } from "./assets";

/** Native front-face asset ratio (most cards are 400×499). */
const CARD_ASPECT = 400 / 499;

export function StrategyCardFace({
  width = 148,
  selected = false,
  disabled = false,
  exhausted = false,
  showName = true,
  initiative,
  onClick,
}: {
  initiative: number;
  /** Display width in px; height follows the front-face aspect ratio. */
  width?: number;
  selected?: boolean;
  disabled?: boolean;
  /** When true, show the strategy card back (exhausted). */
  exhausted?: boolean;
  showName?: boolean;
  onClick?: () => void;
}) {
  const src = strategyCardSrc(initiative, exhausted);
  const name = strategyCardName(initiative);
  const interactive = !!onClick && !disabled;
  // Match front height; backs are square so they grow wider to keep 1:1.
  const height = Math.round(width / CARD_ASPECT);
  const boxWidth = exhausted ? height : width;
  const boxHeight = height;

  return (
    <Box
      component={interactive ? "button" : "div"}
      type={interactive ? "button" : undefined}
      onClick={interactive ? onClick : undefined}
      disabled={interactive ? disabled : undefined}
      sx={{
        all: interactive ? "unset" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.75,
        cursor: interactive ? "pointer" : "default",
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? "grayscale(0.65)" : "none",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        transform: selected ? "translateY(-3px)" : "none",
        background: "transparent",
        "&:hover": interactive ? { transform: "translateY(-4px)" } : undefined,
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "secondary.main",
          outlineOffset: 3,
        },
      }}
    >
      <Box
        sx={{
          width: boxWidth,
          height: boxHeight,
          bgcolor: "transparent",
          background: "transparent",
          boxShadow: selected
            ? (theme) => `0 0 0 3px ${theme.palette.secondary.main}`
            : "none",
          borderRadius: 1,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt={
              exhausted
                ? `${initiative} — ${name} (exhausted)`
                : `${initiative} — ${name}`
            }
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "center center",
              display: "block",
              backgroundColor: "transparent",
            }}
          />
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
            }}
          >
            {initiative}
          </Box>
        )}
      </Box>
      {showName ? (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            textAlign: "center",
            maxWidth: width + 8,
            lineHeight: 1.25,
            fontWeight: selected ? 600 : 500,
          }}
        >
          {initiative}. {name}
          {exhausted ? " · exhausted" : ""}
        </Typography>
      ) : null}
    </Box>
  );
}

export function StrategyCardThumb({
  initiative,
  width = 60,
  exhausted = false,
}: {
  initiative: number;
  width?: number;
  exhausted?: boolean;
}) {
  return (
    <StrategyCardFace
      initiative={initiative}
      width={width}
      exhausted={exhausted}
      showName={false}
    />
  );
}
