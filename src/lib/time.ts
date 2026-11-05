import { createStore } from "./store";

/** Increments once a minute so relative timestamps re-render together. */
export const minuteTick = createStore(0);
setInterval(() => minuteTick.set(minuteTick.get() + 1), 60_000);

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function formatRelative(d: Date, now = Date.now()): string {
  const sec = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), "day");
  return d.getFullYear() === new Date(now).getFullYear() ? `on ${dateFmt.format(d)}` : `on ${dateYearFmt.format(d)}`;
}
