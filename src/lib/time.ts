import { useSyncExternalStore } from "react";
import { createStore } from "./store";

/** Increments once a minute so relative timestamps re-render together. */
export const minuteTick = createStore(0);
setInterval(() => minuteTick.set(minuteTick.get() + 1), 60_000);

const secondListeners = new Set<() => void>();
let secondTimer: ReturnType<typeof setTimeout> | undefined;

function tickSecond() {
  secondTimer = setTimeout(tickSecond, 1000 - (Date.now() % 1000));
  secondListeners.forEach((l) => l());
}

function subscribeSecond(listener: () => void) {
  secondListeners.add(listener);
  if (secondListeners.size === 1) tickSecond();
  return () => {
    secondListeners.delete(listener);
    if (!secondListeners.size) clearTimeout(secondTimer);
  };
}

const currentSecond = () => Math.floor(Date.now() / 1000);

/** The current time in whole seconds, re-rendering each second. The timer runs only while a component uses it. */
export function useSecond(): number {
  return useSyncExternalStore(subscribeSecond, currentSecond);
}

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
