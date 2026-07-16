import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Drawer,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
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
import { useStoredState, hasStored } from "./useStoredState";

// Namespaced localStorage keys so the Deals filters survive reloads.
const K = {
  tab: "seneschal.deals.tab",
  sortBy: "seneschal.deals.sortBy",
  postedWithin: "seneschal.deals.postedWithin",
  platforms: "seneschal.deals.platforms",
  dispositions: "seneschal.deals.dispositions",
  targets: "seneschal.deals.targets",
  minDeal: "seneschal.deals.minDeal",
  minValue: "seneschal.deals.minValue",
  minFit: "seneschal.deals.minFit",
  showRejected: "seneschal.deals.showRejected",
  showAdvanced: "seneschal.deals.showAdvanced",
} as const;
import {
  DEFAULT_DISPOSITIONS,
  DISPOSITION,
  DISPOSITION_OPTIONS,
  PLATFORMS,
  POSTED_WITHIN,
  SORT_OPTIONS,
  TABS,
  byDateDesc,
  candidateDealScore,
  candidateFit,
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
  const [selectedTargets, setSelectedTargets] = useStoredState<string[]>(
    K.targets,
    []
  );
  const [selectedPlatforms, setSelectedPlatforms] = useStoredState<Platform[]>(
    K.platforms,
    [...PLATFORMS]
  );
  const [selectedDispositions, setSelectedDispositions] = useStoredState<
    Disposition[]
  >(K.dispositions, [...DEFAULT_DISPOSITIONS]);
  const [sortBy, setSortBy] = useStoredState<SortKey>(K.sortBy, "deal");
  const [minDeal, setMinDeal] = useStoredState(K.minDeal, 0);
  const [minValue, setMinValue] = useStoredState(K.minValue, 0);
  const [minFit, setMinFit] = useStoredState(K.minFit, 0);
  const [showRejected, setShowRejected] = useStoredState(K.showRejected, false);
  const [postedWithin, setPostedWithin] = useStoredState<PostedWithin>(
    K.postedWithin,
    "any"
  );
  const [tab, setTab] = useStoredState<CandidateStatus | "all">(K.tab, "active");
  // Advanced (min-score sliders + triage-rejected) are hidden by default.
  const [showAdvanced, setShowAdvanced] = useStoredState(K.showAdvanced, false);
  // Whether the target filter was restored from storage; if not, default it to
  // "all selected" once targets load (preserving the original behavior).
  const [targetsHydrated] = useState(() => hasStored(K.targets));
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
        // Default the target filter to everything selected, unless a prior
        // selection was restored from localStorage.
        if (!targetsHydrated) setSelectedTargets(t.map((x) => x.id));
      })
      .catch(() => {
        /* filter is best-effort */
      });
  }, [targetsHydrated, setSelectedTargets]);

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
      if (!showRejected && c.triageStatus === "rejected") return false;
      if (minDeal > 0 && (candidateDealScore(c) ?? -1) < minDeal) return false;
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
      case "value":
        sorted.sort((a, b) => (candidateValue(b) ?? -1) - (candidateValue(a) ?? -1));
        break;
      case "fit":
        sorted.sort((a, b) => (candidateFit(b) ?? -1) - (candidateFit(a) ?? -1));
        break;
      case "added":
        sorted.sort(byDateDesc((c) => c.firstSeenAt));
        break;
      case "updated":
        sorted.sort(byDateDesc((c) => c.sourceUpdatedAt ?? c.lastSeenAt));
        break;
      case "deal":
      default:
        sorted.sort(
          (a, b) => (candidateDealScore(b) ?? -1) - (candidateDealScore(a) ?? -1)
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
    minDeal,
    minValue,
    minFit,
    showRejected,
    postedWithin,
    sortBy,
  ]);

  // Any advanced filter set to a non-default value (so the collapsed section
  // still affects results — surfaced in the toggle label).
  const advancedActive =
    minDeal > 0 || minValue > 0 || minFit > 0 || showRejected;

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
          Candidates the hunt pipeline surfaced, best deals first. Click one to
          see its full history — triage, deep scrape, comps, and evaluation.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {needsLogin.map((n) => (
        <Alert key={n.id} severity="warning" onClose={() => void dismiss(n.id)}>
          <strong>{n.title}</strong> — {n.body}
        </Alert>
      ))}

      <Box>
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
            <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 170 } }}>
              <InputLabel id="status-label">Status</InputLabel>
              <Select
                labelId="status-label"
                label="Status"
                value={tab}
                onChange={(e) =>
                  setTab(e.target.value as CandidateStatus | "all")
                }
              >
                {TABS.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 200 } }}>
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

            <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 160 } }}>
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

            <FormControl
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 190 }, maxWidth: { sm: 240 } }}
            >
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
              <FormControl
                size="small"
                sx={{ minWidth: { xs: "100%", sm: 220 }, maxWidth: { sm: 260 } }}
              >
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

            <FormControl
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 210 }, maxWidth: { sm: 260 } }}
            >
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

            <Button
              size="small"
              variant="text"
              startIcon={<TuneIcon />}
              onClick={() => setShowAdvanced((s) => !s)}
              sx={{ alignSelf: "center" }}
            >
              {showAdvanced
                ? "Fewer filters"
                : advancedActive
                  ? "More filters (active)"
                  : "More filters"}
            </Button>

            {showAdvanced ? (
              <>
                <Box sx={{ width: { xs: "100%", sm: 180 }, px: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Min deal score: {minDeal}
                  </Typography>
                  <Slider
                    size="small"
                    value={minDeal}
                    onChange={(_e, v) => setMinDeal(v as number)}
                    min={0}
                    max={100}
                    valueLabelDisplay="auto"
                  />
                </Box>

                <Box sx={{ width: { xs: "100%", sm: 180 }, px: 1 }}>
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

                <Box sx={{ width: { xs: "100%", sm: 180 }, px: 1 }}>
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

                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={showRejected}
                      onChange={(e) => setShowRejected(e.target.checked)}
                    />
                  }
                  label="Show triage-rejected"
                />
              </>
            ) : null}
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
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
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
