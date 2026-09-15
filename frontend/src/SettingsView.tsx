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
  FormGroup,
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
  type NotificationEvents,
  type NotificationPrefs,
  type PushDevice,
  type SearchTarget,
} from "./api";

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
          Choose which deals get pushed to your phone, configure the models
          each pipeline step uses, and review LLM spend. Changes save
          automatically.
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
    sameIds(a.targetIds, b.targetIds) &&
    a.events.deals === b.events.deals &&
    a.events.sold === b.events.sold &&
    a.events.loginNeeded === b.events.loginNeeded
  );
}

/** The per-event push switches, in display order. */
const EVENT_SWITCHES: {
  key: keyof NotificationEvents;
  label: string;
  help: string;
}[] = [
  {
    key: "deals",
    label: "New deals",
    help: "A listing cleared the thresholds below.",
  },
  {
    key: "sold",
    label: "Listing likely sold",
    help: "A promising listing disappeared on re-check.",
  },
  {
    key: "loginNeeded",
    label: "Facebook login needed",
    help: "The scraper hit a login wall and needs you to sign in again.",
  },
];

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

function formatSeen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Phone push-notification settings: a master switch, the deal/value/price
 * thresholds a candidate must clear to notify, which targets to be notified
 * about, and the list of phones (Android app installs) that will receive
 * them. Delivery itself happens server-side over Firebase Cloud Messaging;
 * the phone registers itself with the backend when the app syncs.
 */
function NotificationSettingsPanel() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  // Last value persisted to the server; drives auto-save dirty-detection.
  const [serverPrefs, setServerPrefs] = useState<NotificationPrefs | null>(null);
  const [targets, setTargets] = useState<SearchTarget[]>([]);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await api.pushDevices());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load registered phones"
      );
    }
  }, []);

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
    await loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<NotificationPrefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...p } : cur));
  };
  const patchEvent = (key: keyof NotificationEvents, on: boolean) => {
    setPrefs((cur) =>
      cur ? { ...cur, events: { ...cur.events, [key]: on } } : cur
    );
  };

  const removeDevice = async (id: string) => {
    setError(null);
    try {
      await api.removePushDevice(id);
      await loadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove phone");
    }
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

  const selectedTargetIds = prefs?.targetIds ?? [];
  const allTargetsSelected =
    selectedTargetIds.length === 0 || selectedTargetIds.length === targets.length;
  const hasDevices = (devices?.length ?? 0) > 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Phone notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Get a push notification on your phone when the hunt surfaces a deal
          that clears your thresholds. Tapping it opens the deal here in the
          web app. Sign in to the Seneschal Android app on a phone to register
          it.
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
            <FormControlLabel
              control={
                <Switch
                  checked={prefs.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
              }
              label="Send deal alerts to my phone"
            />

            {prefs.enabled && devices !== null && !hasDevices ? (
              <Alert severity="info">
                No phones are registered yet. Install the Seneschal Android
                app, sign in with this account, and allow notifications; it
                registers itself the next time it syncs.
              </Alert>
            ) : null}

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Registered phones
              </Typography>
              {devices === null ? (
                <CircularProgress size={18} />
              ) : devices.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  None yet.
                </Typography>
              ) : (
                <Stack spacing={0.5} sx={{ maxWidth: 480 }}>
                  {devices.map((d) => (
                    <Stack
                      key={d.id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {d.deviceName ?? `${d.platform} device`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Last seen {formatSeen(d.lastSeenAt)}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => void removeDevice(d.id)}
                      >
                        Remove
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Alert types
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Which kinds of event to push. Everything still shows up in the
                Deals list here; these only control what reaches your phone.
              </Typography>
              <FormGroup>
                {EVENT_SWITCHES.map((ev) => (
                  <FormControlLabel
                    key={ev.key}
                    control={
                      <Checkbox
                        size="small"
                        checked={prefs.events[ev.key]}
                        onChange={(e) => patchEvent(ev.key, e.target.checked)}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">{ev.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {ev.help}
                        </Typography>
                      </Box>
                    }
                    sx={{ alignItems: "flex-start", mb: 0.5 }}
                  />
                ))}
              </FormGroup>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Thresholds
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Only notify me about new deals that meet all of these.
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
              {prefs.enabled && hasDevices ? (
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
