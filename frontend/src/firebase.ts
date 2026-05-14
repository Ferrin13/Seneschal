import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from "firebase/auth";

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
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

const ALLOWED_EMAIL = "12aplustech@gmail.com";

export class UnauthorizedEmailError extends Error {
  constructor(email: string | null) {
    super(
      `This Seneschal instance is restricted to ${ALLOWED_EMAIL}.` +
        (email ? ` You signed in as ${email}.` : "")
    );
    this.name = "UnauthorizedEmailError";
  }
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const email = result.user.email;
  if (!email || email.toLowerCase() !== ALLOWED_EMAIL) {
    await fbSignOut(auth);
    throw new UnauthorizedEmailError(email);
  }
}

export async function signOut() {
  await fbSignOut(auth);
}
