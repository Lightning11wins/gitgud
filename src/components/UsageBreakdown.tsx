import { useEffect, useState } from "react";
import { rateLimits, type RateLimits } from "@/api/rateLimit";
import { entriesInWindows, pointsByHour, usageByOperation, usageEntries, usageVersion, type UsageEntry, type UsageResource } from "@/api/usage";
import { auth } from "@/auth/token";
import { useStore } from "@/lib/store";
import { tooltip } from "@/lib/tooltip";
import "./api-usage.css";

type Range = "window" | "day";

const RESOURCES: [UsageResource, string][] = [
  ["graphql", "GraphQL"],
  ["core", "REST"],
  ["search", "Search"],
];
const RESOURCE_NAMES = Object.fromEntries(RESOURCES) as Record<UsageResource, string>;
/** Operations shown before "Show more". */
const TOP = 10;

const fmt = (n: number) => n.toLocaleString();
const sumPoints = (entries: UsageEntry[]) => entries.reduce((n, e) => n + e.points, 0);

/** Where this browser's GitHub API points went, by operation, over the current window or the last 24 hours. */
export function UsageBreakdown() {
  const { viewer } = useStore(auth);
  const limits = useStore(rateLimits);
  useStore(usageVersion);
  const [range, setRange] = useState<Range>("window");
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!viewer) return null;

  const all = usageEntries(viewer.login);
  const entries = range === "day" ? all : entriesInWindows(all, limits, now);
  const ops = usageByOperation(entries);
  const total = sumPoints(entries);
  const shown = expanded ? ops : ops.slice(0, TOP);

  return (
    <section className="box" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Usage breakdown</h3>
      <div className="row" style={{ gap: 16, marginBottom: 12 }}>
        {(
          [
            ["window", "Current window"],
            ["day", "Last 24 hours"],
          ] as [Range, string][]
        ).map(([value, label]) => (
          <label key={value} className="row" style={{ gap: 6 }}>
            <input type="radio" name="usage-range" checked={range === value} onChange={() => setRange(value)} />
            {label}
          </label>
        ))}
      </div>
      {range === "window" ? <WindowSummary entries={entries} limits={limits} now={now} /> : <DaySummary entries={entries} now={now} />}
      {ops.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          No requests recorded in this range.
        </p>
      ) : (
        <table className="usage-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Limit</th>
              <th className="num">Requests</th>
              <th className="num">Points</th>
              <th className="num">Free</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((op) => (
              <tr key={`${op.resource} ${op.name}`}>
                <td className="mono usage-op">{op.name}</td>
                <td>{RESOURCE_NAMES[op.resource]}</td>
                <td className="num">{fmt(op.requests)}</td>
                <td className="num">
                  {op.estimated ? <span {...tooltip(`${fmt(op.estimated)} estimated at 1 point per request`)}>~{fmt(op.points)}</span> : fmt(op.points)}
                </td>
                <td className="num">{fmt(op.free)}</td>
                <td className="num">{total ? `${Math.round((op.points / total) * 100)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ops.length > TOP && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show ${ops.length - TOP} more ${ops.length - TOP === 1 ? "operation" : "operations"}`}
        </button>
      )}
    </section>
  );
}

/** Each running window's points: by GitGud in this browser, and elsewhere. */
function WindowSummary({ entries, limits, now }: { entries: UsageEntry[]; limits: RateLimits; now: number }) {
  const rows = RESOURCES.flatMap(([resource, name]) => {
    const window = limits[resource];
    if (!window || window.reset * 1000 <= now) return [];
    const used = window.limit - window.remaining;
    const ours = sumPoints(entries.filter((e) => e.resource === resource));
    return [{ name, used, ours, resetAt: window.reset * 1000 }];
  });
  if (!rows.length) return <p className="muted">No rate limit window is running.</p>;
  return (
    <ul className="usage-summary">
      {rows.map((r) => (
        <li key={r.name}>
          <strong>{r.name}:</strong> {fmt(r.used)} points used in the window ending at {new Date(r.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.{" "}
          {fmt(r.ours)} by GitGud in this browser, {fmt(Math.max(0, r.used - r.ours))} elsewhere (other apps, browsers, or devices).
        </li>
      ))}
    </ul>
  );
}

/** Totals and an hourly chart of the last 24 hours. */
function DaySummary({ entries, now }: { entries: UsageEntry[]; now: number }) {
  const hours = pointsByHour(entries, now);
  const graphql = sumPoints(entries.filter((e) => e.resource === "graphql"));
  const total = sumPoints(entries);
  const max = Math.max(1, ...hours.map((h) => h.graphql + h.rest));
  const hourLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric" });
  return (
    <>
      <p>
        GitGud used <strong>{fmt(total)}</strong> points in this browser: {fmt(graphql)} GraphQL, {fmt(total - graphql)} REST.
      </p>
      <div className="usage-chart">
        <div className="usage-legend">
          <span className="usage-key usage-graphql" />
          GraphQL
          <span className="usage-key usage-rest" />
          REST
          <span className="grow" />
          {total > 0 && <span className="muted">Peak {fmt(max)} points per hour</span>}
        </div>
        <div className="usage-bars">
          {hours.map((h) => {
            const label = `${hourLabel(h.start)}: ${fmt(h.graphql)} GraphQL, ${fmt(h.rest)} REST points`;
            return (
              <div key={h.start} className="usage-hour" role="img" {...tooltip(label, "label")}>
                {h.rest > 0 && <div className="usage-seg usage-rest" style={{ height: `${(h.rest / max) * 100}%` }} />}
                {h.graphql > 0 && <div className="usage-seg usage-graphql" style={{ height: `${(h.graphql / max) * 100}%` }} />}
              </div>
            );
          })}
        </div>
        <div className="usage-axis muted">
          {hours.map((h, i) => (
            <span key={h.start}>{i % 6 === 0 || i === hours.length - 1 ? hourLabel(h.start) : ""}</span>
          ))}
        </div>
      </div>
    </>
  );
}
