import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  Drawer,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Slider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  type Candidate,
  type CandidateStatus,
  type DealNotification,
  type Disposition,
  type Platform,
  type Search,
  type SearchTarget,
} from "./api";
import { CandidateCard } from "./deals/CandidateCard";
import { CandidateDetailPanel } from "./deals/CandidateDetailPanel";
import {
  DEFAULT_DISPOSITIONS,
  DISPOSITION,
  DISPOSITION_OPTIONS,
  PLATFORMS,
  POSTED_WITHIN,
  SORT_OPTIONS,
  TABS,
  byDateDesc,
  candidateFit,
  candidatePromise,
  candidateValue,
  type PostedWithin,
  type SortKey,
} from "./deals/shared";

export function DealsView() {
  const [notifications, setNotifications] = useState<DealNotification[] | null>(
    null
  );
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [targets, setTargets] = useState<SearchTarget[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<Platform[]>([...PLATFORMS]);
  const [selectedDispositions, setSelectedDispositions] = useState<Disposition[]>(
    [...DEFAULT_DISPOSITIONS]
  );
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [minValue, setMinValue] = useState(0);
  const [minFit, setMinFit] = useState(0);
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");
  const [tab, setTab] = useState<CandidateStatus | "all">("active");
  const [error, setError] = useState<string | null>(null);

  // The open deal is reflected in the URL (/deals/:id) so panels are
  // linkable and back/forward navigation works.
  const navigate = useNavigate();
  const params = useParams();
  const selected = params["*"] ? params["*"] : null;
  const openDeal = (id: string) => navigate(`/deals/${id}`);
  const closeDeal = () => navigate("/deals");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [n, c] = await Promise.all([
        api.notifications(),
        api.candidates(tab === "all" ? undefined : tab),
      ]);
      setNotifications(n);
      setCandidates(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deals");
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  // Targets/searches are tab-independent; load once to power the filter.
  useEffect(() => {
    void Promise.all([api.targets(), api.searches()])
      .then(([t, s]) => {
        setTargets(t);
        setSearches(s);
        // Default the target filter to everything selected.
        setSelectedTargets(t.map((x) => x.id));
      })
      .catch(() => {
        /* filter is best-effort */
      });
  }, []);

  const searchToTarget = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of searches) m.set(s.id, s.targetId);
    return m;
  }, [searches]);

  const visibleCandidates = useMemo(() => {
    if (candidates === null) return null;
    const postedCutoff =
      postedWithin === "any"
        ? null
        : Date.now() - Number(postedWithin) * 86_400_000;

    const filtered = candidates.filter((c) => {
      if (selectedTargets.length > 0) {
        const tid = c.searchId ? searchToTarget.get(c.searchId) : undefined;
        if (tid == null || !selectedTargets.includes(tid)) return false;
      }
      if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(c.platform)) {
        return false;
      }
      if (
        selectedDispositions.length > 0 &&
        !selectedDispositions.includes(c.disposition)
      ) {
        return false;
      }
      if (minValue > 0 && (candidateValue(c) ?? -1) < minValue) return false;
      if (minFit > 0 && (candidateFit(c) ?? -1) < minFit) return false;
      if (postedCutoff != null) {
        if (!c.sourceListedAt) return false;
        if (new Date(c.sourceListedAt).getTime() < postedCutoff) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    switch (sortBy) {
      case "posted":
        sorted.sort(byDateDesc((c) => c.sourceListedAt));
        break;
      case "created":
        sorted.sort(byDateDesc((c) => c.firstSeenAt));
        break;
      case "price_asc":
        sorted.sort(
          (a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity)
        );
        break;
      case "price_desc":
        sorted.sort(
          (a, b) => (b.priceCents ?? -Infinity) - (a.priceCents ?? -Infinity)
        );
        break;
      case "value":
        sorted.sort((a, b) => (candidateValue(b) ?? -1) - (candidateValue(a) ?? -1));
        break;
      case "fit":
        sorted.sort((a, b) => (candidateFit(b) ?? -1) - (candidateFit(a) ?? -1));
        break;
      case "promise":
      default:
        sorted.sort(
          (a, b) => (candidatePromise(b) ?? -1) - (candidatePromise(a) ?? -1)
        );
        break;
    }
    return sorted;
  }, [
    candidates,
    selectedTargets,
    searchToTarget,
    selectedPlatforms,
    selectedDispositions,
    minValue,
    minFit,
    postedWithin,
    sortBy,
  ]);

  const needsLogin = (notifications ?? []).filter(
    (n) => n.kind === "needs_login" && n.status !== "dismissed"
  );

  const dismiss = async (id: string) => {
    try {
      await api.updateNotification(id, "dismissed");
      await load();
    } catch {
      /* ignore */
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Deals</Typography>
        <Typography color="text.secondary" variant="body2">
          Candidates the hunt pipeline surfaced, most promising first. Click one
          to see its full history — triage, deep scrape, comps, and evaluation.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {needsLogin.map((n) => (
        <Alert key={n.id} severity="warning" onClose={() => void dismiss(n.id)}>
          <strong>{n.title}</strong> — {n.body}
        </Alert>
      ))}

      <Box>
        <Tabs
          value={tab}
          onChange={(_e, v) => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>

        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 2,
            mb: 2,
          }}
        >
          <Stack
            direction="row"
            spacing={2}
            flexWrap="wrap"
            useFlexGap
            alignItems="flex-start"
          >
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="sort-label">Sort by</InputLabel>
              <Select
                labelId="sort-label"
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="posted-label">Posted</InputLabel>
              <Select
                labelId="posted-label"
                label="Posted"
                value={postedWithin}
                onChange={(e) => setPostedWithin(e.target.value as PostedWithin)}
              >
                {POSTED_WITHIN.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel id="platform-filter-label">Search type</InputLabel>
              <Select
                labelId="platform-filter-label"
                multiple
                value={selectedPlatforms}
                onChange={(e) =>
                  setSelectedPlatforms(
                    (typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value) as Platform[]
                  )
                }
                input={<OutlinedInput label="Search type" />}
                renderValue={(selected) =>
                  selected.length === 0 || selected.length === PLATFORMS.length
                    ? "All types"
                    : selected.join(", ")
                }
                displayEmpty
              >
                {PLATFORMS.map((p) => (
                  <MenuItem key={p} value={p}>
                    <Checkbox checked={selectedPlatforms.includes(p)} />
                    <ListItemText primary={p} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {targets.length > 0 ? (
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="target-filter-label">Target</InputLabel>
                <Select
                  labelId="target-filter-label"
                  multiple
                  value={selectedTargets}
                  onChange={(e) =>
                    setSelectedTargets(
                      typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value
                    )
                  }
                  input={<OutlinedInput label="Target" />}
                  renderValue={(selected) =>
                    selected.length === 0 || selected.length === targets.length
                      ? "All targets"
                      : targets
                          .filter((t) => selected.includes(t.id))
                          .map((t) => t.title)
                          .join(", ")
                  }
                  displayEmpty
                >
                  {targets.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      <Checkbox checked={selectedTargets.includes(t.id)} />
                      <ListItemText primary={t.title} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}

            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="disposition-filter-label">Disposition</InputLabel>
              <Select
                labelId="disposition-filter-label"
                multiple
                value={selectedDispositions}
                onChange={(e) =>
                  setSelectedDispositions(
                    (typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value) as Disposition[]
                  )
                }
                input={<OutlinedInput label="Disposition" />}
                renderValue={(selected) =>
                  selected.length === 0 ||
                  selected.length === DISPOSITION_OPTIONS.length
                    ? "All dispositions"
                    : selected.map((d) => DISPOSITION[d].label).join(", ")
                }
                displayEmpty
              >
                {DISPOSITION_OPTIONS.map((d) => (
                  <MenuItem key={d} value={d}>
                    <Checkbox checked={selectedDispositions.includes(d)} />
                    <ListItemText primary={DISPOSITION[d].label} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ width: 180, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Min value score: {minValue}
              </Typography>
              <Slider
                size="small"
                value={minValue}
                onChange={(_e, v) => setMinValue(v as number)}
                min={0}
                max={100}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box sx={{ width: 180, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Min fit score: {minFit}
              </Typography>
              <Slider
                size="small"
                value={minFit}
                onChange={(_e, v) => setMinFit(v as number)}
                min={0}
                max={100}
                valueLabelDisplay="auto"
              />
            </Box>
          </Stack>
        </Box>

        {visibleCandidates === null ? (
          <CircularProgress />
        ) : visibleCandidates.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            {candidates && candidates.length > 0
              ? "No candidates match the current filters."
              : "No candidates here yet. Run a hunt from a target to harvest listings."}
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 2,
            }}
          >
            {visibleCandidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                onClick={() => openDeal(c.id)}
              />
            ))}
          </Box>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={selected !== null}
        onClose={closeDeal}
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 } } }}
      >
        {selected ? (
          <CandidateDetailPanel
            id={selected}
            onClose={closeDeal}
            onChanged={() => void load()}
          />
        ) : null}
      </Drawer>
    </Stack>
  );
}
