import { Tab, Tabs } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export const MONEYBALL_PATH = "/moneyball";
export const MONEYBALL_TEAMS_PATH = "/moneyball/teams";
export const MONEYBALL_CONCENTRATION_PATH = "/moneyball/concentration";
export const MONEYBALL_COMPARE_PATH = "/moneyball/compare";
export const MONEYBALL_ROSTER_PATH = "/moneyball/roster";

export type MoneyballTab = "players" | "compare" | "teams" | "concentration" | "roster";

const TAB_PATHS: Record<MoneyballTab, string> = {
  players: MONEYBALL_PATH,
  compare: MONEYBALL_COMPARE_PATH,
  teams: MONEYBALL_TEAMS_PATH,
  concentration: MONEYBALL_CONCENTRATION_PATH,
  roster: MONEYBALL_ROSTER_PATH,
};

/** Secondary navigation within Moneyball. The Roster tab is admin-only. */
export function MoneyballTabs({ value }: { value: MoneyballTab }) {
  const navigate = useNavigate();
  const { me } = useAuth();
  return (
    <Tabs
      value={value}
      onChange={(_e, v: MoneyballTab) => navigate(TAB_PATHS[v])}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      <Tab value="players" label="Players" />
      <Tab value="compare" label="Compare" />
      <Tab value="teams" label="Teams" />
      <Tab value="concentration" label="Concentration" />
      {me?.isAdmin ? <Tab value="roster" label="Roster" /> : null}
    </Tabs>
  );
}
