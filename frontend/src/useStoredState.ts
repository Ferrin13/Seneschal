import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Like `useState`, but the value is persisted to `localStorage` under `key` so
 * it survives reloads. Reads once on mount (falling back to `initial` when
 * absent or unparseable) and writes on every change. Storage errors (private
 * mode, quota) are swallowed so the UI keeps working in memory.
 */
export function useStoredState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage errors */
    }
  }, [key, value]);

  return [value, setValue];
}

/** Whether a value has previously been persisted for `key`. */
export function hasStored(key: string): boolean {
  try {
    return localStorage.getItem(key) != null;
  } catch {
    return false;
  }
}
