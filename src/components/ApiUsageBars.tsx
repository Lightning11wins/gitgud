import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";
import { rateLimits, type RateLimits } from "@/api/rateLimit";
import { refreshRateLimits } from "@/api/warmUp";
import { useStore } from "@/lib/store";
import "./api-usage.css";

const LIMITS: [keyof RateLimits, string][] = [
  ["graphql", "GraphQL"],
  ["core", "REST"],
  ["search", "Search"],
];
/** How often to reread the limits while the bars show, since other tabs and apps spend them too. */
const REFRESH_MS = 60_000;

/** "42m", "1h 5m", or "30s" until a reset. */
function formatCountdown(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** One bar per GitHub API rate limit, filled by the share left, with the time until it resets. */
export function ApiUsageBars() {
  const limits = useStore(rateLimits);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) refreshRateLimits().catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="api-usage">
      {LIMITS.map(([key, name]) => {
        const r = limits[key];
        if (!r && key === "search") return null;
        const resetAt = r ? r.reset * 1000 : 0;
        const active = r && r.limit > 0 && resetAt > now;
        const left = active ? r.remaining / r.limit : 1;
        const pct = Math.floor(left * 100);
        const tone = left <= 0 ? " danger" : left < 0.1 ? " attention" : "";
        return (
          <div key={key} className={`api-usage-row${tone}`}>
            <div className="api-usage-label">
              <div>{name}</div>
              <div>
                <span className="api-usage-pct">{pct}%</span> <span className="muted">left</span>
              </div>
              <div className="api-usage-count muted">
                {active ? `${r.remaining.toLocaleString()} of ${r.limit.toLocaleString()}` : "No window running"}
              </div>
            </div>
            <div
              className="api-usage-bar"
              role="meter"
              aria-label={`${name} requests left`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="api-usage-fill" style={{ width: `${left * 100}%` }} />
              {active && (
                <span className="api-usage-reset" title={`Resets at ${new Date(resetAt).toLocaleTimeString()}`}>
                  <SyncIcon size={12} />
                  {formatCountdown(resetAt - now)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
