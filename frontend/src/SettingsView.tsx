import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  ListItemText,
  ListSubheader,
  MenuItem,
  OutlinedInput,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { LineChart } from "@mui/x-charts/LineChart";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type LlmUsage,
  type ModelSettings,
  type ModelStepConfig,
  type NotificationPrefs,
  type SearchTarget,
} from "./api";
import {
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from "./useDealNotifications";

const SETTINGS_TABS = [
  { label: "Notifications", render: () => <NotificationSettingsPanel /> },
  {
    label: "LLM",
    render: () => (
      <Stack spacing={3}>
        <ModelSettingsPanel />
        <LlmUsagePanel />
      </Stack>
    ),
  },
] as const;

export function SettingsView() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [tab, setTab] = useState(0);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Settings</Typography>
        <Typography color="text.secondary" variant="body2">
          Choose which deals notify your browser, configure the models each
          pipeline step uses, and review LLM spend. Changes save automatically.
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: { xs: 2, md: 3 },
          alignItems: "stretch",
        }}
      >
        <Tabs
          orientation={isMobile ? "horizontal" : "vertical"}
          variant={isMobile ? "scrollable" : "standard"}
          scrollButtons={isMobile ? "auto" : false}
          allowScrollButtonsMobile
          value={tab}
          onChange={(_e, v: number) => setTab(v)}
          sx={{
            flexShrink: 0,
            minWidth: { md: 180 },
            borderRight: { md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: "divider",
            "& .MuiTab-root": { alignItems: { md: "flex-start" } },
          }}
        >
          {SETTINGS_TABS.map((t) => (
            <Tab key={t.label} label={t.label} />
          ))}
        </Tabs>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {SETTINGS_TABS[tab]?.render()}
        </Box>
      </Box>
    </Stack>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** Small inline indicator reflecting the auto-save status of a panel. */
function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <Typography variant="caption" color="text.secondary">
        Saving…
      </Typography>
    );
  }
  if (state === "saved") {
    return (
      <Typography variant="caption" color="success.main">
        Saved ✓
      </Typography>
    );
  }
  if (state === "error") {
    return (
      <Typography variant="caption" color="error.main">
        Couldn't save
      </Typography>
    );
  }
  return null;
}

function sameIds(a: string[] | null, b: string[] | null): boolean {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function prefsEqual(a: NotificationPrefs, b: NotificationPrefs): boolean {
  return (
    a.enabled === b.enabled &&
    a.minDealScore === b.minDealScore &&
    a.minValueScore === b.minValueScore &&
    a.maxPriceCents === b.maxPriceCents &&
    sameIds(a.targetIds, b.targetIds)
  );
}

function centsToDollarInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toString();
}

function dollarInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Browser-notification settings: a master switch (which also drives the OS
 * permission prompt), the deal/value/price thresholds a candidate must clear
 * to notify, and which targets to be notified about.
 */
function NotificationSettingsPanel() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  // Last value persisted to the server; drives auto-save dirty-detection.
  const [serverPrefs, setServerPrefs] = useState<NotificationPrefs | null>(null);
  const [targets, setTargets] = useState<SearchTarget[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [permission, setPermission] = useState<NotificationPermission>(
    notificationPermission()
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, t] = await Promise.all([
        api.notificationSettings(),
        api.targets(),
      ]);
      setPrefs(p);
      setServerPrefs(p);
      setMaxPrice(centsToDollarInput(p.maxPriceCents));
      setTargets(t);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load notification settings"
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<NotificationPrefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...p } : cur));
  };

  const enableNotifications = async (on: boolean) => {
    if (on && permission !== "granted") {
      const result = await requestNotificationPermission();
      setPermission(result);
      // Reflect the switch state even if the user denied the prompt so the UI
      // can explain why nothing will show.
      patch({ enabled: result === "granted" });
      return;
    }
    patch({ enabled: on });
  };

  // Debounced auto-save: whenever the working prefs (incl. the max-price text)
  // diverge from what's on the server, persist after a short pause.
  useEffect(() => {
    if (!prefs || !serverPrefs) return;
    const candidate: NotificationPrefs = {
      ...prefs,
      maxPriceCents: dollarInputToCents(maxPrice),
    };
    if (prefsEqual(candidate, serverPrefs)) return;

    setSaveState("saving");
    const t = setTimeout(async () => {
      setError(null);
      try {
        const saved = await api.updateNotificationSettings(candidate);
        setServerPrefs(saved);
        setPrefs(saved);
        setMaxPrice(centsToDollarInput(saved.maxPriceCents));
        setSaveState("saved");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save notification settings"
        );
        setSaveState("error");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [prefs, maxPrice, serverPrefs]);

  // Fire a notification straight from the browser, bypassing the backend/poll.
  // The quickest way to tell whether the OS/browser is actually delivering
  // notifications (permission, Focus Assist / Do Not Disturb, per-app blocks).
  const sendTest = async () => {
    setError(null);
    let perm = permission;
    if (perm !== "granted") {
      perm = await requestNotificationPermission();
      setPermission(perm);
    }
    if (perm !== "granted") {
      setError(
        perm === "denied"
          ? "Notifications are blocked for this site in your browser settings."
          : "Notification permission wasn't granted."
      );
      return;
    }
    try {
      const n = new Notification("Seneschal test notification", {
        body: "If you can see this, browser notifications are working.",
        tag: "seneschal-test",
        requireInteraction: true,
      });
      n.onerror = () =>
        setError(
          "The browser accepted the notification but the OS didn't display it. " +
            "Check Windows notification settings and Focus Assist / Do Not Disturb, " +
            "and confirm your browser is allowed to show notifications. If you're " +
            "viewing this inside an embedded/preview browser, open it in Chrome/Edge/Firefox instead."
        );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to show test notification"
      );
    }
  };

  const selectedTargetIds = prefs?.targetIds ?? [];
  const allTargetsSelected =
    selectedTargetIds.length === 0 || selectedTargetIds.length === targets.length;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Browser notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Get a browser notification when the hunt surfaces a deal that clears
          your thresholds. Notifications appear while Seneschal is open in a tab.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {prefs === null ? (
          <CircularProgress />
        ) : (
          <Stack spacing={2.5}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ sm: "center" }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={prefs.enabled}
                    onChange={(e) => void enableNotifications(e.target.checked)}
                    disabled={!notificationsSupported()}
                  />
                }
                label="Enable browser notifications"
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => void sendTest()}
                disabled={!notificationsSupported()}
              >
                Send test notification
              </Button>
              <Typography variant="caption" color="text.secondary">
                Browser permission: <strong>{permission}</strong>
              </Typography>
            </Stack>

            {!notificationsSupported() ? (
              <Alert severity="info">
                This browser doesn't support notifications.
              </Alert>
            ) : prefs.enabled && permission === "denied" ? (
              <Alert severity="warning">
                Notifications are blocked in your browser settings. Allow them
                for this site to receive deal alerts.
              </Alert>
            ) : prefs.enabled && permission === "default" ? (
              <Alert
                severity="info"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() =>
                      void requestNotificationPermission().then(setPermission)
                    }
                  >
                    Allow
                  </Button>
                }
              >
                Grant notification permission to start receiving alerts.
              </Alert>
            ) : null}

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Thresholds
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Only notify me about deals that meet all of these.
              </Typography>

              <Stack spacing={3} sx={{ maxWidth: 420 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Min deal score: {prefs.minDealScore}
                  </Typography>
                  <Slider
                    size="small"
                    value={prefs.minDealScore}
                    onChange={(_e, v) => patch({ minDealScore: v as number })}
                    min={0}
                    max={100}
                    valueLabelDisplay="auto"
                  />
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Min value score: {prefs.minValueScore}
                  </Typography>
                  <Slider
                    size="small"
                    value={prefs.minValueScore}
                    onChange={(_e, v) => patch({ minValueScore: v as number })}
                    min={0}
                    max={100}
                    valueLabelDisplay="auto"
                  />
                </Box>

                <TextField
                  label="Max price"
                  size="small"
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="No limit"
                  helperText="Only notify for deals at or under this price. Leave blank for no cap."
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">$</InputAdornment>
                    ),
                  }}
                  sx={{ maxWidth: 220 }}
                />
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Searches
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Which searches to be notified about. Leave empty for all.
              </Typography>

              {targets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No targets yet. Create one under Targets first.
                </Typography>
              ) : (
                <FormControl size="small" sx={{ minWidth: 260, maxWidth: 420 }}>
                  <InputLabel id="notify-targets-label">Searches</InputLabel>
                  <Select
                    labelId="notify-targets-label"
                    multiple
                    value={selectedTargetIds}
                    onChange={(e) => {
                      const value = e.target.value;
                      const ids = (
                        typeof value === "string" ? value.split(",") : value
                      ) as string[];
                      patch({ targetIds: ids.length > 0 ? ids : null });
                    }}
                    input={<OutlinedInput label="Searches" />}
                    renderValue={(selected) =>
                      allTargetsSelected
                        ? "All searches"
                        : targets
                            .filter((t) => selected.includes(t.id))
                            .map((t) => t.title)
                            .join(", ")
                    }
                    displayEmpty
                  >
                    {targets.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        <Checkbox checked={selectedTargetIds.includes(t.id)} />
                        <ListItemText primary={t.title} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
              <SaveStatus state={saveState} />
              {permission === "granted" && prefs.enabled ? (
                <Chip size="small" color="success" label="Notifications on" />
              ) : null}
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function ModelSettingsPanel() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const apply = useCallback((s: ModelSettings) => {
    setSettings(s);
    setDrafts(
      Object.fromEntries(s.steps.map((st) => [st.step, st.model ?? ""]))
    );
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      apply(await api.modelSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced auto-save whenever a step's model diverges from the server value.
  useEffect(() => {
    if (!settings) return;
    const dirty = settings.steps.some(
      (st) => (drafts[st.step] ?? "") !== (st.model ?? "")
    );
    if (!dirty) return;

    setSaveState("saving");
    const t = setTimeout(async () => {
      setError(null);
      try {
        const overrides: Record<string, string | null> = {};
        for (const [step, value] of Object.entries(drafts)) {
          overrides[step] = value.trim() ? value.trim() : null;
        }
        apply(await api.updateModelSettings(overrides));
        setSaveState("saved");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save settings");
        setSaveState("error");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [drafts, settings, apply]);

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Models per step
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose an OpenRouter model for any step. Options show the input /
          output cost (per 1M tokens) and Artificial Analysis quality index,
          grouped by provider. Leave a field on <em>Default</em> to use the
          server default.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {settings === null ? (
          <CircularProgress />
        ) : (
          <Stack spacing={2.5}>
            {settings.steps.map((st) => (
              <StepField
                key={st.step}
                step={st}
                value={drafts[st.step] ?? ""}
                onChange={(v) =>
                  setDrafts((d) => ({ ...d, [st.step]: v }))
                }
              />
            ))}
            <Box sx={{ minHeight: 20 }}>
              <SaveStatus state={saveState} />
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

type ModelOption = {
  slug: string;
  name: string;
  cost: string;
  quality: string;
};

const MODEL_OPTIONS: ModelOption[] = [
  { slug: "tencent/hy3:free", name: "Tencent: Hy3 (free)", cost: "Free", quality: "41" },
  { slug: "xiaomi/mimo-v2.5", name: "Xiaomi: MiMo-V2.5", cost: "$0.14 / $0.28", quality: "37" },
  { slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", cost: "$0.098 / $0.196", quality: "40 reasoning / 29 base" },
  { slug: "minimax/minimax-m3", name: "MiniMax M3", cost: "$0.30 / $1.20", quality: "44" },
  { slug: "z-ai/glm-5.2", name: "Z.ai: GLM 5.2", cost: "$0.97 / $3.05", quality: "51 reasoning / 34 base" },
  { slug: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA: Nemotron 3 Ultra (free)", cost: "Free", quality: "38" },
  { slug: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", cost: "$0.44 / $0.87", quality: "44" },
  { slug: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8", cost: "$5.00 / $25.00", quality: "56" },
  { slug: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7", cost: "$5.00 / $25.00", quality: "54" },
  { slug: "stepfun/step-3.7-flash", name: "StepFun: Step 3.7 Flash", cost: "$0.20 / $1.15", quality: "30" },
  { slug: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", cost: "$0.50 / $3.00", quality: "27" },
  { slug: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", cost: "$3.00 / $15.00", quality: "36" },
  { slug: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", cost: "$2.00 / $10.00", quality: "53 reasoning / 42 base" },
  { slug: "openai/gpt-5.5", name: "OpenAI: GPT-5.5", cost: "$5.00 / $30.00", quality: "55" },
  { slug: "xiaomi/mimo-v2.5-pro", name: "Xiaomi: MiMo-V2.5-Pro", cost: "$0.44 / $0.87", quality: "42" },
  { slug: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", cost: "$0.30 / $2.50", quality: "14 (est.)" },
  { slug: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", cost: "$0.10 / $0.40", quality: "7" },
  { slug: "poolside/laguna-m.1:free", name: "Poolside: Laguna M.1 (free)", cost: "Free", quality: "n/a" },
  { slug: "openai/gpt-oss-120b", name: "OpenAI: gpt-oss-120b", cost: "$0.037 / $0.17", quality: "24" },
  { slug: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", cost: "$0.25 / $1.50", quality: "25" },
  { slug: "anthropic/claude-fable-5", name: "Claude Fable 5", cost: "$10.00 / $50.00", quality: "60 (highest on AA)" },
  { slug: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", cost: "$0.27 / $0.40", quality: "25 (est.)" },
  { slug: "openai/gpt-5.6-sol", name: "OpenAI: GPT-5.6 Sol", cost: "$5.00 / $30.00", quality: "59" },
  { slug: "x-ai/grok-4.5", name: "xAI: Grok 4.5", cost: "$2.00 / $6.00", quality: "54" },
  { slug: "z-ai/glm-5", name: "Z.ai: GLM 5", cost: "$0.95 / $3.15", quality: "40" },
  { slug: "openai/gpt-5.6-luna", name: "OpenAI: GPT-5.6 Luna", cost: "$1.00 / $6.00", quality: "51 reasoning / 27 base" },
  { slug: "openai/gpt-5.6-terra", name: "OpenAI: GPT-5.6 Terra", cost: "$2.50 / $15.00", quality: "55 reasoning / 34 base" },
];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  poolside: "Poolside",
  stepfun: "StepFun",
  tencent: "Tencent",
  "x-ai": "xAI",
  xiaomi: "Xiaomi",
  "z-ai": "Z.ai",
};

function providerOf(slug: string): string {
  const prefix = slug.split("/")[0] ?? slug;
  return PROVIDER_LABELS[prefix] ?? prefix;
}

const OPTION_BY_SLUG = new Map(MODEL_OPTIONS.map((o) => [o.slug, o]));

const GROUPED_OPTIONS: [string, ModelOption[]][] = (() => {
  const groups = new Map<string, ModelOption[]>();
  for (const opt of MODEL_OPTIONS) {
    const provider = providerOf(opt.slug);
    const list = groups.get(provider);
    if (list) list.push(opt);
    else groups.set(provider, [opt]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
})();

function StepField({
  step,
  value,
  onChange,
}: {
  step: ModelStepConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const isCustom = value !== "" && !OPTION_BY_SLUG.has(value);

  return (
    <Box sx={{ maxWidth: 480 }}>
      <TextField
        select
        label={step.label}
        size="small"
        fullWidth
        value={value}
        onChange={(e) => onChange(e.target.value)}
        helperText={step.description}
        InputLabelProps={{ shrink: true }}
        SelectProps={{
          displayEmpty: true,
          renderValue: (selected) => {
            const v = selected as string;
            if (v === "") {
              return (
                <Typography component="span" color="text.secondary">
                  Default: {step.default}
                </Typography>
              );
            }
            const opt = OPTION_BY_SLUG.get(v);
            return <Typography component="span">{opt ? opt.name : v}</Typography>;
          },
          MenuProps: { PaperProps: { style: { maxHeight: 420 } } },
        }}
      >
        <MenuItem value="" dense>
          <em>Default: {step.default}</em>
        </MenuItem>
        {isCustom ? (
          <MenuItem value={value} dense>
            {value} (custom)
          </MenuItem>
        ) : null}
        {GROUPED_OPTIONS.flatMap(([provider, opts]) => [
          <ListSubheader key={`header-${provider}`} sx={{ lineHeight: 2 }}>
            {provider}
          </ListSubheader>,
          ...opts.map((opt) => (
            <MenuItem
              key={opt.slug}
              value={opt.slug}
              dense
              sx={{ display: "flex", gap: 1, alignItems: "baseline", py: 0.25 }}
            >
              <Typography variant="body2" component="span">
                {opt.name}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="span"
                sx={{ ml: "auto" }}
              >
                {opt.cost} · Q {opt.quality}
              </Typography>
            </MenuItem>
          )),
        ])}
      </TextField>
    </Box>
  );
}

function cost(n: number | null): string {
  return n != null ? `$${n.toFixed(4)}` : "—";
}

const PURPOSE_LABELS: Record<string, string> = {
  search_expansion: "Search expansion",
  triage: "Triage",
  comps: "Comps / web research",
  advanced: "Advanced eval",
  // Legacy: comps calls were logged under the generic "other" purpose before
  // it got its own value.
  other: "Comps / web research (legacy)",
};

function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}

/**
 * Per-bucket + cumulative LLM cost line charts. Togglable between a daily view
 * (all history) and an hourly view (recent window).
 */
function CostCharts({
  daily,
  hourly,
}: {
  daily: LlmUsage["daily"];
  hourly: LlmUsage["hourly"];
}) {
  const theme = useTheme();
  const [bucket, setBucket] = useState<"day" | "hour">("day");
  const series = bucket === "hour" ? hourly : daily;

  if (daily.length === 0 && hourly.length === 0) return null;

  // Drop the leading "YYYY-" to keep axis ticks compact (e.g. "07-17 13:00").
  const labels = series.map((d) => d.date.slice(5));
  const costs = series.map((d) => d.costUsd);
  let running = 0;
  const cumulative = series.map((d) => (running += d.costUsd));
  const fmt = (v: number | null) => (v == null ? "" : `$${v.toFixed(4)}`);
  const margin = { left: 64, right: 16, top: 16, bottom: 48 };
  const empty = series.length === 0;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1, gap: 1 }}
      >
        <Typography variant="subtitle2">Cost over time</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={bucket}
          onChange={(_e, v) => {
            if (v) setBucket(v);
          }}
        >
          <ToggleButton value="hour">By hour</ToggleButton>
          <ToggleButton value="day">By day</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {empty ? (
        <Typography variant="body2" color="text.secondary">
          {bucket === "hour"
            ? "No LLM activity in the last 7 days."
            : "No LLM activity yet."}
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {bucket === "hour" ? "Hourly spend" : "Daily spend"}
            </Typography>
            <LineChart
              height={240}
              xAxis={[{ data: labels, scaleType: "point" }]}
              yAxis={[{ valueFormatter: fmt }]}
              series={[
                {
                  data: costs,
                  label: bucket === "hour" ? "Hourly cost" : "Daily cost",
                  color: theme.palette.primary.main,
                  valueFormatter: fmt,
                  showMark: series.length <= 60,
                },
              ]}
              margin={margin}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Cumulative spend
            </Typography>
            <LineChart
              height={240}
              xAxis={[{ data: labels, scaleType: "point" }]}
              yAxis={[{ valueFormatter: fmt }]}
              series={[
                {
                  data: cumulative,
                  label: "Cumulative cost",
                  area: true,
                  color: theme.palette.secondary.main,
                  valueFormatter: fmt,
                  showMark: series.length <= 60,
                },
              ]}
              margin={margin}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** Compact label/value row used in the mobile (stacked-card) usage layout. */
function UsageStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  );
}

function LlmUsagePanel() {
  const [usage, setUsage] = useState<LlmUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  useEffect(() => {
    let live = true;
    api
      .llmUsage()
      .then((u) => {
        if (live) setUsage(u);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load usage")
      );
    return () => {
      live = false;
    };
  }, []);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!usage) return <CircularProgress />;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          sx={{ mb: 1 }}
        >
          <Typography variant="h6">LLM cost (OpenRouter)</Typography>
          <Typography variant="h6" color="primary">
            {cost(usage.totalCostUsd)}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 2 }}
        >
          {usage.totalCalls} calls · {usage.totalTokens.toLocaleString()} tokens
        </Typography>

        <CostCharts daily={usage.daily} hourly={usage.hourly} />

        {usage.byModel.length > 0 ? (
          isMobile ? (
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {usage.byModel.map((m) => (
                <Box
                  key={m.model}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    p: 1.5,
                  }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="baseline"
                    sx={{ gap: 1, mb: 0.75 }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, wordBreak: "break-word" }}
                    >
                      {m.model}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="primary"
                      sx={{ fontWeight: 600, flexShrink: 0 }}
                    >
                      {cost(m.costUsd)}
                    </Typography>
                  </Stack>
                  <UsageStat label="Calls" value={m.calls} />
                  <UsageStat
                    label="Prompt tokens"
                    value={m.promptTokens.toLocaleString()}
                  />
                  <UsageStat
                    label="Completion tokens"
                    value={m.completionTokens.toLocaleString()}
                  />
                  <UsageStat
                    label="Total tokens"
                    value={(
                      m.promptTokens + m.completionTokens
                    ).toLocaleString()}
                  />
                </Box>
              ))}
            </Stack>
          ) : (
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">Calls</TableCell>
                  <TableCell align="right">Prompt&nbsp;tok</TableCell>
                  <TableCell align="right">Completion&nbsp;tok</TableCell>
                  <TableCell align="right">Total&nbsp;tok</TableCell>
                  <TableCell align="right">Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {usage.byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell>{m.model}</TableCell>
                    <TableCell align="right">{m.calls}</TableCell>
                    <TableCell align="right">
                      {m.promptTokens.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      {m.completionTokens.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      {(m.promptTokens + m.completionTokens).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">{cost(m.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : null}

        {usage.byPurpose.length > 0 ? (
          <>
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 0.5 }}>
              By pipeline step
            </Typography>
            {isMobile ? (
              <Stack spacing={1.5}>
                {usage.byPurpose.map((p) => (
                  <Box
                    key={p.purpose}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 1.5,
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="baseline"
                      sx={{ gap: 1, mb: 0.75 }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {purposeLabel(p.purpose)}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="primary"
                        sx={{ fontWeight: 600, flexShrink: 0 }}
                      >
                        {cost(p.costUsd)}
                      </Typography>
                    </Stack>
                    <UsageStat label="Calls" value={p.calls} />
                    <UsageStat
                      label="Total tokens"
                      value={(
                        p.promptTokens + p.completionTokens
                      ).toLocaleString()}
                    />
                  </Box>
                ))}
              </Stack>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Step</TableCell>
                    <TableCell align="right">Calls</TableCell>
                    <TableCell align="right">Total&nbsp;tok</TableCell>
                    <TableCell align="right">Cost</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usage.byPurpose.map((p) => (
                    <TableRow key={p.purpose}>
                      <TableCell>{purposeLabel(p.purpose)}</TableCell>
                      <TableCell align="right">{p.calls}</TableCell>
                      <TableCell align="right">
                        {(p.promptTokens + p.completionTokens).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">{cost(p.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
