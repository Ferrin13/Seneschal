import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type AdminUser } from "../api";
import { useAuth } from "../auth";
import { FEATURE_HINTS, FEATURE_LABELS, FEATURES, type Feature } from "../features";

/**
 * Admin console: which Google accounts may sign in and which products each
 * one sees. Edits save immediately. Admin is a separate flag from features:
 * it unlocks this page, nothing else.
 */
export function AdminView() {
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.adminUsers();
      setUsers(res.users);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceRow = (next: AdminUser) =>
    setUsers((prev) =>
      prev ? prev.map((u) => (u.email === next.email ? next : u)) : prev
    );

  const withBusy = async (email: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(email));
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(email);
        return n;
      });
    }
  };

  const toggleFeature = (u: AdminUser, f: Feature, on: boolean) =>
    withBusy(u.email, async () => {
      const features = on
        ? [...u.features, f]
        : u.features.filter((x) => x !== f);
      replaceRow(await api.adminUpdateUser(u.email, { features }));
    });

  const setAdmin = (u: AdminUser, isAdmin: boolean) =>
    withBusy(u.email, async () => {
      replaceRow(await api.adminUpdateUser(u.email, { isAdmin }));
    });

  const remove = (u: AdminUser) => {
    const ok = window.confirm(
      `Revoke access for ${u.email}?\n\nThey will no longer be able to sign in. ` +
        "Their data is kept, so granting access again later restores everything."
    );
    if (!ok) return;
    void withBusy(u.email, async () => {
      await api.adminDeleteUser(u.email);
      setUsers((prev) => (prev ? prev.filter((x) => x.email !== u.email) : prev));
    });
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Admin</Typography>
        <Typography color="text.secondary" variant="body2">
          Grant Google accounts access to Seneschal and choose which products
          each one can use. Changes save immediately; people already signed in
          pick them up on their next request.
        </Typography>
      </Box>

      <AddAccountCard
        onAdded={(u) => setUsers((prev) => (prev ? [...prev, u] : [u]))}
      />

      {actionError ? (
        <Alert severity="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Accounts
          </Typography>
          {loadError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void load()}>
                  Retry
                </Button>
              }
            >
              {loadError}
            </Alert>
          ) : users === null ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress />
            </Stack>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Account</TableCell>
                    <TableCell>Admin</TableCell>
                    {FEATURES.map((f) => (
                      <TableCell key={f} align="center">
                        <Tooltip title={FEATURE_HINTS[f]}>
                          <span>{FEATURE_LABELS[f]}</span>
                        </Tooltip>
                      </TableCell>
                    ))}
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u) => {
                    const isSelf =
                      !!me?.email && me.email.toLowerCase() === u.email;
                    const rowBusy = busy.has(u.email);
                    const lockAdmin = u.bootstrap || isSelf;
                    return (
                      <TableRow key={u.email} hover>
                        <TableCell>
                          <Stack spacing={0.25}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={500}>
                                {u.email}
                              </Typography>
                              {u.bootstrap ? (
                                <Tooltip title="Configured in BOOTSTRAP_ADMIN_EMAILS; always an admin and cannot be removed here.">
                                  <Chip size="small" label="Bootstrap" />
                                </Tooltip>
                              ) : null}
                              {isSelf ? (
                                <Chip size="small" color="primary" label="You" />
                              ) : null}
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {u.user
                                ? `${u.user.displayName ?? "Signed in"} · first sign-in ${formatDate(u.user.firstSignInAt)}`
                                : `Invited ${formatDate(u.createdAt)} · has not signed in yet`}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Tooltip
                            title={
                              u.bootstrap
                                ? "Bootstrap admins are always admins"
                                : isSelf
                                  ? "You cannot remove your own admin access"
                                  : ""
                            }
                          >
                            <span>
                              <Switch
                                size="small"
                                checked={u.isAdmin}
                                disabled={rowBusy || lockAdmin}
                                onChange={(e) => void setAdmin(u, e.target.checked)}
                                inputProps={{ "aria-label": `Admin for ${u.email}` }}
                              />
                            </span>
                          </Tooltip>
                        </TableCell>
                        {FEATURES.map((f) => (
                          <TableCell key={f} align="center" padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={u.features.includes(f)}
                              disabled={rowBusy}
                              onChange={(e) =>
                                void toggleFeature(u, f, e.target.checked)
                              }
                              inputProps={{
                                "aria-label": `${FEATURE_LABELS[f]} for ${u.email}`,
                              }}
                            />
                          </TableCell>
                        ))}
                        <TableCell align="right">
                          <Tooltip
                            title={
                              u.bootstrap
                                ? "Bootstrap admins cannot be removed"
                                : isSelf
                                  ? "You cannot revoke your own access"
                                  : "Revoke access"
                            }
                          >
                            <span>
                              <IconButton
                                size="small"
                                disabled={rowBusy || u.bootstrap || isSelf}
                                onClick={() => remove(u)}
                                aria-label={`Revoke access for ${u.email}`}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={FEATURES.length + 3}>
                        <Typography color="text.secondary" variant="body2">
                          No accounts yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

function AddAccountCard({ onAdded }: { onAdded: (u: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (f: Feature, on: boolean) =>
    setFeatures((prev) =>
      on ? [...new Set([...prev, f])] : prev.filter((x) => x !== f)
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api.adminCreateUser({
        email: email.trim(),
        isAdmin,
        features,
      });
      onAdded(created);
      setEmail("");
      setIsAdmin(false);
      setFeatures([]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Add account
        </Typography>
        <Box component="form" onSubmit={(e) => void submit(e)}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ sm: "center" }}
            >
              <TextField
                label="Google account email"
                type="email"
                required
                size="small"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="someone@gmail.com"
                sx={{ minWidth: 300 }}
                autoComplete="off"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={isAdmin}
                    onChange={(e) => setIsAdmin(e.target.checked)}
                  />
                }
                label="Admin"
              />
            </Stack>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
              {FEATURES.map((f) => (
                <FormControlLabel
                  key={f}
                  control={
                    <Checkbox
                      size="small"
                      checked={features.includes(f)}
                      onChange={(e) => toggle(f, e.target.checked)}
                    />
                  }
                  label={
                    <Tooltip title={FEATURE_HINTS[f]}>
                      <span>{FEATURE_LABELS[f]}</span>
                    </Tooltip>
                  }
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                type="submit"
                variant="contained"
                disabled={saving || email.trim().length === 0}
              >
                {saving ? "Adding…" : "Add account"}
              </Button>
              <Button
                size="small"
                onClick={() => setFeatures([...FEATURES])}
                disabled={saving}
              >
                Select all products
              </Button>
            </Stack>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** Surface the backend's `message` when it sends one, else the raw body. */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.message) as {
        message?: string;
        error?: string;
      };
      return parsed.message ?? parsed.error ?? err.message;
    } catch {
      return err.message || `Request failed (${err.status})`;
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
