import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from "@mui/material";
import { useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./auth";
import { signInWithGoogle, signOut } from "./firebase";
import { TimeTrackingView } from "./TimeTrackingView";
import { MarketplaceView } from "./MarketplaceView";
import { DealsView } from "./DealsView";
import { SettingsView } from "./SettingsView";

/** Top-level navigation tabs, each mapped to its own routed path. */
const NAV_TABS = [
  { path: "/time-tracking", label: "Time Tracking", element: <TimeTrackingView /> },
  { path: "/targets", label: "Targets", element: <MarketplaceView /> },
  { path: "/deals", label: "Deals", element: <DealsView /> },
  { path: "/settings", label: "Settings", element: <SettingsView /> },
] as const;

export default function App() {
  const { user, loading } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Drive the tab bar off the URL; unknown paths fall back to the first tab.
  const activeTab =
    NAV_TABS.find((t) => location.pathname.startsWith(t.path))?.path ??
    NAV_TABS[0].path;

  const handleSignIn = async () => {
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setSignInError(
        err instanceof Error ? err.message : "Sign-in failed. Please try again."
      );
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Seneschal
          </Typography>
          {loading ? (
            <CircularProgress size={20} sx={{ color: "inherit" }} />
          ) : user ? (
            <Stack direction="row" spacing={2} alignItems="center">
              {user.photoURL ? (
                <Avatar src={user.photoURL} sx={{ width: 32, height: 32 }} />
              ) : null}
              <Typography variant="body2">
                {user.displayName ?? user.email}
              </Typography>
              <Button color="inherit" variant="outlined" onClick={signOut}>
                Sign out
              </Button>
            </Stack>
          ) : (
            <Button
              color="inherit"
              variant="outlined"
              onClick={() => {
                void handleSignIn();
              }}
            >
              Sign in with Google
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ py: 4 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ mt: 8 }}>
            <CircularProgress />
          </Stack>
        ) : user ? (
          <Stack spacing={3}>
            <Tabs
              value={activeTab}
              onChange={(_e, v: string) => navigate(v)}
              variant="scrollable"
              allowScrollButtonsMobile
            >
              {NAV_TABS.map((t) => (
                <Tab key={t.path} value={t.path} label={t.label} />
              ))}
            </Tabs>
            <Routes>
              <Route
                path="/"
                element={<Navigate to={NAV_TABS[0].path} replace />}
              />
              {NAV_TABS.map((t) => (
                <Route
                  key={t.path}
                  path={t.path === "/deals" ? "/deals/*" : t.path}
                  element={t.element}
                />
              ))}
              <Route
                path="*"
                element={<Navigate to={NAV_TABS[0].path} replace />}
              />
            </Routes>
          </Stack>
        ) : (
          <SignedOut onSignIn={handleSignIn} error={signInError} />
        )}
      </Container>
    </Box>
  );
}

function SignedOut({
  onSignIn,
  error,
}: {
  onSignIn: () => void | Promise<void>;
  error: string | null;
}) {
  return (
    <Stack spacing={2} alignItems="center" sx={{ mt: 10, textAlign: "center" }}>
      <Typography variant="h4">Welcome to Seneschal</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
        A read-only view of your time-tracking data. Sign in with the same
        Google account you use in the Android app to continue.
      </Typography>
      <Button
        variant="contained"
        size="large"
        onClick={() => {
          void onSignIn();
        }}
      >
        Sign in with Google
      </Button>
      {error ? (
        <Alert severity="error" sx={{ maxWidth: 480, width: "100%" }}>
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
