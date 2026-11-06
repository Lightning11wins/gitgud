import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiStats, rateLimits } from "@/api/rateLimit";
import { clearCache, storageUsage } from "@/api/queryClient";
import { auth, signOut } from "@/auth/token";
import { useStore } from "@/lib/store";
import { setTheme, themePref, type ThemePref } from "@/lib/theme";
import { useTitle } from "@/lib/useTitle";

export function Settings() {
  useTitle("Settings");
  const theme = useStore(themePref);
  const { viewer } = useStore(auth);
  const limits = useStore(rateLimits);
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
        <div className="row">
          {(["system", "light", "dark"] as ThemePref[]).map((t) => (
            <label key={t} className="row" style={{ gap: 4 }}>
              <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />
              {t[0].toUpperCase() + t.slice(1)}
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
        <ul>
          {Object.entries(limits).map(([k, v]) => (
            <li key={k}>
              {k}: {v.remaining} / {v.limit} left, resets {new Date(v.reset * 1000).toLocaleTimeString()}
            </li>
          ))}
        </ul>
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
