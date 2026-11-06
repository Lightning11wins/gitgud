import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/markdown.css";
import "./lib/theme";
import { App } from "./App";
import { installLinkPrefetch } from "./api/prefetch";
import { startWarmUp } from "./api/warmUp";
import { readRecent } from "./api/queryClient";
import { getToken, loadAuth } from "./auth/token";

const recent = readRecent();
void loadAuth().then(async () => {
  if (getToken()) (await recent).apply();
});
startWarmUp();
installLinkPrefetch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
