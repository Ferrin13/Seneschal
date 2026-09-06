import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from "firebase/auth";

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  // In prod this is the app's own hostname, not `<project>.firebaseapp.com`:
  // CloudFront proxies `/__/auth/*` to Firebase so the OAuth handler page is
  // same-origin. Otherwise browsers that partition third-party storage
  // (Safari, Brave, Firefox strict, Chrome w/o 3P cookies) fail sign-in with
  // `auth/missing-initial-state`. See infra/terraform/DEPLOY.md §8.
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `Firebase config is missing fields: ${missing.join(
      ", "
    )}. Copy frontend/.env.example to frontend/.env and fill them in.`
  );
}

export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);

const googleProvider = new GoogleAuthProvider();

/**
 * Any Google account may complete the popup; whether it is *allowed in* is
 * decided by the backend (`user_access` table, managed from the Admin tab).
 * `AuthProvider` calls GET /me right after sign-in and signs the user back
 * out on 403 — see auth.tsx.
 */
export async function signInWithGoogle() {
  await signInWithPopup(auth, googleProvider);
}

export async function signOut() {
  await fbSignOut(auth);
}
