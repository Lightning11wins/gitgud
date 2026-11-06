import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/markdown.css";
import "./lib/theme";
import { App } from "./App";
import { startWarmUp } from "./api/warmUp";
import { loadAuth } from "./auth/token";

loadAuth();
startWarmUp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
