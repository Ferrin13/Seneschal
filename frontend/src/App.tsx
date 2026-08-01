import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useAuth } from "./auth";
import { signInWithGoogle, signOut } from "./firebase";
import { TimeTrackingView } from "./TimeTrackingView";
import { MarketplaceView } from "./MarketplaceView";
import { DealsView } from "./DealsView";
import { SettingsView } from "./SettingsView";
import { useDealNotifications } from "./useDealNotifications";
import { LazaxView } from "./lazax/LazaxView";
import { GameBoard } from "./lazax/GameBoard";
import { StatsView } from "./lazax/StatsView";

/**
 * Three independent sections: Time Tracking, Deal Hunter, and Lazax.
 * Each keeps its own secondary tabs where needed.
 */
const TIME_PATH = "/time-tracking";
const LAZAX_PATH = "/lazax";

/** Sub-tabs within the Deal Hunter section. */
const HUNTER_TABS = [
  { path: "/deals", label: "Deals", element: <DealsView /> },
  { path: "/targets", label: "Targets", element: <MarketplaceView /> },
  { path: "/settings", label: "Settings", element: <SettingsView /> },
] as const;

/** Default landing path for each primary section. */
const HUNTER_DEFAULT = HUNTER_TABS[0].path;

type Section = "time" | "hunter" | "lazax";

function sectionForPath(pathname: string): Section {
  if (pathname.startsWith(LAZAX_PATH)) return "lazax";
  if (HUNTER_TABS.some((t) => pathname.startsWith(t.path))) return "hunter";
  return "time";
}

function LazaxGameRoute() {
  const { gameId } = useParams();
  if (!gameId) return <Navigate to={LAZAX_PATH} replace />;
  return <GameBoard gameId={gameId} />;
}

function LazaxStatsRoute() {
  const { gameId } = useParams();
  if (!gameId) return <Navigate to={LAZAX_PATH} replace />;
  return <StatsView gameId={gameId} />;
}

export default function App() {
  const { user, loading } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useDealNotifications(!!user, () => navigate(HUNTER_DEFAULT));

  const section = sectionForPath(location.pathname);
  const activeHunterTab =
    HUNTER_TABS.find((t) => location.pathname.startsWith(t.path))?.path ??
    HUNTER_DEFAULT;

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

  const goSection = (v: Section) => {
    if (v === "time") navigate(TIME_PATH);
    else if (v === "hunter") navigate(HUNTER_DEFAULT);
    else navigate(LAZAX_PATH);
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar sx={{ gap: { xs: 1, sm: 3 } }}>
          {user ? (
            <IconButton
              color="inherit"
              edge="start"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <MenuIcon />
            </IconButton>
          ) : null}
          <Typography variant="h6">Seneschal</Typography>
          {user ? (
            <Tabs
              value={section}
              onChange={(_e, v: Section) => goSection(v)}
              textColor="inherit"
              indicatorColor="secondary"
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ minHeight: 64, display: { xs: "none", md: "flex" } }}
            >
              <Tab value="time" label="Time Tracking" sx={{ minHeight: 64 }} />
              <Tab value="hunter" label="Deal Hunter" sx={{ minHeight: 64 }} />
              <Tab value="lazax" label="Lazax" sx={{ minHeight: 64 }} />
            </Tabs>
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          {loading ? (
            <CircularProgress size={20} sx={{ color: "inherit" }} />
          ) : user ? (
            <Stack direction="row" spacing={2} alignItems="center">
              {user.photoURL ? (
                <Avatar src={user.photoURL} sx={{ width: 32, height: 32 }} />
              ) : null}
              <Typography
                variant="body2"
                sx={{ display: { xs: "none", sm: "block" } }}
              >
                {user.displayName ?? user.email}
              </Typography>
              <Button
                color="inherit"
                variant="outlined"
                onClick={signOut}
                sx={{ display: { xs: "none", sm: "inline-flex" } }}
              >
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

      {user ? (
        <Drawer
          anchor="left"
          open={navOpen}
          onClose={() => setNavOpen(false)}
          sx={{ display: { md: "none" } }}
        >
          <Box
            sx={{ width: 260 }}
            role="presentation"
            onClick={() => setNavOpen(false)}
          >
            <List>
              <ListItemButton
                selected={section === "time"}
                onClick={() => navigate(TIME_PATH)}
              >
                <ListItemText primary="Time Tracking" />
              </ListItemButton>
              <ListItemButton
                selected={section === "lazax"}
                onClick={() => navigate(LAZAX_PATH)}
              >
                <ListItemText primary="Lazax" />
              </ListItemButton>
            </List>
            <Divider />
            <List
              subheader={<ListSubheader disableSticky>Deal Hunter</ListSubheader>}
            >
              {HUNTER_TABS.map((t) => (
                <ListItemButton
                  key={t.path}
                  selected={location.pathname.startsWith(t.path)}
                  onClick={() => navigate(t.path)}
                >
                  <ListItemText primary={t.label} />
                </ListItemButton>
              ))}
            </List>
            <Divider />
            <List>
              <ListItemButton onClick={signOut}>
                <ListItemText primary="Sign out" />
              </ListItemButton>
            </List>
          </Box>
        </Drawer>
      ) : null}

      <Container maxWidth={false} sx={{ py: { xs: 2, sm: 4 } }}>
        {loading ? (
          <Stack alignItems="center" sx={{ mt: 8 }}>
            <CircularProgress />
          </Stack>
        ) : user ? (
          <Stack spacing={3}>
            {section === "hunter" ? (
              <Tabs
                value={activeHunterTab}
                onChange={(_e, v: string) => navigate(v)}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ display: { xs: "none", md: "flex" } }}
              >
                {HUNTER_TABS.map((t) => (
                  <Tab key={t.path} value={t.path} label={t.label} />
                ))}
              </Tabs>
            ) : null}
            <Routes>
              <Route path="/" element={<Navigate to={TIME_PATH} replace />} />
              <Route path={TIME_PATH} element={<TimeTrackingView />} />
              <Route path={LAZAX_PATH} element={<LazaxView />} />
              <Route
                path={`${LAZAX_PATH}/:gameId/stats`}
                element={<LazaxStatsRoute />}
              />
              <Route path={`${LAZAX_PATH}/:gameId`} element={<LazaxGameRoute />} />
              {HUNTER_TABS.map((t) => (
                <Route
                  key={t.path}
                  path={t.path === "/deals" ? "/deals/*" : t.path}
                  element={t.element}
                />
              ))}
              <Route path="*" element={<Navigate to={TIME_PATH} replace />} />
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
