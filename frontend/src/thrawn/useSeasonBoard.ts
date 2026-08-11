import { useEffect, useState } from "react";
import { api } from "../api";
import type { SeasonBoard } from "./types";

/**
 * Fetch and cache a past season's board (real rosters priced at that
 * season's actual stats). Returns null until a season is selected,
 * "loading"/"error" while in flight or failed, then the board.
 */
export function useSeasonBoard(
  leagueId: string,
  season: string | null
): SeasonBoard | "loading" | "error" | null {
  const [boards, setBoards] = useState<
    Record<string, SeasonBoard | "loading" | "error">
  >({});

  useEffect(() => {
    if (!season || boards[season]) return;
    setBoards((prev) => ({ ...prev, [season]: "loading" }));
    let cancelled = false;
    api
      .thrawnLeagueSeasonBoard(leagueId, season)
      .then((b) => {
        if (!cancelled) setBoards((prev) => ({ ...prev, [season]: b }));
      })
      .catch(() => {
        if (!cancelled) setBoards((prev) => ({ ...prev, [season]: "error" }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, season]);

  return season ? boards[season] ?? null : null;
}
