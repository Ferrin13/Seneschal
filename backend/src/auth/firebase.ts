import {
  initializeApp,
  applicationDefault,
  getApps,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { config } from "../config.js";

let app: App | null = null;

export function firebaseApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }
  app = initializeApp({
    credential: applicationDefault(),
    projectId: config.FIREBASE_PROJECT_ID,
  });
  return app;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}
