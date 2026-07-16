import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Search } from "../api";
import { SearchForm } from "./SearchForm";

/**
 * Manage a target's concrete searches: generate them with AI, add them by
 * hand, and edit/enable/delete existing ones. Self-loads on mount (mounted
 * lazily when the Searches section is expanded).
 */
export function SearchesSection({
  targetId,
  onError,
}: {
  targetId: string;
  onError: (msg: string) => void;
}) {
  const [searches, setSearches] = useState<Search[] | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSearches(await api.targetSearches(targetId));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load searches");
    }
  }, [targetId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const expand = async () => {
    setExpanding(true);
    try {
      await api.expandTarget(targetId);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        onError("LLM not configured on the server (set LLM_API_KEY).");
      } else {
        onError(err instanceof Error ? err.message : "Failed to expand target");
      }
    } finally {
      setExpanding(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteSearch(id);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete search");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={adding}
          onClick={() => {
            setAdding(true);
            setEditingId(null);
          }}
        >
          Add search
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AutoAwesomeIcon />}
          disabled={expanding}
          onClick={() => void expand()}
        >
          {expanding ? "Expanding..." : "Expand with AI"}
        </Button>
      </Stack>

      {adding ? (
        <SearchForm
          mode="create"
          targetId={targetId}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
          onError={onError}
        />
      ) : null}

      {searches === null ? (
        <Stack alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={22} />
        </Stack>
      ) : searches.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          No searches yet. Add one manually or generate them with AI.
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={1.5}>
          {searches.map((s) =>
            editingId === s.id ? (
              <SearchForm
                key={s.id}
                mode="edit"
                targetId={targetId}
                search={s}
                onSaved={async () => {
                  setEditingId(null);
                  await load();
                }}
                onCancel={() => setEditingId(null)}
                onError={onError}
              />
            ) : (
              <SearchRow
                key={s.id}
                search={s}
                onEdit={() => {
                  setEditingId(s.id);
                  setAdding(false);
                }}
                onDelete={() => void remove(s.id)}
              />
            )
          )}
        </Stack>
      )}
    </Stack>
  );
}

function SearchRow({
  search,
  onEdit,
  onDelete,
}: {
  search: Search;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const f = search.filters;
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="flex-start"
      justifyContent="space-between"
      sx={{ opacity: search.isActive ? 1 : 0.55 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
          {search.query}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 0.5 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Chip
            size="small"
            color={search.platform === "facebook" ? "primary" : "secondary"}
            label={search.platform}
          />
          <Chip size="small" variant="outlined" label={search.source} />
          {!search.isActive ? (
            <Chip size="small" variant="outlined" label="inactive" />
          ) : null}
          {f?.minPriceCents != null ? (
            <Chip size="small" label={`>= $${Math.round(f.minPriceCents / 100)}`} />
          ) : null}
          {f?.maxPriceCents != null ? (
            <Chip size="small" label={`<= $${Math.round(f.maxPriceCents / 100)}`} />
          ) : null}
          {f?.radiusMiles != null ? (
            <Chip size="small" variant="outlined" label={`${f.radiusMiles} mi`} />
          ) : null}
          {f?.category ? (
            <Chip size="small" variant="outlined" label={f.category} />
          ) : null}
        </Stack>
      </Box>
      <Stack direction="row" spacing={0.5} alignItems="center">
        {search.searchUrl ? (
          <Link
            href={search.searchUrl}
            target="_blank"
            rel="noreferrer"
            sx={{ mr: 0.5, whiteSpace: "nowrap" }}
          >
            Open
          </Link>
        ) : null}
        <Tooltip title="Edit search">
          <IconButton size="small" aria-label="edit search" onClick={onEdit}>
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete search">
          <IconButton size="small" aria-label="delete search" onClick={onDelete}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
