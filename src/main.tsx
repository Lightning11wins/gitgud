// First, so its default policy exists before other modules run.
import "./lib/trustedTypes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/markdown.css";
import "./lib/theme";
import { App } from "./App";
import { installLinkPrefetch } from "./api/prefetch";
import { startWarmUp } from "./api/warmUp";
import { collectCacheGarbage, readRecent } from "./api/queryClient";
import { getToken, loadAuth } from "./auth/token";
import { installClickGuard } from "./lib/clickGuard";
import { installTooltips } from "./lib/tooltip";

const recent = readRecent();
void loadAuth().then(async () => {
  if (getToken()) (await recent).apply();
});
startWarmUp();
installLinkPrefetch();
installClickGuard();
installTooltips();
setTimeout(() => collectCacheGarbage().catch(() => {}), 10_000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
