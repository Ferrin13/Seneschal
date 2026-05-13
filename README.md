# Seneschal

A personal-assistant Android app. The first feature is **time tracking**:
the day is divided into 96 fifteen-minute slots; each slot gets a primary
activity (and an optional secondary, for things like "driving + audiobook")
and optional notes.

## Repo layout

```
android-app/         Android app (Kotlin, Jetpack Compose, Material 3)
android-app/app/     The Android module itself
backend/             TypeScript REST API (Fastify + Drizzle)
backend/infra/       AWS CDK stack (VPC, RDS Postgres, ECS Fargate, ALB)
```

## Architecture

```
       Android (Compose + Room)            ECS Fargate (Fastify TS)        AWS
   ┌──────────────────────────┐         ┌────────────────────────┐    ┌──────────┐
   │ UI (Compose)             │         │ /me                    │    │          │
   │  ↑                       │         │ /categories            │    │          │
   │ Repositories ── Outbox ─→│ HTTPS  │ /activities            │ ─→ │ RDS      │
   │  ↑          (WorkManager)│ Bearer │ /slots                 │    │ Postgres │
   │ Room (source of truth)   │ ID tok │ /timer                 │    │ db.t4g.  │
   │  ↑                       │         │ Firebase admin auth    │    │ micro    │
   │ SyncWorker (pull/push)   │         │ Drizzle migrations     │    │          │
   └──────────────────────────┘         └────────────────────────┘    └──────────┘
              ↑
   Firebase Google Sign-In
```

- All UI reads come from Room flows; writes go to Room first and enqueue
  a pending mutation for the SyncWorker. The app stays useful offline.
- Last-write-wins by client timestamp on the server.
- The timer, when stopped, fills every 15-minute slot whose midpoint sits
  inside `[startedAt, stoppedAt]`. Edge slots <50% covered are left alone.

## Local setup

### Backend

```
cd backend
cp .env.example .env             # fill in FIREBASE_PROJECT_ID + service account
npm install
npm run db:generate              # snapshot Drizzle migrations from schema
npm run db:migrate               # apply against the URL in DATABASE_URL
npm run dev
```

### Android

1. Create a Firebase project, add an Android app with applicationId
   `com.parthadae.seneschal`, enable Google sign-in, and download
   `google-services.json` into `android-app/app/`.
2. In `android-app/local.properties` (which is git-ignored) add:
   ```
   seneschal.apiBaseUrl=http://10.0.2.2:8080/
   seneschal.googleWebClientId=<the Web client ID from your Firebase console>
   ```
3. Uncomment `alias(libs.plugins.google.services)` in
   [android-app/app/build.gradle.kts](android-app/app/build.gradle.kts).
4. Open the `android-app/` folder in Android Studio and run on an emulator (API 30+).

`http://10.0.2.2:8080/` is the standard emulator → host mapping; use your
deployed API URL on a real device.

## Adding a new activity / category

The seed list ships your seven categories (Good Usages of Time → Specifically
Spiritual) on first sign-in. Use the **Activities** tab to add, rename, or
archive entries. Edits sync to the server immediately (online for v1; could
move to the outbox later for true offline edits).
