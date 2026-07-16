import {
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { useState } from "react";
import {
  api,
  type Platform,
  type Search,
  type SearchFilters,
} from "../api";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "craigslist", label: "Craigslist" },
];

function centsToDollars(cents: number | undefined): string {
  return cents != null ? String(cents / 100) : "";
}

/** Parse a dollar string to integer cents, or undefined when blank/invalid. */
function dollarsToCents(value: string): number | undefined {
  const n = Number(value);
  if (!value.trim() || Number.isNaN(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value);
  if (!value.trim() || Number.isNaN(n) || n <= 0) return undefined;
  return n;
}

/**
 * Create or edit a manual search. Platform is fixed after creation (the
 * server can't rebuild a cross-platform URL), so it's only editable when
 * adding. Existing filters not surfaced here (e.g. condition) are preserved.
 */
export function SearchForm({
  mode,
  targetId,
  search,
  onSaved,
  onCancel,
  onError,
}: {
  mode: "create" | "edit";
  targetId: string;
  search?: Search;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [platform, setPlatform] = useState<Platform>(
    search?.platform ?? "facebook"
  );
  const [query, setQuery] = useState(search?.query ?? "");
  const [minPrice, setMinPrice] = useState(
    centsToDollars(search?.filters?.minPriceCents)
  );
  const [maxPrice, setMaxPrice] = useState(
    centsToDollars(search?.filters?.maxPriceCents)
  );
  const [radius, setRadius] = useState(
    search?.filters?.radiusMiles != null
      ? String(search.filters.radiusMiles)
      : ""
  );
  const [category, setCategory] = useState(search?.filters?.category ?? "");
  const [isActive, setIsActive] = useState(search?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  const buildFilters = (): SearchFilters => {
    // Preserve any existing filter keys we don't expose (e.g. condition).
    const filters: SearchFilters = { ...(search?.filters ?? {}) };
    const setOrDelete = (key: keyof SearchFilters, value: unknown) => {
      if (value === undefined) delete filters[key];
      else (filters as Record<string, unknown>)[key] = value;
    };
    setOrDelete("minPriceCents", dollarsToCents(minPrice));
    setOrDelete("maxPriceCents", dollarsToCents(maxPrice));
    setOrDelete("radiusMiles", numberOrUndefined(radius));
    setOrDelete("category", category.trim() || undefined);
    return filters;
  };

  const submit = async () => {
    if (!query.trim()) return;
    setSaving(true);
    try {
      const filters = buildFilters();
      if (mode === "create") {
        await api.createSearch({
          targetId,
          platform,
          query: query.trim(),
          filters,
        });
      } else if (search) {
        await api.updateSearch(search.id, {
          query: query.trim(),
          filters,
          isActive,
        });
      }
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save search");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        p: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "action.hover",
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems="flex-start"
        >
          <TextField
            select
            label="Platform"
            size="small"
            value={platform}
            disabled={mode === "edit"}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            sx={{ minWidth: 140 }}
          >
            {PLATFORMS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Search query"
            placeholder="mid-century teak dresser"
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            fullWidth
          />
        </Stack>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems="flex-start"
        >
          <TextField
            label="Min $"
            size="small"
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            sx={{ maxWidth: 120 }}
          />
          <TextField
            label="Max $"
            size="small"
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            sx={{ maxWidth: 120 }}
          />
          <TextField
            label="Radius (mi)"
            size="small"
            type="number"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            sx={{ maxWidth: 130 }}
          />
          <TextField
            label="Category"
            size="small"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            fullWidth
          />
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
        >
          {mode === "edit" ? (
            <FormControlLabel
              control={
                <Switch
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
              }
              label="Active"
            />
          ) : (
            <Box />
          )}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              disabled={saving || !query.trim()}
              onClick={() => void submit()}
            >
              {saving
                ? "Saving..."
                : mode === "create"
                  ? "Add search"
                  : "Save"}
            </Button>
            <Button
              variant="text"
              size="small"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
}
