import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import CenterFocusWeakIcon from "@mui/icons-material/CenterFocusWeak";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import TranslateIcon from "@mui/icons-material/Translate";
import { BeliefPicker, KindDot } from "./BeliefPicker";
import {
  TRANSLATIONS,
  availableTranslations,
  fetchPassage,
  interlinearUrl,
  loadTranslation,
  looksLikeScripture,
  saveTranslation,
  translationMeta,
  type TranslationId,
  type TranslationMeta,
} from "./bible";
import {
  BELIEF_KINDS,
  BELIEF_SCOPES,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  KIND_META,
  RELATION_KINDS,
  RELATION_META,
  SCOPE_META,
  clampConfidence,
  confidenceColor,
  confidenceLabel,
  withAlpha,
} from "./format";
import type { DescartesStore } from "./store";
import type {
  Belief,
  BeliefScope,
  Reference,
  RelationKind,
  Selection,
} from "./types";

function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: 1.5, lineHeight: 1.6 }}
      >
        {children}
      </Typography>
      {action}
    </Stack>
  );
}

/**
 * Full editor for one belief: metadata, notes, scripture references, tags,
 * connections to other beliefs, and group membership.
 */
export function BeliefDetail({
  belief,
  store,
  onSelect,
  onClose,
  focused,
  onToggleFocus,
}: {
  belief: Belief;
  store: DescartesStore;
  onSelect: (sel: Selection) => void;
  onClose: () => void;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const { graph, beliefList } = store;
  const kind = KIND_META[belief.kind];

  const outgoing = graph.relations.filter((r) => r.source === belief.id);
  const incoming = graph.relations.filter((r) => r.target === belief.id);
  const memberOf = graph.clusters.filter((c) => c.memberIds.includes(belief.id));
  const notMemberOf = graph.clusters.filter(
    (c) => !c.memberIds.includes(belief.id)
  );
  const allTags = useMemo(
    () =>
      Array.from(new Set(beliefList.flatMap((b) => b.tags))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [beliefList]
  );

  const update = (patch: Partial<Belief>) => store.updateBelief(belief.id, patch);

  return (
    <Stack sx={{ height: "100%" }}>
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          borderTop: `4px solid ${kind.color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: kind.color, letterSpacing: 2, fontWeight: 700 }}
        >
          {kind.label}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip
            title={
              focused ? "Show whole graph" : "Focus on this belief's neighbourhood"
            }
          >
            <IconButton
              size="small"
              onClick={onToggleFocus}
              color={focused ? "primary" : "default"}
            >
              {focused ? (
                <CenterFocusStrongIcon fontSize="small" />
              ) : (
                <CenterFocusWeakIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Stack spacing={2.5} sx={{ px: 2, pb: 3, overflowY: "auto", flexGrow: 1 }}>
        <TextField
          variant="standard"
          placeholder="Name this belief"
          value={belief.title}
          onChange={(e) => update({ title: e.target.value })}
          autoFocus={!belief.title}
          inputProps={{
            style: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.3 },
          }}
          fullWidth
        />

        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" fullWidth>
            <InputLabel>Kind</InputLabel>
            <Select
              label="Kind"
              value={belief.kind}
              onChange={(e) => update({ kind: e.target.value as Belief["kind"] })}
            >
              {BELIEF_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <KindDot kind={k} />
                    <span>{KIND_META[k].label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={belief.scope}
            onChange={(_e, v: BeliefScope | null) => {
              if (v) update({ scope: v });
            }}
          >
            {BELIEF_SCOPES.map((s) => (
              <ToggleButton
                key={s}
                value={s}
                sx={{ textTransform: "none", px: 1 }}
                title={SCOPE_META[s].hint}
              >
                {SCOPE_META[s].label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
          {kind.hint} · {SCOPE_META[belief.scope].hint.toLowerCase()}
        </Typography>

        <Box>
          <SectionLabel
            action={
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  color: confidenceColor(belief.confidence),
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {belief.confidence}/10 · {confidenceLabel(belief.confidence)}
              </Typography>
            }
          >
            Confidence
          </SectionLabel>
          <Slider
            value={belief.confidence}
            min={CONFIDENCE_MIN}
            max={CONFIDENCE_MAX}
            step={1}
            marks
            valueLabelDisplay="auto"
            onChange={(_e, v) =>
              update({ confidence: clampConfidence(Array.isArray(v) ? v[0] : v) })
            }
            sx={{
              mx: 0.5,
              width: "calc(100% - 8px)",
              color: confidenceColor(belief.confidence),
              "& .MuiSlider-mark": { width: 2, height: 6 },
            }}
          />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: -1 }}>
            <Typography variant="caption" color="text.secondary">
              Doubtful
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Bedrock
            </Typography>
          </Stack>
        </Box>

        <TextField
          label="Summary"
          placeholder="One sentence statement of the belief"
          value={belief.summary}
          onChange={(e) => update({ summary: e.target.value })}
          multiline
          minRows={2}
          size="small"
          fullWidth
        />

        <TextField
          label="Notes"
          placeholder="Working notes, objections, things to read…"
          value={belief.notes}
          onChange={(e) => update({ notes: e.target.value })}
          multiline
          minRows={4}
          size="small"
          fullWidth
        />

        <ReferencesEditor belief={belief} store={store} />

        <Box>
          <SectionLabel>Tags</SectionLabel>
          <Autocomplete<string, true, false, true>
            multiple
            freeSolo
            size="small"
            options={allTags}
            value={belief.tags}
            onChange={(_e, v) => update({ tags: v.map((t) => t.trim()).filter(Boolean) })}
            renderTags={(value, getTagProps) =>
              value.map((tag, index) => {
                const { key, ...rest } = getTagProps({ index });
                return <Chip key={key} size="small" label={tag} {...rest} />;
              })
            }
            renderInput={(params) => (
              <TextField {...params} placeholder="Add tag and press Enter" />
            )}
          />
        </Box>

        <Divider />

        <ConnectionsEditor
          belief={belief}
          store={store}
          outgoing={outgoing}
          incoming={incoming}
          onSelect={onSelect}
        />

        <Divider />

        <Box>
          <SectionLabel>Groups</SectionLabel>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mt: 0.5 }}>
            {memberOf.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Not in any group.
              </Typography>
            ) : null}
            {memberOf.map((c) => (
              <Chip
                key={c.id}
                size="small"
                label={c.label}
                onClick={() => onSelect({ type: "cluster", id: c.id })}
                onDelete={() => store.setMembership(c.id, belief.id, false)}
                sx={{
                  bgcolor: withAlpha(c.color, 0.15),
                  color: c.color,
                  fontWeight: 600,
                  "& .MuiChip-deleteIcon": { color: withAlpha(c.color, 0.7) },
                }}
              />
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <FormControl size="small" fullWidth disabled={notMemberOf.length === 0}>
              <InputLabel>Add to group</InputLabel>
              <Select
                label="Add to group"
                value=""
                onChange={(e) =>
                  store.setMembership(String(e.target.value), belief.id, true)
                }
              >
                {notMemberOf.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              sx={{ whiteSpace: "nowrap" }}
              onClick={() => {
                const id = store.addCluster([belief.id]);
                onSelect({ type: "cluster", id });
              }}
            >
              New group
            </Button>
          </Stack>
        </Box>

        <Divider />

        <Button
          color="error"
          variant="text"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => {
            store.removeBeliefs([belief.id]);
            onClose();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          Delete belief
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * Scripture references. Any citation that looks like "<book> <ch>:<v>" and has
 * no quoted text yet is resolved automatically against the chosen translation
 * when the belief is opened; the fetched text is stored on the reference.
 */
function ReferencesEditor({
  belief,
  store,
}: {
  belief: Belief;
  store: DescartesStore;
}) {
  const references = belief.references;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ ref: "", text: "", note: "" });
  const [translation, setTranslation] = useState<TranslationId>(loadTranslation);
  // Start with the key-free translations; add server-side ones (ESV) once the
  // backend confirms they're configured.
  const [translations, setTranslations] = useState<TranslationMeta[]>(() =>
    TRANSLATIONS.filter((t) => t.source === "bible-api")
  );
  useEffect(() => {
    let live = true;
    void availableTranslations().then((list) => {
      if (!live) return;
      setTranslations(list);
      // A remembered ESV preference on a deployment without a key would
      // fail every fetch; fall back quietly.
      if (!list.some((t) => t.id === translation)) {
        setTranslation("web");
      }
    });
    return () => {
      live = false;
    };
    // Only on mount: the fallback should not fire on each translation change.
  }, []);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  // Reference ids we've already tried this session, so a not-found result
  // doesn't trigger a request on every render.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    for (const r of references) {
      if (r.text || !looksLikeScripture(r.ref)) continue;
      const key = `${r.id}|${translation}`;
      if (attempted.current.has(key)) continue;
      attempted.current.add(key);
      setPending((s) => new Set(s).add(r.id));
      void fetchPassage(r.ref, translation).then((res) => {
        setPending((s) => {
          const next = new Set(s);
          next.delete(r.id);
          return next;
        });
        if (res.status === "ok") {
          store.updateReference(belief.id, r.id, {
            text: res.text,
            translation: res.translation,
          });
          setFailed((f) => {
            if (!(r.id in f)) return f;
            const { [r.id]: _omit, ...rest } = f;
            return rest;
          });
        } else {
          setFailed((f) => ({
            ...f,
            [r.id]:
              res.status === "not-found"
                ? "No passage found for this citation"
                : `Couldn't fetch text (${res.message})`,
          }));
        }
      });
    }
  }, [references, translation, belief.id, store]);

  const changeTranslation = (id: TranslationId) => {
    setTranslation(id);
    saveTranslation(id);
  };

  /** Drop stored text so the effect re-fetches in the current translation. */
  const refetch = (r: Reference) => {
    attempted.current.delete(`${r.id}|${translation}`);
    store.updateReference(belief.id, r.id, { text: undefined, translation: undefined });
  };

  const commit = () => {
    if (!draft.ref.trim()) return;
    store.updateBelief(belief.id, {
      references: [
        ...references,
        {
          id: `ref_${Math.random().toString(36).slice(2, 10)}`,
          ref: draft.ref.trim(),
          text: draft.text.trim() || undefined,
          note: draft.note.trim() || undefined,
        },
      ],
    });
    setDraft({ ref: "", text: "", note: "" });
    setAdding(false);
  };

  const remove = (id: string) => {
    store.updateBelief(belief.id, {
      references: references.filter((x) => x.id !== id),
    });
  };

  const interlinear = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of references) {
      const url = interlinearUrl(r.ref);
      if (url) out[r.id] = url;
    }
    return out;
  }, [references]);

  // Licensed translations require their notice wherever the text is shown.
  const copyrights = useMemo(() => {
    const seen = new Set<string>();
    for (const r of references) {
      const c = r.text ? translationMeta(r.translation)?.copyright : undefined;
      if (c) seen.add(c);
    }
    return [...seen];
  }, [references]);

  return (
    <Box>
      <SectionLabel
        action={
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title="Translation used when fetching verse text">
              <Select
                variant="standard"
                disableUnderline
                size="small"
                value={translation}
                renderValue={(v) => translationMeta(v)?.label ?? String(v)}
                onChange={(e) => changeTranslation(e.target.value as TranslationId)}
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "text.secondary",
                  "& .MuiSelect-select": { py: 0.25, pr: "20px !important" },
                }}
              >
                {translations.map((t) => (
                  <MenuItem key={t.id} value={t.id} dense>
                    <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
                      {t.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.name}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </Tooltip>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setAdding((a) => !a)}
            >
              Add
            </Button>
          </Stack>
        }
      >
        References ({references.length})
      </SectionLabel>
      <Collapse in={adding}>
        <Stack
          spacing={1}
          sx={{
            p: 1.5,
            mb: 1,
            borderRadius: 2,
            bgcolor: "action.hover",
          }}
        >
          <TextField
            size="small"
            label="Citation"
            placeholder="Philippians 2:3-8, WCF 7.1, Calvin Inst. 3.11…"
            value={draft.ref}
            onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
          <TextField
            size="small"
            label="Quoted text"
            helperText={
              looksLikeScripture(draft.ref)
                ? "Leave blank to fetch the passage automatically."
                : undefined
            }
            multiline
            minRows={2}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
          <TextField
            size="small"
            label="Why it matters"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={commit}
              disabled={!draft.ref.trim()}
            >
              Add reference
            </Button>
          </Stack>
        </Stack>
      </Collapse>
      <Stack spacing={1}>
        {references.length === 0 && !adding ? (
          <Typography variant="body2" color="text.secondary">
            No references yet.
          </Typography>
        ) : null}
        {references.map((r) => (
          <Box
            key={r.id}
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "flex-start",
              p: 1,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <FormatQuoteIcon
              sx={{ fontSize: 18, color: "text.disabled", mt: 0.25 }}
            />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.ref}
                </Typography>
                {r.translation ? (
                  <Tooltip title="Fetch again in the selected translation">
                    <Chip
                      size="small"
                      label={
                        translationMeta(r.translation)?.label ??
                        r.translation.toUpperCase()
                      }
                      onClick={() => refetch(r)}
                      sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700 }}
                    />
                  </Tooltip>
                ) : null}
                {pending.has(r.id) ? <CircularProgress size={12} /> : null}
                {interlinear[r.id] ? (
                  <Tooltip title="Open the Hebrew/Greek interlinear on Bible Hub">
                    <IconButton
                      component="a"
                      href={interlinear[r.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      aria-label="Open interlinear"
                      sx={{ p: 0.25, color: "text.disabled", "&:hover": { color: "primary.main" } }}
                    >
                      <TranslateIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
              {r.text ? (
                <PassageText text={r.text} />
              ) : failed[r.id] ? (
                <Typography
                  variant="caption"
                  sx={{ color: "warning.main", display: "block", mt: 0.25 }}
                >
                  {failed[r.id]}
                </Typography>
              ) : null}
              {r.note ? (
                <Typography variant="caption" color="text.secondary">
                  {r.note}
                </Typography>
              ) : null}
            </Box>
            <IconButton
              size="small"
              aria-label="Remove reference"
              onClick={() => remove(r.id)}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ))}
        {copyrights.map((c) => (
          <Typography
            key={c}
            variant="caption"
            sx={{ color: "text.disabled", fontSize: "0.65rem", lineHeight: 1.3 }}
          >
            {c}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

/** Verse text, clamped to a few lines with a toggle when it runs long. */
function PassageText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260;
  return (
    <Box sx={{ mt: 0.25 }}>
      <Typography
        variant="body2"
        sx={{
          fontStyle: "italic",
          color: "text.secondary",
          ...(long && !open
            ? {
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
              }
            : null),
        }}
      >
        {text}
      </Typography>
      {long ? (
        <Button
          size="small"
          onClick={() => setOpen((o) => !o)}
          sx={{ p: 0, minWidth: 0, fontSize: "0.7rem", textTransform: "none" }}
        >
          {open ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </Box>
  );
}

function ConnectionsEditor({
  belief,
  store,
  outgoing,
  incoming,
  onSelect,
}: {
  belief: Belief;
  store: DescartesStore;
  outgoing: { id: string; target: string; kind: RelationKind }[];
  incoming: { id: string; source: string; kind: RelationKind }[];
  onSelect: (sel: Selection) => void;
}) {
  const { graph, beliefList } = store;
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [kind, setKind] = useState<RelationKind>("grounds");
  const [other, setOther] = useState<Belief | null>(null);

  const candidates = beliefList.filter((b) => b.id !== belief.id);
  const meta = RELATION_META[kind];

  const add = () => {
    if (!other) return;
    const id =
      direction === "out"
        ? store.addRelation(belief.id, other.id, kind)
        : store.addRelation(other.id, belief.id, kind);
    setOther(null);
    if (id) store.updateRelation(id, { kind });
  };

  const row = (
    relId: string,
    otherId: string,
    relKind: RelationKind,
    dir: "out" | "in"
  ) => {
    const o = graph.beliefs[otherId];
    if (!o) return null;
    const m = RELATION_META[relKind];
    return (
      <Box
        key={relId}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          borderRadius: 1.5,
          pl: 1,
          pr: 0.25,
          py: 0.25,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {dir === "out" ? (
          <ArrowForwardIcon sx={{ fontSize: 14, color: m.color }} />
        ) : (
          <ArrowBackIcon sx={{ fontSize: 14, color: m.color }} />
        )}
        <Chip
          size="small"
          label={m.verb}
          onClick={() => onSelect({ type: "relation", id: relId })}
          sx={{
            height: 20,
            fontSize: "0.68rem",
            bgcolor: withAlpha(m.color, 0.12),
            color: m.color,
            fontWeight: 600,
          }}
        />
        <ButtonBase
          onClick={() => onSelect({ type: "belief", id: otherId })}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            justifyContent: "flex-start",
            gap: 0.75,
            textAlign: "left",
            borderRadius: 1,
            px: 0.5,
          }}
        >
          <KindDot kind={o.kind} />
          <Typography variant="body2" noWrap>
            {o.title || "Untitled belief"}
          </Typography>
        </ButtonBase>
        <IconButton
          size="small"
          aria-label="Remove connection"
          onClick={() => store.removeRelation(relId)}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    );
  };

  return (
    <Box>
      <SectionLabel>Connections ({outgoing.length + incoming.length})</SectionLabel>
      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        {outgoing.length + incoming.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing connected yet. Add one below, or drag from the bottom of
            this card to the top of another on the canvas.
          </Typography>
        ) : null}
        {outgoing.map((r) => row(r.id, r.target, r.kind, "out"))}
        {incoming.map((r) => row(r.id, r.source, r.kind, "in"))}
      </Stack>

      <Stack
        spacing={1}
        sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={direction}
            onChange={(_e, v: "out" | "in" | null) => {
              if (v) setDirection(v);
            }}
          >
            <ToggleButton value="out" sx={{ px: 1, textTransform: "none" }}>
              This →
            </ToggleButton>
            <ToggleButton value="in" sx={{ px: 1, textTransform: "none" }}>
              → This
            </ToggleButton>
          </ToggleButtonGroup>
          <FormControl size="small" fullWidth>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as RelationKind)}
            >
              {RELATION_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{
                        width: 14,
                        height: 0,
                        borderTop: `2px ${RELATION_META[k].dashed ? "dashed" : "solid"} ${RELATION_META[k].color}`,
                      }}
                    />
                    <span>{RELATION_META[k].label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {direction === "out"
            ? `“${belief.title || "This"}” ${meta.verb} …`
            : `… ${meta.verb} “${belief.title || "this"}”`}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Box sx={{ flexGrow: 1 }}>
            <BeliefPicker
              options={candidates}
              value={other}
              onChange={setOther}
              placeholder="Choose a belief"
            />
          </Box>
          <Button
            size="small"
            variant="contained"
            disabled={!other}
            onClick={add}
          >
            Link
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
