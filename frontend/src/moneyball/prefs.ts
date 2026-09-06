import { useCallback, useState } from "react";

const HIDE_UNRATED_KEY = "moneyball.hideUnrated";

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
