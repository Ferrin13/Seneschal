import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import { api, ApiError, type Me } from "./api";
import { auth, signOut } from "./firebase";

type AuthState = {
  /** Firebase identity, or null when signed out. */
  user: User | null;
  /**
   * Server-side account (permissions). Null until loaded; stays null when
   * `user` is null or `/me` failed (see `meError`).
   */
  me: Me | null;
  /** True while Firebase is restoring the session or `/me` is in flight. */
  loading: boolean;
  /**
   * Set when the signed-in Google account was rejected by the backend
   * (not granted access) or `/me` failed for another reason. On rejection
   * the user has already been signed back out.
   */
  meError: string | null;
  /** Re-fetch `/me` (e.g. after a transient network error). */
  reloadMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  me: null,
  loading: true,
  meError: null,
  reloadMe: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);
      setFirebaseReady(true);
      if (!u) setMe(null);
    });
    return unsub;
  }, []);

  const loadMe = useCallback(async (u: User) => {
    setMeError(null);
    try {
      const next = await api.me();
      setMe(next);
    } catch (err) {
      setMe(null);
      if (err instanceof ApiError && err.status === 403) {
        // Valid Google account, but nobody has granted it access. Sign out so
        // the page returns to the welcome screen with an explanation.
        await signOut();
        setMeError(
          `${u.email ?? "This account"} does not have access to Seneschal. ` +
            "Ask an administrator to add you from the Admin tab, then sign in again."
        );
      } else {
        setMeError(
          err instanceof Error ? err.message : "Could not load your account."
        );
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadMe(user);
    }
  }, [user, loadMe]);

  const reloadMe = useCallback(async () => {
    if (user) await loadMe(user);
  }, [user, loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      me,
      // Signed in but `/me` neither succeeded nor failed yet counts as loading
      // so product tabs never flash before permissions are known.
      loading: !firebaseReady || (!!user && me === null && meError === null),
      meError,
      reloadMe,
    }),
    [user, me, firebaseReady, meError, reloadMe]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
