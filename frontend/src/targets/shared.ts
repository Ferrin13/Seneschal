import type { HuntRunStatus } from "../api";

/** Cadence choices offered in the schedule controls (minutes). */
export const CADENCE_PRESETS: number[] = [
  5, 10, 15, 30, 60, 120, 240, 360, 720, 1440,
];

/** Human-readable interval label, e.g. 5 → "5 min", 90 → "1h 30m", 1440 → "1 day". */
export function formatInterval(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) {
    const days = min / 1440;
    return days === 1 ? "1 day" : `${days} days`;
  }
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  if (mins === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${hours}h ${mins}m`;
}

/** Format an LLM cost (USD) compactly; sub-cent values keep more precision. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const RUN_STATUS: Record<
  HuntRunStatus,
  { label: string; color: "info" | "success" | "error" }
> = {
  running: { label: "Running", color: "info" },
  completed: { label: "Completed", color: "success" },
  failed: { label: "Failed", color: "error" },
};
