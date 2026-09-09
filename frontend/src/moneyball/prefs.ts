import { useCallback, useState } from "react";

const HIDE_UNRATED_KEY = "moneyball.hideUnrated";
const EXCLUDED_RATERS_KEY = "moneyball.excludedRaters";

function readHideUnrated(): boolean {
  try {
    const raw = window.localStorage.getItem(HIDE_UNRATED_KEY);
    // Default off: show the consensus; opt in to blind rating.
    return raw == null ? false : raw === "1";
  } catch {
    return false;
  }
}

/**
 * "Blind rating" preference: hide other people's ratings for players the
 * current user hasn't rated yet, so their own rating isn't anchored by the
 * consensus. Persisted per browser; off by default.
 */
export function useHideUnrated(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(readHideUnrated);
  const set = useCallback((v: boolean) => {
    setValue(v);
    try {
      window.localStorage.setItem(HIDE_UNRATED_KEY, v ? "1" : "0");
    } catch {
      // Private mode / quota: keep the in-memory value only.
    }
  }, []);
  return [value, set];
}

function readExcludedRaters(): string[] {
  try {
    const raw = window.localStorage.getItem(EXCLUDED_RATERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((v): v is string => typeof v === "string"))].sort()
      : [];
  } catch {
    return [];
  }
}

/**
 * Rater filter: user ids whose ratings the viewer wants left out of every
 * consensus figure (team means, OVR, role OVRs). Sent to the API as
 * `?excludeRaters=`; nothing is changed server-side. Stored as an exclusion
 * list so newly-arriving raters count by default. Persisted per browser; the
 * returned array is sorted and stable, so it's safe as an effect dependency.
 */
export function useExcludedRaters(): [string[], (ids: readonly string[]) => void] {
  const [value, setValue] = useState<string[]>(readExcludedRaters);
  const set = useCallback((ids: readonly string[]) => {
    const next = [...new Set(ids)].sort();
    setValue((prev) =>
      prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
    );
    try {
      window.localStorage.setItem(EXCLUDED_RATERS_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota: keep the in-memory value only.
    }
  }, []);
  return [value, set];
}
