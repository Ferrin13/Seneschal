import {
  Alert,
  Box,
  Card,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Drawer,
  Divider,
  Link,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateDetail,
  type CandidateStatus,
  type DealNotification,
  type LlmUsage,
  type Platform,
  type Verdict,
} from "./api";

function money(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "—";
}

function ageText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

const PLATFORM_COLOR: Record<Platform, "primary" | "secondary"> = {
  facebook: "primary",
  craigslist: "secondary",
};

const VERDICT: Record<
  "good_deal" | "pass" | "unsure",
  { label: string; color: "success" | "error" | "warning" }
> = {
  good_deal: { label: "Good deal", color: "success" },
  pass: { label: "Pass", color: "error" },
  unsure: { label: "Unsure", color: "warning" },
};

function VerdictChip({
  verdict,
  confidence,
}: {
  verdict: Verdict;
  confidence: number | null;
}) {
  if (!verdict) return <Chip size="small" variant="outlined" label="Not evaluated" />;
  const v = VERDICT[verdict];
  return (
    <Chip
      size="small"
      color={v.color}
      label={
        confidence != null
          ? `${v.label} · ${Math.round(confidence * 100)}%`
          : v.label
      }
    />
  );
}

function StatusBadge({ status }: { status: CandidateStatus }) {
  if (status === "active") return null;
  return (
    <Chip
      size="small"
      color={status === "sold" ? "warning" : "default"}
      label={status === "sold" ? "Likely sold" : "Disappeared"}
    />
  );
}

const TABS: { value: CandidateStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "sold", label: "Likely sold" },
  { value: "disappeared", label: "Disappeared" },
  { value: "all", label: "All" },
];

export function DealsView() {
  const [notifications, setNotifications] = useState<DealNotification[] | null>(
    null
  );
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [usage, setUsage] = useState<LlmUsage | null>(null);
  const [tab, setTab] = useState<CandidateStatus | "all">("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [n, c, u] = await Promise.all([
        api.notifications(),
        api.candidates(tab === "all" ? undefined : tab),
        api.llmUsage(),
      ]);
      setNotifications(n);
      setCandidates(c);
      setUsage(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deals");
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

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

      {usage ? <LlmUsagePanel usage={usage} /> : null}

      <Box>
        <Tabs
          value={tab}
          onChange={(_e, v) => setTab(v)}
          sx={{ mb: 2 }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>

        {candidates === null ? (
          <CircularProgress />
        ) : candidates.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            No candidates here yet. Run a hunt from a target to harvest listings.
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 2,
            }}
          >
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                onClick={() => setSelected(c.id)}
              />
            ))}
          </Box>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={selected !== null}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 } } }}
      >
        {selected ? (
          <CandidateDetailPanel
            id={selected}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </Drawer>
    </Stack>
  );
}

function CandidateCard({
  candidate: c,
  onClick,
}: {
  candidate: Candidate;
  onClick: () => void;
}) {
  const e = c.evaluation;
  const listed = ageText(c.sourceListedAt);
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{ cursor: "pointer", "&:hover": { boxShadow: 3 } }}
    >
      {c.thumbnailUrl ? (
        <CardMedia
          component="img"
          height="150"
          image={c.thumbnailUrl}
          alt={c.title ?? ""}
        />
      ) : null}
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 0.5 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            color={PLATFORM_COLOR[c.platform]}
            label={c.platform}
          />
          {c.promiseScore != null ? (
            <Chip size="small" variant="outlined" label={`★ ${c.promiseScore}`} />
          ) : null}
          <StatusBadge status={c.status} />
        </Stack>
        <Typography variant="subtitle2" noWrap title={c.title ?? ""}>
          {c.title ?? "(untitled)"}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ my: 0.5 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Chip size="small" label={money(c.priceCents)} />
          <VerdictChip verdict={e?.verdict ?? null} confidence={e?.confidence ?? null} />
        </Stack>
        {e?.estimatedValueCents != null ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Est. value {money(e.estimatedValueCents)}
            {c.compsCount ? ` · ${c.compsCount} comps` : ""}
          </Typography>
        ) : c.compsCount ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {c.compsCount} comps
          </Typography>
        ) : null}
        {e?.rationale ? (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.5 }}
          >
            {e.rationale}
          </Typography>
        ) : null}
        {listed ? (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.5 }}
          >
            Listed {listed}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

const STAGE_LABEL: Record<string, string> = {
  discovered: "Discovered",
  triaged: "Triaged",
  deep_scraped: "Deep scraped",
  comps_gathered: "Comps gathered",
  evaluated: "Evaluated",
  sold: "Likely sold",
  disappeared: "Disappeared",
  error: "Error",
};

function CandidateDetailPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    api
      .candidateDetail(id)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load")
      );
    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!detail) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  const { candidate: c, listing, comps, evaluations, events } = detail;
  const advanced = evaluations.find((e) => e.tier === "advanced");
  const cover = listing?.images.find((i) => i.url)?.url ?? c.thumbnailUrl;

  return (
    <Box sx={{ p: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 1 }}
      >
        <Typography variant="h6" sx={{ pr: 2 }}>
          {c.title ?? "(untitled)"}
        </Typography>
        <Link component="button" onClick={onClose} sx={{ flexShrink: 0 }}>
          Close
        </Link>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip size="small" color={PLATFORM_COLOR[c.platform]} label={c.platform} />
        <Chip size="small" label={money(c.priceCents)} />
        <VerdictChip
          verdict={advanced?.verdict ?? null}
          confidence={advanced?.confidence ?? null}
        />
        <StatusBadge status={c.status} />
        {c.promiseScore != null ? (
          <Chip size="small" variant="outlined" label={`★ ${c.promiseScore}`} />
        ) : null}
      </Stack>

      {cover ? (
        <Box
          component="img"
          src={cover}
          alt={c.title ?? ""}
          sx={{ width: "100%", borderRadius: 1, mb: 2, maxHeight: 260, objectFit: "cover" }}
        />
      ) : null}

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {ageText(c.sourceListedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Listed {ageText(c.sourceListedAt)}
          </Typography>
        ) : null}
        {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt) ? (
          <Typography variant="caption" color="text.secondary">
            Updated {ageText(listing?.sourceUpdatedAt ?? c.sourceUpdatedAt)}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          Last seen {ageText(c.lastSeenAt) ?? "today"}
        </Typography>
      </Stack>

      {advanced ? (
        <Alert
          severity={
            advanced.verdict === "good_deal"
              ? "success"
              : advanced.verdict === "pass"
                ? "error"
                : "info"
          }
          sx={{ mb: 2 }}
        >
          {advanced.estimatedValueCents != null ? (
            <Typography variant="body2">
              Est. value {money(advanced.estimatedValueCents)} vs asking{" "}
              {money(c.priceCents)}
            </Typography>
          ) : null}
          {advanced.rationale ? (
            <Typography variant="body2">{advanced.rationale}</Typography>
          ) : null}
          {advanced.model ? (
            <Typography variant="caption" color="text.secondary">
              {advanced.model}
            </Typography>
          ) : null}
        </Alert>
      ) : null}

      {listing?.description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {listing.description.slice(0, 600)}
        </Typography>
      ) : null}

      <Link href={c.listingUrl} target="_blank" rel="noreferrer">
        Open original listing
      </Link>

      {comps.length > 0 ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Comparables ({comps.length})
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Source</TableCell>
                <TableCell>Match</TableCell>
                <TableCell align="right">Price</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {comps.map((cp) => (
                <TableRow key={cp.id}>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={cp.source} />
                  </TableCell>
                  <TableCell>
                    {cp.url ? (
                      <Link href={cp.url} target="_blank" rel="noreferrer">
                        {cp.matchedTitle ?? "link"}
                      </Link>
                    ) : (
                      cp.matchedTitle ?? "—"
                    )}
                  </TableCell>
                  <TableCell align="right">{money(cp.priceCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : null}

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          History
        </Typography>
        {events.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No events yet.
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {events.map((ev) => (
              <Box key={ev.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    size="small"
                    label={STAGE_LABEL[ev.stage] ?? ev.stage}
                    color={ev.stage === "error" ? "error" : "default"}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(ev.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
                {ev.message ? (
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {ev.message}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        First seen {new Date(c.firstSeenAt).toLocaleString()}
      </Typography>
    </Box>
  );
}

function cost(n: number | null): string {
  return n != null ? `$${n.toFixed(4)}` : "—";
}

function LlmUsagePanel({ usage }: { usage: LlmUsage }) {
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
        <Typography variant="caption" color="text.secondary">
          {usage.totalCalls} calls · {usage.totalTokens.toLocaleString()} tokens
        </Typography>
        {usage.byModel.length > 0 ? (
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell align="right">Calls</TableCell>
                <TableCell align="right">Cost</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {usage.byModel.map((m) => (
                <TableRow key={m.model}>
                  <TableCell>{m.model}</TableCell>
                  <TableCell align="right">{m.calls}</TableCell>
                  <TableCell align="right">{cost(m.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
