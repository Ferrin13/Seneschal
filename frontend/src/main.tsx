import React from "react";
import ReactDOM from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFnsV3";

import App from "./App";
import { AuthProvider } from "./auth";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2D1B4E",
      light: "#4A3570",
      dark: "#1B0F30",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#6650A4",
      light: "#8A76C4",
      dark: "#453276",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#F6F4FA",
      paper: "#FFFFFF",
    },
  },
  shape: { borderRadius: 10 },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LocalizationProvider>
    </ThemeProvider>
  </React.StrictMode>
);
