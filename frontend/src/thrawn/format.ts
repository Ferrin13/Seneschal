import type { PlayerValue, ThrawnTeam } from "./types";

/** One decimal point display for projected points / VAR. */
export function fmtPts(n: number): string {
  return n.toFixed(1);
}

export function fmtVar(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

export const POSITION_COLORS: Record<string, string> = {
  QB: "#D32F2F",
  RB: "#2E7D32",
  WR: "#1565C0",
  TE: "#EF6C00",
  K: "#7B1FA2",
  DEF: "#546E7A",
};

export function positionColor(pos: string): string {
  return POSITION_COLORS[pos] ?? "#616161";
}

export function teamLabel(team: ThrawnTeam): string {
  return team.teamName || team.displayName || `Roster ${team.rosterId}`;
}

export function sleeperAvatarUrl(avatar: string | null): string | undefined {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : undefined;
}

/** Values for one roster, best VAR first. */
export function rosterValues(
  values: PlayerValue[],
  rosterId: number
): PlayerValue[] {
  return values
    .filter((v) => v.rosterId === rosterId)
    .sort((a, b) => b.var - a.var);
}

export function keeperCount(values: PlayerValue[], rosterId: number): number {
  return values.filter((v) => v.rosterId === rosterId && v.keeperLevel).length;
}
