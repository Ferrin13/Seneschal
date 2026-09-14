import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { config } from "../config.js";

let app: App | null = null;

/**
 * Service-account credential. Prefers the inline JSON (how ECS injects it
 * from SSM), otherwise defers to Google's application-default lookup, which
 * honors GOOGLE_APPLICATION_CREDENTIALS for local dev.
 */
function credential(): Credential {
  const json = config.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (json) {
    try {
      return cert(JSON.parse(json));
    } catch (err) {
      // Token verification still works without credentials, so don't take
      // the whole API down over a malformed secret — just lose push.
      console.warn(
        `[firebase] GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid service-account JSON (${
          (err as Error).message
        }); falling back to application-default credentials`
      );
    }
  }
  return applicationDefault();
}

export function firebaseApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }
  app = initializeApp({
    credential: credential(),
    projectId: config.FIREBASE_PROJECT_ID,
  });
  return app;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

/** Firebase Cloud Messaging client (needs real service-account credentials). */
export function firebaseMessaging(): Messaging {
  return getMessaging(firebaseApp());
}

/** Whether this process can actually send FCM messages. */
export function pushConfigured(): boolean {
  return Boolean(
    config.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      config.GOOGLE_APPLICATION_CREDENTIALS
  );
}
