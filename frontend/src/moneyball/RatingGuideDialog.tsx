import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { CATEGORIES, CATEGORY_LABELS, RATING_GUIDE, statsInCategory } from "./stats";

/** The rating rubric: general guidance plus what each stat means. */
export function RatingGuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle>How to rate</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Stack spacing={1}>
            {RATING_GUIDE.map((p, i) => (
              <Typography key={i} variant="body2">
                {p}
              </Typography>
            ))}
            <Typography variant="body2" color="text.secondary">
              Every stat is 1-10. Leave a stat blank if you haven't seen enough to judge
              it; blanks don't count against the player.
            </Typography>
          </Stack>
          {CATEGORIES.map((c) => (
            <Stack key={c} spacing={1}>
              <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>
                {CATEGORY_LABELS[c]}
              </Typography>
              {statsInCategory(c).map((s) => (
                <Stack key={s.key} spacing={0.25}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {s.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {s.description}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
