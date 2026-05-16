import { config as loadDotenv } from "dotenv";
import { z } from "zod";

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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
