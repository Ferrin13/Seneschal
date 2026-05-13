# Seneschal API

Fastify + TypeScript REST API for the Seneschal time-tracking app, backed by
Postgres and gated by Firebase Auth ID tokens.

## Layout

```
src/
  config.ts             env-driven config (zod-validated)
  index.ts              fastify bootstrap
  auth/
    firebase.ts         firebase-admin app
    middleware.ts       verifies Bearer tokens, lazy-creates users + seeds
  db/
    schema.ts           drizzle schema (Postgres)
    client.ts           pg pool + drizzle instance
    seed.ts             per-user category/activity seed (the spec list)
    migrate.ts          runs migrations on boot
  routes/
    me.ts               /me
    categories.ts       /categories CRUD
    activities.ts       /activities CRUD
    slots.ts            /slots range read + bulk LWW upsert
    timer.ts            /timer start/stop with slot-midpoint rounding
  util/time.ts          15-minute slot helpers
infra/                  AWS CDK stack (VPC + RDS + ECS Fargate + ALB)
Dockerfile              distroless multi-stage build
```

## Local development

1. `cp .env.example .env` and fill in `FIREBASE_PROJECT_ID` plus point
   `GOOGLE_APPLICATION_CREDENTIALS` at a downloaded service-account JSON.
2. Start a local Postgres (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).
3. `npm install`
4. `npm run db:generate` (regenerate migrations from schema; commit them)
5. `npm run db:migrate`
6. `npm run dev`

## Deploying

The CDK stack in `infra/` provisions VPC + RDS + ECS Fargate + ALB.

1. Upload your Firebase service-account JSON to SSM:
   `aws ssm put-parameter --name /seneschal/dev/firebase-service-account --type SecureString --value file://service-account.json`
2. From `infra/`: `npm install && npm run synth && npm run deploy`.
3. Run migrations against the new RDS instance (one-off task or run from a
   bastion). Easiest: temporarily expose the DB SG to your IP and run
   `DATABASE_URL=... npm run db:migrate` from your laptop.

> Note: the `DATABASE_URL` env in the CDK stack is currently fed from the
> generated RDS secret's `url` field, which AWS doesn't populate by
> default. In practice you'll either (a) compose the URL from
> host/username/password fields in the entrypoint, or (b) add a small
> Lambda-backed custom resource to write a composed URL into Secrets
> Manager. See `infra/lib/seneschal-stack.ts` TODO.
