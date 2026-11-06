import { createStore } from "./store";

export interface Settings {
  /** Show the API usage meter in the header even when no limit is running low. */
  showApiMeter: boolean;
  /** Send one request to each hourly rate limit as its window resets, so a new window starts right away. */
  warmUpRateLimits: boolean;
  /** Load pages the user is likely to open next, like hovered links, in the background. */
  prefetch: boolean;
}

const KEY = "gitgud-settings";
const DEFAULTS: Settings = { showApiMeter: true, warmUpRateLimits: true, prefetch: true };

function read(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    return DEFAULTS;
  }
}

export const settings = createStore<Settings>(read());

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings.get(), ...patch };
  settings.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked; the choice lasts for this session.
  }
}
