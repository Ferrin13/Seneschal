import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import { GENDER_COLOR } from "./stats";
import type { Gender } from "./types";

export type GenderFilterValue = Gender | "";

/** Everyone / Men / Women dropdown, coloured to match the player badges. */
export function GenderFilter({
  id,
  value,
  onChange,
}: {
  id: string;
  value: GenderFilterValue;
  onChange: (v: GenderFilterValue) => void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: 130 }}>
      <InputLabel id={`${id}-label`}>Gender</InputLabel>
      <Select
        labelId={`${id}-label`}
        label="Gender"
        value={value}
        onChange={(e) => onChange(e.target.value as GenderFilterValue)}
        displayEmpty
      >
        <MenuItem value="">Everyone</MenuItem>
        <MenuItem value="M" sx={{ color: GENDER_COLOR.M, fontWeight: 600 }}>
          Men
        </MenuItem>
        <MenuItem value="F" sx={{ color: GENDER_COLOR.F, fontWeight: 600 }}>
          Women
        </MenuItem>
      </Select>
    </FormControl>
  );
}
