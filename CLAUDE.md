# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Seneschal is a personal-assistant platform: one Fastify backend serving several loosely-related "products" behind a shared Firebase-auth identity, plus an Android app, a React web UI, a browser-automation worker, and Terraform infra. The products:

- **Time tracking** (the original feature): the day is 96 fifteen-minute slots; Android is the primary client (offline-first), the web UI is read-only. Timer stop fills every slot whose midpoint falls inside the interval.
- **Deal hunter / marketplace**: Facebook Marketplace + Craigslist listing harvest → LLM triage → comps → deep evaluation, orchestrated by Temporal workflows (`backend/src/temporal/`, `backend/src/marketplace/`). The Facebook side runs on a separate "browser box" worker (`agent/`) that drives a logged-in Chrome over CDP on its own Temporal task queue.
- **Lazax**: Twilight Imperium game tracker (`backend/src/lazax/`, `frontend/src/lazax/`) with a live WebSocket hub (`routes/lazaxWs.ts`). Known v1 issues live in `docs/LAZAX.md`.
- **Thrawn**: fantasy football analyzer over Sleeper data (`backend/src/thrawn/`, `frontend/src/thrawn/`). Valuation is Points Above Replacement per game with a simulated fringe-bench replacement baseline — read the header comment in `backend/src/thrawn/engine.ts`.
- **Voice**: `POST /voice/command` runs an LLM function-calling loop over a hybrid tool catalog — server tools execute inline, client tools are returned to the phone which executes them against its offline repositories and re-posts to continue the stateless conversation (`backend/src/routes/voice.ts`, `backend/src/tools/`, `android-app/.../voice/`).

## Commands

### Backend (`backend/`)
- `npm run dev` — tsx watch, serves on port 18080 locally
- `npm run lint` — `tsc --noEmit` (no ESLint anywhere in the repo)
- `npm test` — `vitest run`; single file: `npx vitest run test/thrawn-engine.test.ts`
- `npm run db:generate` — snapshot Drizzle migrations from `src/db/schema.ts` (commit the output in `migrations/`)
- `npm run db:migrate` — apply against `DATABASE_URL`
- `npm run worker` — Temporal worker (deal-hunter queue), tsx watch
- Setup: `cp .env.example .env`, fill `FIREBASE_PROJECT_ID` + service-account path; local Postgres via docker

### Frontend (`frontend/`)
- `npm run dev` — Vite on http://localhost:15173 (backend `CORS_ORIGINS` must include this origin)
- `npm run build` — `tsc -b` then Vite build
- `npm run lint` — `tsc --noEmit`

### Android (`android-app/`)
- Open the `android-app/` folder in Android Studio; config comes from git-ignored `local.properties` (`seneschal.apiBaseUrl`, `seneschal.googleWebClientId`) plus `google-services.json`
- `.\gradlew.bat assembleDebug` / `.\gradlew.bat test` from `android-app/` (this machine is Windows)
- Emulator reaches the local API at `http://10.0.2.2:18080/`

### Agent (`agent/`)
- `npm run dev` / `npm run build` / `npm run lint` — Temporal worker for the browser task queue

### Infra
- `infra/terraform/` — AWS (ECS Fargate backend + worker, S3/CloudFront frontend, self-hosted Temporal, CodePipeline CI/CD). See `infra/terraform/README.md` and `DEPLOY.md`. Deploys are pipeline-driven off pushes to master via `buildspec*.yml` in `backend/` and `frontend/`.
- `infra/temporal/docker-compose.yml` — local Temporal cluster

## Architecture notes

- **Engine/service split**: game/valuation logic lives in pure, I/O-free "engine" modules (`lazax/engine.ts`, `thrawn/engine.ts`, `tools/loop.ts`) with a service layer around them doing DB/network. All vitest coverage in `backend/test/` targets these pure modules — keep new logic testable the same way (dependencies like the LLM chat function are injected).
- **LLM gateway** (`backend/src/llm/index.ts`): every model call in the app — completions, function-calling chat, STT — goes through this module. Transport is OpenRouter (any model by slug), two tiers (`triage` cheap / `advanced` expensive), and a **required** usage context so every call is cost-accounted to `mp_llm_calls`. Never call a model provider directly from feature code.
- **Server tool packs** (`backend/src/tools/registry.ts`): backend features expose voice-callable tools by contributing a pack to the registry (marketplace is the existing example); they merge with whatever client tools the phone advertises per request.
- **Auth**: every route sits behind `auth/middleware.ts`, which verifies Firebase Bearer ID tokens and lazy-creates users (seeding their category/activity list on first sign-in).
- **Android sync**: Room is the source of truth; UI reads Room flows only. Writes go to Room and enqueue an outbox mutation; `SyncWorker` (WorkManager) pushes/pulls per entity via `Puller`/`OutboxHandler` implementations in `android-app/.../sync/`. Conflict resolution is last-write-wins by client timestamp on the server. New synced entities need a puller + outbox handler pair.
- **Schema changes**: edit `backend/src/db/schema.ts`, run `db:generate`, commit the generated migration, run `db:migrate`. Migrations also run in the deploy pipeline.
- **Config** is zod-validated in `backend/src/config.ts`; add new env vars there and to `.env.example`.
- **Temporal**: workflows in `workflows.ts` proxy three activity groups — default-queue server activities, slow LLM/comps activities, and browser-box activities on `BROWSER_TASK_QUEUE` (implemented in `agent/`, which is deliberately thin: load-and-parse only, no decisions).
- `docs/personal-data-lake.md` is a design doc for a future feature (not yet implemented).
