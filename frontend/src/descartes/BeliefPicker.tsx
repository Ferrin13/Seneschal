import { useMemo } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { BELIEF_KINDS, KIND_META } from "./format";
import type { Belief } from "./types";

/** Autocomplete over beliefs, with a kind-coloured dot in each option. */
export function BeliefPicker({
  options,
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  options: Belief[];
  value: Belief | null;
  onChange: (b: Belief | null) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  // MUI's groupBy expects options already ordered by group.
  const sorted = useMemo(
    () =>
      [...options].sort(
        (a, b) =>
          BELIEF_KINDS.indexOf(a.kind) - BELIEF_KINDS.indexOf(b.kind) ||
          a.title.localeCompare(b.title)
      ),
    [options]
  );
  return (
    <Autocomplete<Belief>
      options={sorted}
      value={value}
      onChange={(_e, v) => onChange(v)}
      getOptionLabel={(b) => b.title || "Untitled belief"}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      groupBy={(b) => KIND_META[b.kind].plural}
      size="small"
      renderOption={(props, b) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ gap: 1 }}>
            <KindDot kind={b.kind} />
            <Typography variant="body2" noWrap>
              {b.title || "Untitled belief"}
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      )}
    />
  );
}

export function KindDot({ kind, size = 8 }: { kind: Belief["kind"]; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: KIND_META[kind].color,
        flexShrink: 0,
      }}
    />
  );
}
