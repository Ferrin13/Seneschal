import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  ListSubheader,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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
} from "./api";

export function SettingsView() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Settings</Typography>
        <Typography color="text.secondary" variant="body2">
          Configure which model each step of the deal pipeline uses, and review
          LLM spend.
        </Typography>
      </Box>
      <ModelSettingsPanel />
      <LlmUsagePanel />
    </Stack>
  );
}

function ModelSettingsPanel() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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

  const dirty =
    settings != null &&
    settings.steps.some((st) => (drafts[st.step] ?? "") !== (st.model ?? ""));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const overrides: Record<string, string | null> = {};
      for (const [step, value] of Object.entries(drafts)) {
        overrides[step] = value.trim() ? value.trim() : null;
      }
      apply(await api.updateModelSettings(overrides));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

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
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="contained"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
              {savedAt && !dirty ? (
                <Typography variant="caption" color="success.main">
                  Saved ✓
                </Typography>
              ) : null}
            </Stack>
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
