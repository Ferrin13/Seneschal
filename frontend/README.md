# Seneschal frontend

A small read-only web UI over the Seneschal time-tracking API. Built with
Vite + React + TypeScript + MUI v6, and Firebase Auth (Google sign-in) for
the same identity model the Android app uses.

For now this is intentionally minimal: sign in, pick a day, see your 96
fifteen-minute slots with their primary/secondary activity, notes, and a
per-category summary. There are no write actions.

## Setup

```
cd frontend
cp .env.example .env
# fill in:
#   VITE_API_BASE_URL          (default http://localhost:8080)
#   VITE_FIREBASE_API_KEY
#   VITE_FIREBASE_AUTH_DOMAIN
#   VITE_FIREBASE_PROJECT_ID
#   VITE_FIREBASE_APP_ID
npm install
npm run dev      # http://localhost:5173
```

The Firebase web SDK config lives in your Firebase console under
**Project settings → Your apps → Web app**. It must be the same Firebase
project the backend verifies tokens against (`FIREBASE_PROJECT_ID` in
`backend/.env`).

You also need the dev origin allow-listed in the backend so CORS lets the
browser through. Add this to `backend/.env`:

```
CORS_ORIGINS=http://localhost:5173
```

## Scripts

- `npm run dev` — Vite dev server with HMR.
- `npm run build` — type-check (`tsc -b`) then production build into `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — `tsc --noEmit` only; there is no ESLint config yet.

## Layout

```
src/
  main.tsx              theme + providers (MUI, date-fns, AuthProvider)
  App.tsx               app bar, sign-in gate
  TimeTrackingView.tsx  day picker + slots table + summary + categories panel
  auth.tsx              AuthProvider/useAuth around firebase.onAuthStateChanged
  firebase.ts           Firebase init + signInWithGoogle / signOut helpers
  api.ts                fetch wrapper that attaches the Firebase ID token
```
