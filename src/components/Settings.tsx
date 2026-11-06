import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QuestionIcon } from "@primer/octicons-react";
import { apiStats } from "@/api/rateLimit";
import { clearCache, storageUsage } from "@/api/queryClient";
import { auth, signOut } from "@/auth/token";
import { settings, updateSettings, type RepoTab } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { setTheme, themePref, type ThemePref } from "@/lib/theme";
import { useTitle } from "@/lib/useTitle";
import { ApiUsageBars } from "./ApiUsageBars";

const REPO_TABS: { value: RepoTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "issues", label: "Issues" },
  { value: "pulls", label: "Pull requests" },
];

const WARM_UP_TIP = "GitGud automatically starts a new hourly window as soon as the previous window ends, costing one request on each limit.";
const PREFETCH_TIP = "GitGud loads pages you're likely to open next, like links you hover, so they open instantly. It pauses while any limit has less than 20% left.";

export function Settings() {
  useTitle("Settings");
  const theme = useStore(themePref);
  const { viewer } = useStore(auth);
  const prefs = useStore(settings);
  const qc = useQueryClient();
  const [usage, setUsage] = useState<number>();
  const [persisted, setPersisted] = useState<boolean>();

  const refresh = () => {
    storageUsage().then(setUsage);
    navigator.storage?.persisted?.().then(setPersisted);
  };
  useEffect(refresh, []);

  return (
    <div style={{ maxWidth: 720 }}>
      <h2>Settings</h2>
      <section className="box" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Theme</h3>
        <div className="row" style={{ gap: 16 }}>
          {(["system", "light", "dark"] as ThemePref[]).map((t) => (
            <label key={t} className="row" style={{ gap: 6 }}>
              <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />
              {t[0].toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </section>
      <section className="box" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Default repository tab</h3>
        <div className="row" style={{ gap: 16 }}>
          {REPO_TABS.map((t) => (
            <label key={t.value} className="row" style={{ gap: 6 }}>
              <input type="radio" name="repo-tab" checked={prefs.repoTab === t.value} onChange={() => updateSettings({ repoTab: t.value })} />
              {t.label}
            </label>
          ))}
        </div>
      </section>
      <section className="box" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Cache</h3>
        <p>
          Storage used: <strong>{usage === undefined ? "unknown" : `${(usage / 1024 / 1024).toFixed(1)} MB`}</strong>
          {" · "}
          Persistent: <strong>{persisted === undefined ? "unknown" : persisted ? "yes" : "no"}</strong>
        </p>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              await clearCache();
              qc.invalidateQueries();
              refresh();
            }}
          >
            Clear cache
          </button>
          {!persisted && (
            <button className="btn" onClick={() => navigator.storage?.persist?.().then(() => refresh())}>
              Request persistent storage
            </button>
          )}
        </div>
      </section>
      <section className="box" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>API usage</h3>
        <p className="muted">
          Requests this session: {apiStats.total} ({apiStats.graphql} GraphQL, {apiStats.rest} REST)
        </p>
        <ApiUsageBars />
        <label className="row" style={{ gap: 6, marginBottom: 8 }}>
          <input type="checkbox" checked={prefs.showApiMeter} onChange={(e) => updateSettings({ showApiMeter: e.target.checked })} />
          Always show usage meter.
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!prefs.warmUpRateLimits} onChange={(e) => updateSettings({ warmUpRateLimits: !e.target.checked })} />
          Disable prewarming.
          <span className="muted" role="img" style={{ display: "inline-flex" }} aria-label={WARM_UP_TIP} title={WARM_UP_TIP}>
            <QuestionIcon size={14} />
          </span>
        </label>
        <label className="row" style={{ gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={!prefs.prefetch} onChange={(e) => updateSettings({ prefetch: !e.target.checked })} />
          Disable prefetching.
          <span className="muted" role="img" style={{ display: "inline-flex" }} aria-label={PREFETCH_TIP} title={PREFETCH_TIP}>
            <QuestionIcon size={14} />
          </span>
        </label>
      </section>
      <section className="box" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <p>
          Signed in as <strong>{viewer?.login}</strong>.
        </p>
        <button className="btn danger" onClick={() => signOut()}>
          Sign out and erase local data
        </button>
      </section>
    </div>
  );
}
