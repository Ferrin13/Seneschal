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
import { useAuth } from "./auth";
import { signInWithGoogle, signOut } from "./firebase";
import { TimeTrackingView } from "./TimeTrackingView";
import { MarketplaceView } from "./MarketplaceView";
import { DealsView } from "./DealsView";

export default function App() {
  const { user, loading } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

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

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ mt: 8 }}>
            <CircularProgress />
          </Stack>
        ) : user ? (
          <Stack spacing={3}>
            <Tabs value={tab} onChange={(_e, v: number) => setTab(v)}>
              <Tab label="Time Tracking" />
              <Tab label="Targets" />
              <Tab label="Deals" />
            </Tabs>
            {tab === 0 ? (
              <TimeTrackingView />
            ) : tab === 1 ? (
              <MarketplaceView />
            ) : (
              <DealsView />
            )}
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
