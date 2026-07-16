import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { BROWSER_TASK_QUEUE, DEFAULT_TASK_QUEUE } from "./temporal/constants.js";

// `override: true` makes .env the source of truth for local dev: editing
// .env always wins, even if the developer's shell happens to have a
// conflicting var (e.g. AWS_PROFILE) inherited from another project. In
// production there is no .env file so this is a no-op and the ECS task
// definition's environment / secrets are still authoritative.
loadDotenv({ override: true });

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    ),
  // S3 bucket holding user-attached images (e.g. expense receipts). The
  // backend mints short-lived presigned URLs against this bucket; bytes
  // never traverse the API. See infra/terraform/modules/backend-api.
  AWS_REGION: z.string().min(1).default("us-west-2"),
  S3_BUCKET: z.string().min(1).optional(),
  // Optional override for the S3 endpoint (e.g. LocalStack / Minio in
  // dev). Leave unset to use the standard AWS regional endpoint.
  S3_ENDPOINT: z.string().url().optional(),

  // --- Marketplace deal-finder ----------------------------------------
  // Shared bearer token the browser-box scraper agent uses to authenticate
  // to the /agent/* endpoints. When unset, those endpoints return 503.
  AGENT_TOKEN: z.string().min(1).optional(),

  // All LLM traffic goes through OpenRouter (OpenAI-compatible API) so any
  // model can be swapped in for evaluation. When `OPENROUTER_API_KEY` is
  // unset, LLM-backed features return 503. Model names are OpenRouter slugs
  // (e.g. "openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"). The two tiers
  // keep cheap triage separate from expensive deep evaluation; either can be
  // overridden per request to compare models.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // Optional attribution headers OpenRouter uses for app ranking.
  OPENROUTER_SITE_URL: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().min(1).default("Seneschal"),
  LLM_TRIAGE_MODEL: z.string().min(1).default("openai/gpt-5.6-sol"),
  LLM_ADVANCED_MODEL: z.string().min(1).default("openai/gpt-5.6-terra"),

  // eBay Browse API (client-credentials) for price comps.
  EBAY_CLIENT_ID: z.string().min(1).optional(),
  EBAY_CLIENT_SECRET: z.string().min(1).optional(),
  EBAY_ENV: z.enum(["production", "sandbox"]).default("production"),

  // Craigslist has no API; we parse the no-JS HTML search page (the old RSS
  // feed now 403s). Set to your local site slug (e.g. "boise", "seattle") to
  // enable; unset skips it.
  CRAIGSLIST_SITE: z.string().min(1).optional(),

  // --- Temporal ---------------------------------------------------------
  // The deal-hunter pipeline runs as a Temporal workflow. Server-side work
  // (Craigslist fetch, LLM calls, DB writes) runs on TEMPORAL_TASK_QUEUE;
  // Facebook load-and-parse runs on TEMPORAL_BROWSER_TASK_QUEUE, serviced by
  // a worker on the browser box that has the logged-in Chrome over CDP.
  TEMPORAL_ADDRESS: z.string().min(1).default("127.0.0.1:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default(DEFAULT_TASK_QUEUE),
  TEMPORAL_BROWSER_TASK_QUEUE: z.string().min(1).default(BROWSER_TASK_QUEUE),
  // How often each active target auto-hunts (minutes). The backend worker
  // registers one Temporal Schedule per active target on boot.
  TEMPORAL_HUNT_INTERVAL_MIN: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
