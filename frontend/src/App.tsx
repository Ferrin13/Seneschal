import {
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { useAuth } from "./auth";
import { signInWithGoogle, signOut } from "./firebase";
import { TimeTrackingView } from "./TimeTrackingView";

export default function App() {
  const { user, loading } = useAuth();

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
                void signInWithGoogle();
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
          <TimeTrackingView />
        ) : (
          <SignedOut />
        )}
      </Container>
    </Box>
  );
}

function SignedOut() {
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
          void signInWithGoogle();
        }}
      >
        Sign in with Google
      </Button>
    </Stack>
  );
}
