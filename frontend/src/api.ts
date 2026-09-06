import { auth } from "./firebase";
import type {
  CreatePlayerInput,
  Faction,
  GameSnapshot,
  LazaxGame,
  LazaxStats,
  StrategyCard,
} from "./lazax/types";
import type { DescartesChangeSet, DescartesGraph } from "./descartes/types";
import type { Feature } from "./features";
import type {
  LeagueAnalysis,
  LeagueValues,
  PlayerDetailReport,
  ProjectionSource,
  RegressionReport,
  SeasonBoard,
  ThrawnLeague,
} from "./thrawn/types";
import type { Board, PlayerDetail } from "./moneyball/types";
import type { Scores as MoneyballScores, Weights as MoneyballWeights } from "./moneyball/stats";

export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:18080"
).replace(/\/$/, "");

export function apiWsBaseUrl(): string {
  if (API_BASE_URL.startsWith("https://")) {
    return `wss://${API_BASE_URL.slice("https://".length)}`;
  }
  if (API_BASE_URL.startsWith("http://")) {
    return `ws://${API_BASE_URL.slice("http://".length)}`;
  }
  return API_BASE_URL;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "not signed in");
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      // Only claim a JSON body when one is actually sent. Setting this header
      // on bodyless POSTs makes Fastify reject with FST_ERR_CTP_EMPTY_JSON_BODY.
      ...(init.body != null ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type Me = {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  /** Unlocks the Admin tab and /admin/* endpoints. Independent of features. */
  isAdmin: boolean;
  /** Products this account may use; drives which tabs render. */
  features: Feature[];
};

/** One row on the admin page: an email that may sign in and what it unlocks. */
export type AdminUser = {
  email: string;
  isAdmin: boolean;
  features: Feature[];
  /** From BOOTSTRAP_ADMIN_EMAILS on the server: always admin, can't be removed. */
  bootstrap: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present once the person has signed in at least once. */
  user: { id: string; displayName: string | null; firstSignInAt: string } | null;
};

export type Category = {
  id: string;
  name: string;
  kind: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export type Activity = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export type Slot = {
  slotStartUtc: string;
  primaryActivityId: string | null;
  secondaryActivityId: string | null;
  notes: string | null;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export type SearchTarget = {
  id: string;
  title: string;
  prompt: string;
  evalInstructions: string | null;
  /** Whether the recurring hunt schedule is running (false = paused). */
  isActive: boolean;
  /** Effective auto-hunt cadence in minutes. */
  huntIntervalMin: number;
  createdAt: string;
  updatedAt: string;
};

export type HuntRunStatus = "running" | "completed" | "failed";

/** One execution of a target's hunt pipeline, from mp_hunt_runs. */
export type HuntRun = {
  id: string;
  status: HuntRunStatus;
  searches: number;
  discovered: number;
  triaged: number;
  promising: number;
  evaluated: number;
  errors: number;
  costUsd: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SearchFilters = {
  minPriceCents?: number;
  maxPriceCents?: number;
  category?: string;
  radiusMiles?: number;
  condition?: string[];
};

export type Platform = "facebook" | "craigslist";

export type Search = {
  id: string;
  targetId: string;
  platform: Platform;
  query: string;
  filters: SearchFilters | null;
  searchUrl: string | null;
  source: "llm" | "user";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Verdict = "good_deal" | "pass" | "unsure" | null;

export type Evaluation = {
  id: string;
  tier: "triage" | "advanced";
  verdict: Verdict;
  /** Deal quality (price vs. market), 0-100. */
  valueScore: number | null;
  /** Match to the user's target + rules, 0-100. */
  fitScore: number | null;
  confidence: number | null;
  estimatedValueCents: number | null;
  rationale: string | null;
  model: string | null;
  createdAt: string;
};

export type CandidateStatus = "active" | "sold" | "disappeared";

/** The user's manual disposition of a deal. */
export type Disposition =
  | "none"
  | "not_a_fit"
  | "not_a_good_deal"
  | "keep_watching"
  | "reached_out"
  | "sold";

/** A promise-ranked candidate card from GET /marketplace/candidates. */
export type Candidate = {
  id: string;
  searchId: string | null;
  platform: Platform;
  externalId: string | null;
  listingUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  priceCents: number | null;
  blurb: string | null;
  triageStatus: "pending" | "promising" | "rejected" | "skipped";
  triageScore: number | null;
  triageReason: string | null;
  promiseScore: number | null;
  status: CandidateStatus;
  disposition: Disposition;
  dispositionNote: string | null;
  dispositionAt: string | null;
  sourceListedAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  listingId: string | null;
  compsCount: number;
  evaluation: Evaluation | null;
};

export type Listing = {
  id: string;
  platform: Platform;
  externalId: string | null;
  url: string;
  title: string | null;
  description: string | null;
  priceCents: number | null;
  currency: string | null;
  conditionLabel: string | null;
  locationText: string | null;
  sellerName: string | null;
  isSold: boolean | null;
  listedAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  disappearedAt: string | null;
  scrapeStatus: string;
  scrapedAt: string | null;
  images: { id: string; url: string | null; sortOrder: number }[];
};

export type Comp = {
  id: string;
  source: "ebay" | "craigslist" | "internal" | "web";
  condition: "new" | "used" | null;
  matchedTitle: string | null;
  priceCents: number | null;
  currency: string | null;
  url: string | null;
  soldAt: string | null;
};

export type CandidateEvent = {
  id: string;
  stage:
    | "discovered"
    | "triaged"
    | "deep_scraped"
    | "comps_gathered"
    | "evaluated"
    | "sold"
    | "disappeared"
    | "error";
  message: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

/** A user's 1-10 accuracy feedback on a candidate's fit and deal scores. */
export type EvaluationRating = {
  id: string;
  candidateId: string;
  evaluationId: string | null;
  /** How accurate the fit score was, 1-10. */
  fitAccuracy: number | null;
  fitNote: string | null;
  /** How accurate the deal (value) score was, 1-10. */
  valueAccuracy: number | null;
  valueNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvaluationRatingInput = {
  fitAccuracy?: number | null;
  fitNote?: string | null;
  valueAccuracy?: number | null;
  valueNote?: string | null;
};

export type CandidateDetail = {
  candidate: Candidate;
  listing: Listing | null;
  comps: Comp[];
  evaluations: Evaluation[];
  events: CandidateEvent[];
  rating: EvaluationRating | null;
};

export type DealNotification = {
  id: string;
  listingId: string | null;
  kind: string;
  title: string | null;
  body: string | null;
  status: "new" | "seen" | "actioned" | "dismissed";
  createdAt: string;
};

export type ModelStepConfig = {
  step: string;
  label: string;
  description: string;
  default: string;
  model: string | null;
};

export type ModelSettings = { steps: ModelStepConfig[] };

/** Browser-notification preferences: which deals raise a notification. */
export type NotificationPrefs = {
  /** Master switch for showing browser (OS) notifications. */
  enabled: boolean;
  /** Minimum combined deal score, 0-100. */
  minDealScore: number;
  /** Minimum value score (price vs. market), 0-100. */
  minValueScore: number;
  /** Only notify for deals at or under this price (cents); null = no cap. */
  maxPriceCents: number | null;
  /** Targets to notify for; null or empty = every target. */
  targetIds: string[] | null;
};

export type LlmUsage = {
  totalCalls: number;
  totalCostUsd: number;
  totalTokens: number;
  byModel: {
    model: string;
    calls: number;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
  }[];
  byPurpose: {
    purpose: string;
    calls: number;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
  }[];
  daily: {
    date: string;
    costUsd: number;
    calls: number;
    tokens: number;
  }[];
  hourly: {
    date: string;
    costUsd: number;
    calls: number;
    tokens: number;
  }[];
  recent: {
    id: string;
    purpose: string;
    model: string;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
    createdAt: string;
  }[];
};

/** Scripture passage returned by the backend for licensed translations. */
export type ServerPassage = {
  reference: string;
  text: string;
  translation: "esv";
};

export const api = {
  me: () => authedFetch("/me") as Promise<Me>,

  // --- Admin (user access) ----------------------------------------------------
  adminUsers: () =>
    authedFetch("/admin/users") as Promise<{ users: AdminUser[] }>,
  adminCreateUser: (input: {
    email: string;
    isAdmin: boolean;
    features: Feature[];
  }) =>
    authedFetch("/admin/users", {
      method: "POST",
      body: JSON.stringify(input),
    }) as Promise<AdminUser>,
  adminUpdateUser: (
    email: string,
    patch: { isAdmin?: boolean; features?: Feature[] }
  ) =>
    authedFetch(`/admin/users/${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }) as Promise<AdminUser>,
  adminDeleteUser: (email: string) =>
    authedFetch(`/admin/users/${encodeURIComponent(email)}`, {
      method: "DELETE",
    }) as Promise<null>,

  // --- Descartes (belief graph) -----------------------------------------------
  bibleTranslations: () =>
    authedFetch("/bible/translations") as Promise<{ translations: string[] }>,
  biblePassage: (q: string, translation: "esv") =>
    authedFetch(
      `/bible/passage?q=${encodeURIComponent(q)}&translation=${translation}`
    ) as Promise<ServerPassage>,
  descartesGraph: () =>
    authedFetch("/descartes/graph") as Promise<DescartesGraph>,
  /** Apply a batch of edits atomically. `keepalive` lets a final flush outlive the page. */
  descartesApplyChanges: (changes: DescartesChangeSet, opts?: { keepalive?: boolean }) =>
    authedFetch("/descartes/graph/changes", {
      method: "POST",
      body: JSON.stringify(changes),
      ...(opts?.keepalive ? { keepalive: true } : {}),
    }) as Promise<{ ok: true; appliedAt: string }>,
  descartesReplaceGraph: (graph: DescartesGraph) =>
    authedFetch("/descartes/graph", {
      method: "PUT",
      body: JSON.stringify(graph),
    }) as Promise<DescartesGraph>,
  categories: () => authedFetch("/categories") as Promise<Category[]>,
  activities: () => authedFetch("/activities") as Promise<Activity[]>,
  slots: (fromIso: string, toIso: string) =>
    authedFetch(
      `/slots?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
    ) as Promise<Slot[]>,

  // --- Marketplace deal-finder ---
  targets: () =>
    authedFetch("/marketplace/targets") as Promise<SearchTarget[]>,
  createTarget: (body: {
    title: string;
    prompt: string;
    evalInstructions?: string | null;
    huntIntervalMin?: number | null;
  }) =>
    authedFetch("/marketplace/targets", {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<SearchTarget>,
  updateTarget: (
    id: string,
    body: Partial<{
      title: string;
      prompt: string;
      evalInstructions: string | null;
      isActive: boolean;
      huntIntervalMin: number | null;
    }>
  ) =>
    authedFetch(`/marketplace/targets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<SearchTarget>,
  deleteTarget: (id: string) =>
    authedFetch(`/marketplace/targets/${id}`, {
      method: "DELETE",
    }) as Promise<{ ok: true }>,
  targetSearches: (id: string) =>
    authedFetch(`/marketplace/targets/${id}/searches`) as Promise<Search[]>,
  targetRuns: (id: string, limit?: number) =>
    authedFetch(
      `/marketplace/targets/${id}/runs${limit ? `?limit=${limit}` : ""}`
    ) as Promise<HuntRun[]>,
  expandTarget: (id: string) =>
    authedFetch(`/marketplace/targets/${id}/expand`, {
      method: "POST",
    }) as Promise<Search[]>,
  hunt: (id: string, model?: string) =>
    authedFetch(`/marketplace/targets/${id}/hunt`, {
      method: "POST",
      body: JSON.stringify(model ? { model } : {}),
    }) as Promise<{
      started: boolean;
      workflowId: string;
      runId?: string;
      error?: string;
    }>,
  searches: () => authedFetch("/marketplace/searches") as Promise<Search[]>,
  createSearch: (body: {
    targetId: string;
    platform: Platform;
    query: string;
    filters?: SearchFilters;
  }) =>
    authedFetch("/marketplace/searches", {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<Search>,
  updateSearch: (
    id: string,
    body: Partial<{
      query: string;
      filters: SearchFilters;
      isActive: boolean;
    }>
  ) =>
    authedFetch(`/marketplace/searches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<Search>,
  deleteSearch: (id: string) =>
    authedFetch(`/marketplace/searches/${id}`, {
      method: "DELETE",
    }) as Promise<{ ok: true }>,
  candidates: (status?: CandidateStatus) =>
    authedFetch(
      `/marketplace/candidates${status ? `?status=${status}` : ""}`
    ) as Promise<Candidate[]>,
  candidateDetail: (id: string) =>
    authedFetch(`/marketplace/candidates/${id}`) as Promise<CandidateDetail>,
  rateCandidate: (id: string, body: EvaluationRatingInput) =>
    authedFetch(`/marketplace/candidates/${id}/rating`, {
      method: "PUT",
      body: JSON.stringify(body),
    }) as Promise<EvaluationRating>,
  setDisposition: (
    id: string,
    body: { disposition: Disposition; note?: string | null }
  ) =>
    authedFetch(`/marketplace/candidates/${id}/disposition`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<Candidate>,
  listings: () => authedFetch("/marketplace/listings") as Promise<Listing[]>,
  triage: (model?: string) =>
    authedFetch("/marketplace/triage", {
      method: "POST",
      body: JSON.stringify(model ? { model } : {}),
    }) as Promise<{
      evaluated: number;
      promising: number;
      rejected: number;
      errors: number;
    }>,
  gatherComps: () =>
    authedFetch("/marketplace/comps", {
      method: "POST",
      body: JSON.stringify({}),
    }) as Promise<{
      listings: number;
      comps: number;
      errors: number;
    }>,
  evaluate: (model?: string) =>
    authedFetch("/marketplace/evaluate", {
      method: "POST",
      body: JSON.stringify(model ? { model } : {}),
    }) as Promise<{
      evaluated: number;
      goodDeals: number;
      errors: number;
    }>,
  llmUsage: () =>
    authedFetch("/marketplace/llm-usage") as Promise<LlmUsage>,
  modelSettings: () =>
    authedFetch("/settings/models") as Promise<ModelSettings>,
  updateModelSettings: (overrides: Record<string, string | null>) =>
    authedFetch("/settings/models", {
      method: "PUT",
      body: JSON.stringify({ overrides }),
    }) as Promise<ModelSettings>,
  notificationSettings: () =>
    authedFetch("/settings/notifications") as Promise<NotificationPrefs>,
  updateNotificationSettings: (prefs: NotificationPrefs) =>
    authedFetch("/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(prefs),
    }) as Promise<NotificationPrefs>,
  notifications: () =>
    authedFetch("/marketplace/notifications") as Promise<DealNotification[]>,
  updateNotification: (id: string, status: DealNotification["status"]) =>
    authedFetch(`/marketplace/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }) as Promise<DealNotification>,

  // --- Lazax ---------------------------------------------------------------
  lazaxFactions: () =>
    authedFetch("/lazax/factions") as Promise<{
      factions: Faction[];
      strategyCards: StrategyCard[];
    }>,
  lazaxGames: () => authedFetch("/lazax/games") as Promise<LazaxGame[]>,
  lazaxGame: (id: string) =>
    authedFetch(`/lazax/games/${id}`) as Promise<GameSnapshot>,
  lazaxStats: (id: string) =>
    authedFetch(`/lazax/games/${id}/stats`) as Promise<LazaxStats>,
  lazaxCreateGame: (body: {
    name?: string;
    players: CreatePlayerInput[];
    speakerSeatIndex: number;
  }) =>
    authedFetch("/lazax/games", {
      method: "POST",
      body: JSON.stringify(body),
    }) as Promise<GameSnapshot>,
  lazaxPost: (id: string, action: string, body?: unknown) =>
    authedFetch(`/lazax/games/${id}/${action}`, {
      method: "POST",
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    }) as Promise<GameSnapshot>,

  // --- Thrawn ----------------------------------------------------------------
  thrawnLeagues: () =>
    authedFetch("/thrawn/leagues") as Promise<ThrawnLeague[]>,
  thrawnCreateLeague: (sleeperLeagueId: string) =>
    authedFetch("/thrawn/leagues", {
      method: "POST",
      body: JSON.stringify({ sleeperLeagueId }),
    }) as Promise<ThrawnLeague>,
  thrawnSyncLeague: (id: string) =>
    authedFetch(`/thrawn/leagues/${id}/sync`, {
      method: "POST",
    }) as Promise<ThrawnLeague>,
  thrawnUpdateLeague: (
    id: string,
    body: { myRosterId?: number | null; projectionSource?: ProjectionSource }
  ) =>
    authedFetch(`/thrawn/leagues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<ThrawnLeague>,
  thrawnDeleteLeague: (id: string) =>
    authedFetch(`/thrawn/leagues/${id}`, {
      method: "DELETE",
    }) as Promise<{ ok: true }>,
  thrawnLeagueValues: (id: string) =>
    authedFetch(`/thrawn/leagues/${id}/values`) as Promise<LeagueValues>,
  thrawnLeagueAnalysis: (id: string) =>
    authedFetch(`/thrawn/leagues/${id}/analysis`) as Promise<LeagueAnalysis>,
  thrawnLeagueSeasonBoard: (id: string, season: string) =>
    authedFetch(`/thrawn/leagues/${id}/history/${season}`) as Promise<SeasonBoard>,
  thrawnLeagueRegression: (id: string, season?: string) =>
    authedFetch(
      `/thrawn/leagues/${id}/regression${season ? `?season=${season}` : ""}`
    ) as Promise<RegressionReport>,
  thrawnPlayerDetail: (leagueId: string, playerId: string) =>
    authedFetch(
      `/thrawn/leagues/${leagueId}/players/${playerId}/detail`
    ) as Promise<PlayerDetailReport>,
  thrawnSetOverride: (
    leagueId: string,
    playerId: string,
    body: { points: number | null; note?: string | null }
  ) =>
    authedFetch(`/thrawn/leagues/${leagueId}/overrides/${playerId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }) as Promise<unknown>,

  // --- Moneyball -------------------------------------------------------------
  moneyballBoard: () => authedFetch("/moneyball/board") as Promise<Board>,
  moneyballPlayer: (id: string) =>
    authedFetch(`/moneyball/players/${id}`) as Promise<PlayerDetail>,
  moneyballSetRating: (id: string, scores: MoneyballScores) =>
    authedFetch(`/moneyball/players/${id}/rating`, {
      method: "PUT",
      body: JSON.stringify({ scores }),
    }) as Promise<PlayerDetail>,
  moneyballClearRating: (id: string) =>
    authedFetch(`/moneyball/players/${id}/rating`, {
      method: "DELETE",
    }) as Promise<null>,
  moneyballSetWeights: (weights: MoneyballWeights) =>
    authedFetch("/moneyball/weights", {
      method: "PUT",
      body: JSON.stringify({ weights }),
    }) as Promise<{ weights: MoneyballWeights }>,
};
