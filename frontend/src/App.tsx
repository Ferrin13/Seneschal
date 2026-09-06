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
import { useMemo, useState } from "react";
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
import type { Me } from "./api";
import type { Feature } from "./features";
import { TimeTrackingView } from "./TimeTrackingView";
import { MarketplaceView } from "./MarketplaceView";
import { DealsView } from "./DealsView";
import { SettingsView } from "./SettingsView";
import { useDealNotifications } from "./useDealNotifications";
import { LazaxView } from "./lazax/LazaxView";
import { GameBoard } from "./lazax/GameBoard";
import { StatsView } from "./lazax/StatsView";
import { ThrawnView } from "./thrawn/ThrawnView";
import { LeagueView } from "./thrawn/LeagueView";
import { DescartesView } from "./descartes/DescartesView";
import { MoneyballView } from "./moneyball/MoneyballView";
import { TeamsView } from "./moneyball/TeamsView";
import { ConcentrationView } from "./moneyball/ConcentrationView";
import { AdminView } from "./admin/AdminView";

/**
 * Independent product sections, each shown only when the signed-in account
 * holds the matching feature (from GET /me). Admin is its own flag. Each
 * section keeps its own secondary tabs where needed.
 */
const TIME_PATH = "/time-tracking";
const LAZAX_PATH = "/lazax";
const THRAWN_PATH = "/thrawn";
const DESCARTES_PATH = "/descartes";
const MONEYBALL_PATH = "/moneyball";
const ADMIN_PATH = "/admin";

/** Sub-tabs within the Deal Hunter section. */
const HUNTER_TABS = [
  { path: "/deals", label: "Deals", element: <DealsView /> },
  { path: "/targets", label: "Targets", element: <MarketplaceView /> },
  { path: "/settings", label: "Settings", element: <SettingsView /> },
] as const;

/** Default landing path for each primary section. */
const HUNTER_DEFAULT = HUNTER_TABS[0].path;

type Section =
  | "time"
  | "hunter"
  | "lazax"
  | "thrawn"
  | "descartes"
  | "moneyball"
  | "admin";

type SectionDef = {
  id: Section;
  label: string;
  /** Where the tab lands. */
  path: string;
  /** All path prefixes that belong to the section. */
  prefixes: readonly string[];
  /** Feature that unlocks it, or "admin" for the admin flag. */
  requires: Feature | "admin";
};

const SECTIONS: readonly SectionDef[] = [
  {
    id: "time",
    label: "Time Tracking",
    path: TIME_PATH,
    prefixes: [TIME_PATH],
    requires: "time_tracking",
  },
  {
    id: "hunter",
    label: "Deal Hunter",
    path: HUNTER_DEFAULT,
    prefixes: HUNTER_TABS.map((t) => t.path),
    requires: "deal_hunter",
  },
  {
    id: "lazax",
    label: "Lazax",
    path: LAZAX_PATH,
    prefixes: [LAZAX_PATH],
    requires: "lazax",
  },
  {
    id: "thrawn",
    label: "Thrawn",
    path: THRAWN_PATH,
    prefixes: [THRAWN_PATH],
    requires: "thrawn",
  },
  {
    id: "descartes",
    label: "Descartes",
    path: DESCARTES_PATH,
    prefixes: [DESCARTES_PATH],
    requires: "descartes",
  },
  {
    id: "moneyball",
    label: "Moneyball",
    path: MONEYBALL_PATH,
    prefixes: [MONEYBALL_PATH],
    requires: "moneyball",
  },
  {
    id: "admin",
    label: "Admin",
    path: ADMIN_PATH,
    prefixes: [ADMIN_PATH],
    requires: "admin",
  },
];

function canSee(me: Me, s: SectionDef): boolean {
  return s.requires === "admin"
    ? me.isAdmin
    : me.features.includes(s.requires);
}

function sectionForPath(
  pathname: string,
  available: readonly SectionDef[]
): Section | null {
  return (
    available.find((s) => s.prefixes.some((p) => pathname.startsWith(p)))?.id ??
    null
  );
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

function ThrawnLeagueRoute() {
  const { leagueId } = useParams();
  if (!leagueId) return <Navigate to={THRAWN_PATH} replace />;
  return <LeagueView leagueId={leagueId} />;
}

function MoneyballRoute() {
  const { playerId } = useParams();
  return <MoneyballView selectedPlayerId={playerId ?? null} />;
}

export default function App() {
  const { user, me, loading, meError, reloadMe } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const available = useMemo(
    () => (me ? SECTIONS.filter((s) => canSee(me, s)) : []),
    [me]
  );
  const has = (id: Section) => available.some((s) => s.id === id);
  const homePath = available[0]?.path ?? null;

  useDealNotifications(has("hunter"), () => navigate(HUNTER_DEFAULT));

  const section = sectionForPath(location.pathname, available);
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

  const goSection = (id: Section) => {
    const s = available.find((x) => x.id === id);
    if (s) navigate(s.path);
  };

  const signedIn = !!user && !!me;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar sx={{ gap: { xs: 1, sm: 3 } }}>
          {signedIn ? (
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
          {signedIn && available.length > 0 ? (
            <Tabs
              value={section ?? false}
              onChange={(_e, v: Section) => goSection(v)}
              textColor="inherit"
              indicatorColor="secondary"
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ minHeight: 64, display: { xs: "none", md: "flex" } }}
            >
              {available.map((s) => (
                <Tab
                  key={s.id}
                  value={s.id}
                  label={s.label}
                  sx={{ minHeight: 64 }}
                />
              ))}
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

      {signedIn ? (
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
              {available
                .filter((s) => s.id !== "hunter")
                .map((s) => (
                  <ListItemButton
                    key={s.id}
                    selected={section === s.id}
                    onClick={() => navigate(s.path)}
                  >
                    <ListItemText primary={s.label} />
                  </ListItemButton>
                ))}
            </List>
            {has("hunter") ? (
              <>
                <Divider />
                <List
                  subheader={
                    <ListSubheader disableSticky>Deal Hunter</ListSubheader>
                  }
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
              </>
            ) : null}
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
        ) : user && !me ? (
          <AccountError
            message={meError ?? "Could not load your account."}
            onRetry={reloadMe}
          />
        ) : signedIn && me ? (
          homePath === null ? (
            <NoAccess email={me.email} />
          ) : (
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
                <Route path="/" element={<Navigate to={homePath} replace />} />
                {has("time") ? (
                  <Route path={TIME_PATH} element={<TimeTrackingView />} />
                ) : null}
                {has("lazax") ? (
                  <>
                    <Route path={LAZAX_PATH} element={<LazaxView />} />
                    <Route
                      path={`${LAZAX_PATH}/:gameId/stats`}
                      element={<LazaxStatsRoute />}
                    />
                    <Route
                      path={`${LAZAX_PATH}/:gameId`}
                      element={<LazaxGameRoute />}
                    />
                  </>
                ) : null}
                {has("thrawn") ? (
                  <>
                    <Route path={THRAWN_PATH} element={<ThrawnView />} />
                    <Route
                      path={`${THRAWN_PATH}/:leagueId`}
                      element={<ThrawnLeagueRoute />}
                    />
                  </>
                ) : null}
                {has("descartes") ? (
                  <Route path={DESCARTES_PATH} element={<DescartesView />} />
                ) : null}
                {has("moneyball") ? (
                  <>
                    <Route path={MONEYBALL_PATH} element={<MoneyballRoute />} />
                    <Route path={`${MONEYBALL_PATH}/teams`} element={<TeamsView />} />
                    <Route
                      path={`${MONEYBALL_PATH}/concentration`}
                      element={<ConcentrationView />}
                    />
                    <Route
                      path={`${MONEYBALL_PATH}/:playerId`}
                      element={<MoneyballRoute />}
                    />
                  </>
                ) : null}
                {has("hunter")
                  ? HUNTER_TABS.map((t) => (
                      <Route
                        key={t.path}
                        path={t.path === "/deals" ? "/deals/*" : t.path}
                        element={t.element}
                      />
                    ))
                  : null}
                {has("admin") ? (
                  <Route path={ADMIN_PATH} element={<AdminView />} />
                ) : null}
                <Route path="*" element={<Navigate to={homePath} replace />} />
              </Routes>
            </Stack>
          )
        ) : (
          <SignedOut
            onSignIn={handleSignIn}
            error={signInError ?? meError}
          />
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
        Sign in with the Google account an administrator has granted access
        to. If you also use the Android app, use the same account.
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

/** Signed in with Firebase, but GET /me failed for a non-403 reason. */
function AccountError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <Stack spacing={2} alignItems="center" sx={{ mt: 10, textAlign: "center" }}>
      <Alert severity="error" sx={{ maxWidth: 520, width: "100%" }}>
        {message}
      </Alert>
      <Stack direction="row" spacing={2}>
        <Button
          variant="contained"
          onClick={() => {
            void onRetry();
          }}
        >
          Retry
        </Button>
        <Button variant="outlined" onClick={signOut}>
          Sign out
        </Button>
      </Stack>
    </Stack>
  );
}

/** Account is allowed in but has no features enabled and is not an admin. */
function NoAccess({ email }: { email: string | null }) {
  return (
    <Stack spacing={2} alignItems="center" sx={{ mt: 10, textAlign: "center" }}>
      <Typography variant="h5">Nothing enabled yet</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
        {email ?? "Your account"} can sign in, but no products have been
        enabled for it. Ask an administrator to turn some on from the Admin
        tab, then reload this page.
      </Typography>
      <Button variant="outlined" onClick={signOut}>
        Sign out
      </Button>
    </Stack>
  );
}
