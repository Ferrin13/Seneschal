import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import UploadIcon from "@mui/icons-material/Upload";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { MoneyballTabs } from "./MoneyballTabs";
import type { AdminPlayer, AdminPlayerInput, Gender } from "./types";

const GENDER_LABEL: Record<Gender, string> = { M: "Man", F: "Woman" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

type Draft = {
  slug: string;
  name: string;
  photoUrl: string;
  team: string;
  gender: Gender | "";
  number: string;
  active: boolean;
};

function draftOf(p: AdminPlayer | null): Draft {
  return {
    slug: p?.slug ?? "",
    name: p?.name ?? "",
    photoUrl: p?.photoUrl ?? "",
    team: p?.team ?? "",
    gender: p?.gender ?? "",
    number: p?.number != null ? String(p.number) : "",
    active: p?.active ?? true,
  };
}

function toInput(d: Draft): AdminPlayerInput {
  return {
    slug: d.slug.trim(),
    name: d.name.trim(),
    photoUrl: d.photoUrl.trim() || null,
    team: d.team.trim() || null,
    gender: d.gender || null,
    number: d.number.trim() === "" ? null : Number(d.number),
    active: d.active,
  };
}

/** Create/edit dialog. Photo upload is only available once the row exists. */
function PlayerDialog({
  player,
  teams,
  onClose,
  onSaved,
}: {
  /** null = create. */
  player: AdminPlayer | null;
  teams: string[];
  onClose: () => void;
  onSaved: (p: AdminPlayer) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(player));
  const [slugTouched, setSlugTouched] = useState(player != null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(player?.photoSrc ?? null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const numberInvalid =
    draft.number.trim() !== "" &&
    (!/^\d+$/.test(draft.number.trim()) || Number(draft.number) > 999);
  const canSave = draft.name.trim().length > 0 && !numberInvalid && !saving && !uploading;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const input = toInput(draft);
      const saved = player
        ? await api.moneyballAdminUpdatePlayer(player.id, input)
        : await api.moneyballAdminCreatePlayer(input);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(errMsg(err, "Failed to save player"));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    if (!player) return;
    setUploading(true);
    setError(null);
    try {
      const dataBase64 = await readAsBase64(file);
      const saved = await api.moneyballAdminUploadPhoto(player.id, file.type, dataBase64);
      setDraft((d) => ({ ...d, photoUrl: saved.photoUrl ?? "" }));
      setPreview(saved.photoSrc);
      onSaved(saved);
    } catch (err) {
      setError(errMsg(err, "Failed to upload photo"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Live preview for pasted URLs / site paths (not for s3: refs, which need the server).
  const previewSrc = draft.photoUrl.startsWith("s3:")
    ? preview
    : draft.photoUrl.trim() || null;

  return (
    <Dialog open onClose={saving || uploading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{player ? `Edit ${player.name}` : "Add player"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box
              sx={{
                width: 96,
                height: 120,
                flexShrink: 0,
                borderRadius: 1.5,
                overflow: "hidden",
                bgcolor: "action.hover",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {previewSrc ? (
                <Box
                  component="img"
                  src={previewSrc}
                  alt={draft.name}
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <Avatar variant="square" sx={{ width: "100%", height: "100%", fontSize: 32, bgcolor: "transparent", color: "text.secondary" }}>
                  {initials(draft.name || "?")}
                </Avatar>
              )}
            </Box>
            <Stack spacing={1} sx={{ flexGrow: 1, minWidth: 0 }}>
              <TextField
                label="Photo URL"
                size="small"
                value={draft.photoUrl}
                onChange={(e) => set("photoUrl", e.target.value)}
                helperText="Site path (/moneyball/players/x.jpg), https URL, or upload below"
                fullWidth
              />
              <Stack direction="row" spacing={1} alignItems="center">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <Tooltip title={player ? "" : "Save the player first, then upload a photo"}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />}
                      disabled={!player || uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      Upload photo
                    </Button>
                  </span>
                </Tooltip>
                {draft.photoUrl ? (
                  <Button size="small" color="inherit" onClick={() => set("photoUrl", "")}>
                    Clear
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Stack>

          <TextField
            label="Name"
            size="small"
            value={draft.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
            required
            autoFocus={!player}
            fullWidth
          />
          <TextField
            label="Slug"
            size="small"
            value={draft.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value);
            }}
            helperText={
              player?.manuallyEdited === false
                ? "Key the boot-time roster.ts sync matches on — changing it makes roster.ts re-add the original."
                : "Unique key; lowercase letters, digits, dashes."
            }
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Autocomplete
              freeSolo
              options={teams}
              value={draft.team}
              inputValue={draft.team}
              onInputChange={(_e, v) => set("team", v)}
              onChange={(_e, v) => set("team", typeof v === "string" ? v : v ?? "")}
              fullWidth
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Team"
                  size="small"
                  helperText="Pick an existing team or type a new one"
                />
              )}
            />
            <FormControl size="small" fullWidth>
              <InputLabel id="roster-gender-label">Gender</InputLabel>
              <Select
                labelId="roster-gender-label"
                label="Gender"
                value={draft.gender}
                onChange={(e) => set("gender", e.target.value as Gender | "")}
                displayEmpty
              >
                <MenuItem value="">
                  <em>Unknown (can't be lined up)</em>
                </MenuItem>
                <MenuItem value="M">Man</MenuItem>
                <MenuItem value="F">Woman</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Number"
              size="small"
              value={draft.number}
              onChange={(e) => set("number", e.target.value)}
              error={numberInvalid}
              helperText={numberInvalid ? "0–999" : " "}
              inputProps={{ inputMode: "numeric" }}
              fullWidth
            />
          </Stack>
          <FormControlLabel
            control={<Switch checked={draft.active} onChange={(e) => set("active", e.target.checked)} />}
            label="Active (shown on the board)"
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving || uploading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
          {saving ? "Saving…" : player ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteDialog({
  player,
  onClose,
  onDeleted,
}: {
  player: AdminPlayer;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.moneyballAdminDeletePlayer(player.id);
      onDeleted(player.id);
      onClose();
    } catch (err) {
      setError(errMsg(err, "Failed to delete player"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {player.name}?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            This permanently removes the player
            {player.ratingCount > 0
              ? ` and ${player.ratingCount} rating${player.ratingCount === 1 ? "" : "s"} from everyone`
              : ""}
            .
          </Typography>
          <Alert severity="warning" sx={{ py: 0.5 }}>
            If <code>{player.slug}</code> is still in <code>roster.ts</code>, the next deploy
            re-adds them (unrated). Prefer <strong>Inactive</strong> unless they've been removed
            from the file too.
          </Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={() => void run()} disabled={busy}>
          Delete permanently
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Admin-only raw roster editor: every player row in the DB (including
 * inactive), editable in a dialog, with photo upload, soft (inactive) and hard
 * delete. Edits flag the row so the boot-time roster.ts sync leaves it alone.
 */
export function RosterAdminView() {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<AdminPlayer | null | "new">(null);
  const [deleting, setDeleting] = useState<AdminPlayer | null>(null);

  const load = async () => {
    setError(null);
    try {
      setPlayers((await api.moneyballAdminPlayers()).players);
    } catch (err) {
      setError(errMsg(err, "Failed to load roster"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players ?? []) if (p.team) set.add(p.team);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [players]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (players ?? []).filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.slug.includes(q)) &&
        (!team || p.team === team) &&
        (showInactive || p.active)
    );
  }, [players, search, team, showInactive]);

  const replace = (p: AdminPlayer) =>
    setPlayers((list) => {
      if (!list) return list;
      const i = list.findIndex((x) => x.id === p.id);
      const next = i >= 0 ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });

  const toggleActive = async (p: AdminPlayer) => {
    try {
      replace(await api.moneyballAdminUpdatePlayer(p.id, { active: !p.active }));
    } catch (err) {
      setToast(errMsg(err, "Failed to update player"));
    }
  };

  const missingGender = (players ?? []).filter((p) => p.active && p.gender == null).length;

  if (loading) {
    return (
      <Stack spacing={2}>
        <MoneyballTabs value="roster" />
        <Stack alignItems="center" sx={{ mt: 8 }}>
          <CircularProgress />
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <MoneyballTabs value="roster" />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Roster
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Raw player records. Edited rows are pinned and won't be overwritten by the roster.ts
            sync on deploy.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search name or slug"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
          />
          {teams.length > 0 ? (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="roster-filter-team">Team</InputLabel>
              <Select
                labelId="roster-filter-team"
                label="Team"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                displayEmpty
              >
                <MenuItem value="">All teams</MenuItem>
                {teams.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Show inactive</Typography>}
            sx={{ mr: 0 }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
            Add player
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {missingGender > 0 ? (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          {missingGender} active player{missingGender === 1 ? "" : "s"} have no gender set and
          can't be placed on team lines.
        </Alert>
      ) : null}

      <TableContainer
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Player</TableCell>
              <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Slug</TableCell>
              <TableCell>Team</TableCell>
              <TableCell align="center">Gender</TableCell>
              <TableCell align="center" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                #
              </TableCell>
              <TableCell align="center" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                Ratings
              </TableCell>
              <TableCell align="center">Active</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} hover sx={{ opacity: p.active ? 1 : 0.55 }}>
                <TableCell>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar
                      src={p.photoSrc ?? undefined}
                      alt={p.name}
                      variant="rounded"
                      sx={{ width: 36, height: 36, fontSize: 14 }}
                    >
                      {initials(p.name)}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {p.name}
                        </Typography>
                        {p.manuallyEdited ? (
                          <Tooltip title="Edited here; roster.ts sync skips this row">
                            <Chip size="small" label="pinned" variant="outlined" sx={{ height: 18 }} />
                          </Tooltip>
                        ) : null}
                      </Stack>
                      {!p.photoUrl ? (
                        <Typography variant="caption" color="text.secondary">
                          no photo
                        </Typography>
                      ) : null}
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                  <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                    {p.slug}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap>
                    {p.team ?? "–"}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  {p.gender ? (
                    <Chip size="small" label={GENDER_LABEL[p.gender]} variant="outlined" />
                  ) : (
                    <Chip size="small" label="unknown" color="warning" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="center" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                  {p.number ?? "–"}
                </TableCell>
                <TableCell align="center" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                  {p.ratingCount}
                </TableCell>
                <TableCell align="center">
                  <Switch size="small" checked={p.active} onChange={() => void toggleActive(p)} />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  <IconButton size="small" aria-label="Edit" onClick={() => setEditing(p)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="Delete"
                    color="error"
                    onClick={() => setDeleting(p)}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    No players match.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      {editing !== null ? (
        <PlayerDialog
          player={editing === "new" ? null : editing}
          teams={teams}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            replace(p);
            setToast(editing === "new" ? `Added ${p.name}` : `Saved ${p.name}`);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          player={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setPlayers((list) => list?.filter((p) => p.id !== id) ?? list);
            setToast(`Deleted ${deleting.name}`);
          }}
        />
      ) : null}

      <Snackbar
        open={toast != null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
