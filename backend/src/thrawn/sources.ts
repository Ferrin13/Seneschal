/**
 * Additional public projection sources beyond Sleeper: ESPN's fantasy API
 * and the FantasySharks season CSV. Both are normalized into Sleeper's
 * stat-key space so scoreProjection() prices them with league scoring
 * unchanged, and matched to Sleeper player ids by name + position (+ team
 * as a tiebreaker), since neither feed shares Sleeper's ids.
 */

/** One player's projection from an external feed, in Sleeper stat keys. */
export type ExternalProjection = {
  name: string;
  /** Sleeper-style position: QB/RB/WR/TE/K/DEF. */
  position: string;
  /** Sleeper team code (e.g. JAX, WAS); null when unknown / free agent. */
  team: string | null;
  /** Stat-level projection keyed like Sleeper scoring_settings. */
  stats: Record<string, number>;
  /**
   * Week-by-week projected points in the source's own scoring (index =
   * week - 1, zeros on byes). Null when the source has no weekly feed.
   */
  weekly: number[] | null;
};

export class SourceError extends Error {
  constructor(public source: string, message: string) {
    super(`${source}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Player matching
// ---------------------------------------------------------------------------

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase, punctuation-free name with Jr/III-style suffixes dropped. */
export function normalizeName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((t) => t && !NAME_SUFFIXES.has(t));
  return tokens.join(" ");
}

export type PlayerIndex = Map<string, { id: string; team: string | null }[]>;

/** Index of Sleeper players keyed by "normalized name|position". */
export function buildPlayerIndex(
  players: {
    id: string;
    firstName: string;
    lastName: string;
    position: string | null;
    team: string | null;
  }[]
): PlayerIndex {
  const index: PlayerIndex = new Map();
  for (const p of players) {
    if (!p.position) continue;
    const key = `${normalizeName(`${p.firstName} ${p.lastName}`)}|${p.position}`;
    const list = index.get(key) ?? [];
    list.push({ id: p.id, team: p.team });
    index.set(key, list);
  }
  return index;
}

/**
 * Resolve an external feed's player to a Sleeper id. Unique name+position
 * matches win outright; among duplicates the same NFL team decides, and an
 * ambiguous leftover is dropped rather than guessed.
 */
export function matchPlayerId(
  index: PlayerIndex,
  name: string,
  position: string,
  team: string | null
): string | null {
  const candidates = index.get(`${normalizeName(name)}|${position}`);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.id;
  if (team) {
    const sameTeam = candidates.filter((c) => c.team === team);
    if (sameTeam.length === 1) return sameTeam[0]!.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

const ESPN_POSITIONS: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

/** ESPN proTeamId -> Sleeper team code. */
const ESPN_PRO_TEAMS: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

type EspnStatEntry = {
  seasonId: number;
  scoringPeriodId: number;
  statSourceId: number;
  statSplitTypeId: number;
  stats: Record<string, number> | null;
  /** Points under ESPN's default scoring for this entry. */
  appliedTotal?: number;
};

type EspnPlayerEntry = {
  player: {
    id: number;
    fullName: string;
    defaultPositionId: number;
    proTeamId: number;
    stats?: EspnStatEntry[];
  };
};

/** Simple ESPN stat id -> Sleeper key mappings (1:1). */
const ESPN_STAT_MAP: Record<string, string> = {
  "3": "pass_yd",
  "4": "pass_td",
  "19": "pass_2pt",
  "20": "pass_int",
  "24": "rush_yd",
  "25": "rush_td",
  "26": "rush_2pt",
  "42": "rec_yd",
  "43": "rec_td",
  "44": "rec_2pt",
  "53": "rec",
  "68": "fum",
  "72": "fum_lost",
  // Kicking
  "77": "fgm_40_49",
  "85": "fgmiss",
  "86": "xpm",
  "88": "xpmiss",
  "198": "fgm_50_59",
  "201": "fgm_60p",
  // Defense / special teams
  "94": "def_td",
  "95": "int",
  "96": "fum_rec",
  "97": "blk_kick",
  "98": "safe",
  "99": "sack",
  "106": "ff",
  "89": "pts_allow_0",
  "90": "pts_allow_1_6",
  "91": "pts_allow_7_13",
  "122": "pts_allow_21_27",
  "123": "pts_allow_28_34",
};

/**
 * ESPN under-40 field goals (stat 80) are one bucket while Sleeper scores
 * 0-19/20-29/30-39 separately; split with a typical NFL distance mix.
 */
const ESPN_UNDER40_SPLIT: [string, number][] = [
  ["fgm_0_19", 0.05],
  ["fgm_20_29", 0.45],
  ["fgm_30_39", 0.5],
];

function convertEspnStats(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (key: string, amount: number | undefined) => {
    if (amount != null && amount !== 0) out[key] = (out[key] ?? 0) + amount;
  };
  for (const [espnId, sleeperKey] of Object.entries(ESPN_STAT_MAP)) {
    add(sleeperKey, raw[espnId]);
  }
  // Fall back to "50 plus" (74) when the 50-59 bucket is absent.
  if (raw["198"] == null) add("fgm_50_59", raw["74"]);
  for (const [key, share] of ESPN_UNDER40_SPLIT) {
    add(key, raw["80"] != null ? raw["80"] * share : undefined);
  }
  // D/ST kick/punt/blocked-kick return TDs all score as def_st_td.
  add("def_st_td", (raw["93"] ?? 0) + (raw["101"] ?? 0) + (raw["102"] ?? 0));
  // ESPN's 14-17 and 18-21 buckets approximate Sleeper's 14-20.
  add("pts_allow_14_20", (raw["92"] ?? 0) + (raw["121"] ?? 0));
  add("pts_allow_35p", (raw["124"] ?? 0) + (raw["125"] ?? 0));
  // Stat 210 is projected games played.
  if (raw["210"] != null) out.gp = raw["210"];
  return out;
}

/**
 * ESPN season projections: the public "league defaults" endpoint the ESPN
 * fantasy site itself uses, with a filter header to page all players in one
 * request. Only entries with a season-total projection (statSourceId 1,
 * splitType 0, scoringPeriod 0) are returned.
 */
export async function fetchEspnProjections(
  season: string
): Promise<ExternalProjection[]> {
  const seasonNum = Number(season);
  const filter = {
    players: {
      limit: 2000,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
    },
  };
  const res = await fetch(
    `${ESPN_BASE}/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`,
    {
      headers: {
        accept: "application/json",
        "x-fantasy-filter": JSON.stringify(filter),
      },
    }
  );
  if (!res.ok) {
    throw new SourceError("espn", `request failed (${res.status})`);
  }
  const body = (await res.json()) as { players?: EspnPlayerEntry[] };

  const out: ExternalProjection[] = [];
  for (const entry of body.players ?? []) {
    const player = entry.player;
    const position = ESPN_POSITIONS[player.defaultPositionId];
    if (!position) continue;
    const seasonProj = (player.stats ?? []).find(
      (s) =>
        s.statSourceId === 1 &&
        s.statSplitTypeId === 0 &&
        s.seasonId === seasonNum &&
        s.scoringPeriodId === 0 &&
        s.stats
    );
    if (!seasonProj?.stats) continue;

    // Weekly projections (splitType 1) give the season's shape: byes show
    // up as zero weeks and injured players as low early weeks.
    const weekly = new Array<number>(18).fill(0);
    let hasWeekly = false;
    for (const s of player.stats ?? []) {
      if (
        s.statSourceId !== 1 ||
        s.statSplitTypeId !== 1 ||
        s.seasonId !== seasonNum ||
        s.scoringPeriodId < 1 ||
        s.scoringPeriodId > 18
      ) {
        continue;
      }
      const total = s.appliedTotal ?? 0;
      weekly[s.scoringPeriodId - 1] = Math.round(total * 100) / 100;
      hasWeekly = true;
    }

    out.push({
      name: player.fullName,
      position,
      team: ESPN_PRO_TEAMS[player.proTeamId] ?? null,
      stats: convertEspnStats(seasonProj.stats),
      weekly: hasWeekly ? weekly : null,
    });
  }
  return out;
}

/** NFL bye weeks by Sleeper team code, from ESPN's pro team schedules. */
export async function fetchEspnByeWeeks(
  season: string
): Promise<Record<string, number>> {
  const res = await fetch(
    `${ESPN_BASE}/seasons/${season}?view=proTeamSchedules_wl`,
    { headers: { accept: "application/json" } }
  );
  if (!res.ok) {
    throw new SourceError("espn", `bye week request failed (${res.status})`);
  }
  const body = (await res.json()) as {
    settings?: { proTeams?: { id: number; byeWeek?: number }[] };
  };
  const out: Record<string, number> = {};
  for (const team of body.settings?.proTeams ?? []) {
    const code = ESPN_PRO_TEAMS[team.id];
    if (code && team.byeWeek && team.byeWeek > 0) out[code] = team.byeWeek;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FantasySharks
// ---------------------------------------------------------------------------

const SHARKS_URL =
  "https://www.fantasysharks.com/apps/Projections/SeasonCSVProjections.php?pos=ALL&l=2&format=csv";

const SHARKS_POSITIONS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  PK: "K",
  Def: "DEF",
};

/** FantasySharks team code -> Sleeper team code (only the ones that differ). */
const SHARKS_TEAMS: Record<string, string> = {
  GBP: "GB",
  JAC: "JAX",
  KCC: "KC",
  LVR: "LV",
  NEP: "NE",
  NOS: "NO",
  SFO: "SF",
  TBB: "TB",
};

/**
 * FantasySharks FG columns are shifted bucket labels: FG20/FG30/FG40/FG50
 * hold makes from 0-19/20-29/30-39/40-49 and "FG50+" holds 50+ (verified
 * against known kicker profiles).
 */
const SHARKS_STAT_COLUMNS: Record<string, string> = {
  PassYards: "pass_yd",
  PassTDTotal: "pass_td",
  PassInt: "pass_int",
  RushYards: "rush_yd",
  RushTDTotal: "rush_td",
  Fumbles: "fum_lost",
  Receptions: "rec",
  RecYards: "rec_yd",
  RecTDTotal: "rec_td",
  FG20: "fgm_0_19",
  FG30: "fgm_20_29",
  FG40: "fgm_30_39",
  FG50: "fgm_40_49",
  "FG50+": "fgm_50_59",
  FGMiss: "fgmiss",
  XP: "xpm",
  D_TD: "def_td",
  D_Sack: "sack",
  D_Ints: "int",
  D_Fumble: "fum_rec",
};

/** Weekly points-allowed averages mapped onto Sleeper's bucket keys. */
const PTS_ALLOW_BUCKETS: [max: number, key: string][] = [
  [0, "pts_allow_0"],
  [6, "pts_allow_1_6"],
  [13, "pts_allow_7_13"],
  [20, "pts_allow_14_20"],
  [27, "pts_allow_21_27"],
  [34, "pts_allow_28_34"],
  [Infinity, "pts_allow_35p"],
];

/**
 * FantasySharks season projections from their public CSV export. The feed
 * is always the current season. Defense points allowed arrive as a season
 * total, so it's converted to a per-game average and all 17 games are
 * booked in that average's Sleeper bucket — a rough but centered estimate.
 */
export async function fetchSharksProjections(): Promise<ExternalProjection[]> {
  const res = await fetch(SHARKS_URL, {
    headers: { "user-agent": "Mozilla/5.0 (thrawn projections sync)" },
  });
  if (!res.ok) {
    throw new SourceError("sharks", `request failed (${res.status})`);
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new SourceError("sharks", "empty CSV");

  const header = lines[0]!.split(",").map((h) => h.replace(/"/g, "").trim());
  const col = new Map(header.map((h, i) => [h, i]));
  const required = ["Pos", "LastName", "FirstName", "Team"];
  for (const name of required) {
    if (!col.has(name)) throw new SourceError("sharks", `missing column ${name}`);
  }

  const out: ExternalProjection[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.replace(/"/g, "").trim());
    const cell = (name: string) => cells[col.get(name)!] ?? "";
    const position = SHARKS_POSITIONS[cell("Pos")];
    if (!position) continue;

    const rawTeam = cell("Team");
    const team =
      rawTeam && rawTeam !== "FA" ? SHARKS_TEAMS[rawTeam] ?? rawTeam : null;

    const stats: Record<string, number> = {};
    for (const [column, key] of Object.entries(SHARKS_STAT_COLUMNS)) {
      const value = Number(cell(column));
      if (Number.isFinite(value) && value !== 0) stats[key] = value;
    }
    const ptsAllow = Number(cell("D_PtsAllow"));
    if (position === "DEF" && Number.isFinite(ptsAllow) && ptsAllow > 0) {
      const perGame = ptsAllow / 17;
      const bucket = PTS_ALLOW_BUCKETS.find(([max]) => perGame <= max)!;
      stats[bucket[1]] = 17;
    }

    out.push({
      name: `${cell("FirstName")} ${cell("LastName")}`.trim(),
      position,
      team,
      stats,
      weekly: null,
    });
  }
  return out;
}
