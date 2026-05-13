import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { addDays, addMinutes, format, startOfDay } from "date-fns";

import { api, type Activity, type Category, type Slot } from "./api";

const SLOTS_PER_DAY = 96;
const SLOT_MINUTES = 15;

type ActivityLookup = Map<string, Activity>;
type CategoryLookup = Map<string, Category>;

export function TimeTrackingView() {
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dayStart = useMemo(() => startOfDay(date), [date]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.categories(),
      api.activities(),
      api.slots(dayStart.toISOString(), dayEnd.toISOString()),
    ])
      .then(([cats, acts, sls]) => {
        if (cancelled) return;
        setCategories(cats);
        setActivities(acts);
        setSlots(sls);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dayStart, dayEnd]);

  const activityById: ActivityLookup = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities]
  );
  const categoryById: CategoryLookup = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const slotsByStart = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of slots) {
      if (s.deletedAt) continue;
      m.set(new Date(s.slotStartUtc).toISOString(), s);
    }
    return m;
  }, [slots]);

  const dailySlots = useMemo(
    () =>
      Array.from({ length: SLOTS_PER_DAY }, (_, i) =>
        addMinutes(dayStart, i * SLOT_MINUTES)
      ),
    [dayStart]
  );

  const summary = useMemo(
    () => summarizeDay(slots, activityById, categoryById),
    [slots, activityById, categoryById]
  );

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Typography variant="h5">Time tracking</Typography>
        <DatePicker
          label="Day"
          value={date}
          onChange={(d) => d && setDate(startOfDay(d))}
          slotProps={{ textField: { size: "small" } }}
        />
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined">
            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Typography variant="subtitle1">
                {format(dayStart, "EEEE, MMMM d, yyyy")}
              </Typography>
              {loading ? <CircularProgress size={18} /> : null}
            </Box>
            <TableContainer sx={{ maxHeight: "70vh" }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 90 }}>Time</TableCell>
                    <TableCell>Primary</TableCell>
                    <TableCell>Secondary</TableCell>
                    <TableCell>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dailySlots.map((slotStart) => {
                    const key = slotStart.toISOString();
                    const slot = slotsByStart.get(key);
                    return (
                      <SlotRow
                        key={key}
                        slotStart={slotStart}
                        slot={slot}
                        activityById={activityById}
                        categoryById={categoryById}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>
            <DaySummary summary={summary} categoryById={categoryById} />
            <CategoriesPanel
              categories={categories}
              activities={activities}
            />
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}

function SlotRow({
  slotStart,
  slot,
  activityById,
  categoryById,
}: {
  slotStart: Date;
  slot: Slot | undefined;
  activityById: ActivityLookup;
  categoryById: CategoryLookup;
}) {
  const primary = slot?.primaryActivityId
    ? activityById.get(slot.primaryActivityId)
    : undefined;
  const secondary = slot?.secondaryActivityId
    ? activityById.get(slot.secondaryActivityId)
    : undefined;
  const primaryCat = primary
    ? categoryById.get(primary.categoryId)
    : undefined;
  const secondaryCat = secondary
    ? categoryById.get(secondary.categoryId)
    : undefined;

  return (
    <TableRow hover sx={{ opacity: slot ? 1 : 0.55 }}>
      <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>
        {format(slotStart, "HH:mm")}
      </TableCell>
      <TableCell>
        <ActivityCell activity={primary} category={primaryCat} />
      </TableCell>
      <TableCell>
        <ActivityCell activity={secondary} category={secondaryCat} />
      </TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{slot?.notes ?? ""}</TableCell>
    </TableRow>
  );
}

function ActivityCell({
  activity,
  category,
}: {
  activity: Activity | undefined;
  category: Category | undefined;
}) {
  if (!activity) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          bgcolor: category?.color ?? "grey.400",
          flexShrink: 0,
        }}
      />
      <Typography variant="body2">{activity.name}</Typography>
      {category ? (
        <Typography variant="caption" color="text.secondary">
          · {category.name}
        </Typography>
      ) : null}
    </Stack>
  );
}

type SummaryEntry = { categoryId: string; minutes: number };

function summarizeDay(
  slots: Slot[],
  activityById: ActivityLookup,
  categoryById: CategoryLookup
): SummaryEntry[] {
  const minutesByCategory = new Map<string, number>();
  for (const s of slots) {
    if (s.deletedAt || !s.primaryActivityId) continue;
    const a = activityById.get(s.primaryActivityId);
    if (!a) continue;
    const cat = categoryById.get(a.categoryId);
    if (!cat) continue;
    minutesByCategory.set(
      cat.id,
      (minutesByCategory.get(cat.id) ?? 0) + SLOT_MINUTES
    );
  }
  return Array.from(minutesByCategory.entries())
    .map(([categoryId, minutes]) => ({ categoryId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

function DaySummary({
  summary,
  categoryById,
}: {
  summary: SummaryEntry[];
  categoryById: CategoryLookup;
}) {
  const totalMinutes = summary.reduce((acc, e) => acc + e.minutes, 0);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        Day summary
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {totalMinutes > 0
          ? `${formatMinutes(totalMinutes)} logged across ${
              summary.length
            } categor${summary.length === 1 ? "y" : "ies"}`
          : "No slots logged for this day."}
      </Typography>
      <Stack spacing={0.5}>
        {summary.map((e) => {
          const cat = categoryById.get(e.categoryId);
          const pct =
            totalMinutes > 0 ? Math.round((e.minutes / totalMinutes) * 100) : 0;
          return (
            <Stack
              key={e.categoryId}
              direction="row"
              spacing={1}
              alignItems="center"
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: cat?.color ?? "grey.400",
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {cat?.name ?? "Unknown"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatMinutes(e.minutes)} · {pct}%
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function CategoriesPanel({
  categories,
  activities,
}: {
  categories: Category[];
  activities: Activity[];
}) {
  const activitiesByCategory = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of activities) {
      if (a.deletedAt) continue;
      const list = m.get(a.categoryId) ?? [];
      list.push(a);
      m.set(a.categoryId, list);
    }
    return m;
  }, [activities]);

  return (
    <Paper variant="outlined">
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1">Categories &amp; activities</Typography>
      </Box>
      <Box>
        {categories
          .filter((c) => !c.deletedAt)
          .map((cat) => {
            const acts = activitiesByCategory.get(cat.id) ?? [];
            return (
              <Accordion key={cat.id} disableGutters elevation={0} square>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    sx={{ width: "100%" }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: cat.color,
                      }}
                    />
                    <Typography sx={{ flexGrow: 1 }}>{cat.name}</Typography>
                    <Chip size="small" label={`${acts.length}`} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  {acts.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">
                      No activities.
                    </Typography>
                  ) : (
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                      {acts.map((a) => (
                        <Typography
                          key={a.id}
                          component="li"
                          variant="body2"
                          sx={{ color: a.isActive ? "text.primary" : "text.disabled" }}
                        >
                          {a.name}
                          {a.archivedAt ? " (archived)" : ""}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </AccordionDetails>
              </Accordion>
            );
          })}
      </Box>
    </Paper>
  );
}
