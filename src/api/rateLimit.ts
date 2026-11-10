import { auth } from "@/auth/token";
import { createStore } from "@/lib/store";

export interface RateLimitState {
  remaining: number;
  limit: number;
  reset: number;
}

export interface RateLimits {
  core?: RateLimitState;
  graphql?: RateLimitState;
  search?: RateLimitState;
}

type Resource = keyof RateLimits;
type Windows = Partial<Record<Resource, RateLimitState[]>>;

const KEY = "gitgud-rate-limits";

/** Each limit's running windows. GitHub counts GraphQL on two counters, each with its own window. */
let windows: Windows = {};
let viewerLogin: string | undefined;

/** The most spent window of each rate limit. Entries drop when their window resets. */
export const rateLimits = createStore<RateLimits>({});

function mostSpent(list: RateLimitState[]): RateLimitState {
  return list.reduce((a, b) => (b.remaining / (b.limit || 1) < a.remaining / (a.limit || 1) ? b : a));
}

/** Drops windows that reset, then publishes, saves, and schedules the next reset. */
function commit(next: Windows) {
  const now = Date.now();
  windows = {};
  const shown: RateLimits = {};
  for (const key of Object.keys(next) as Resource[]) {
    const live = next[key]?.filter((w) => w.reset * 1000 > now);
    if (!live?.length) continue;
    windows[key] = live;
    shown[key] = mostSpent(live);
  }
  rateLimits.set(shown);
  try {
    localStorage.setItem(KEY, JSON.stringify({ login: viewerLogin, windows }));
  } catch {
    // Storage blocked; readings last for this page.
  }
  scheduleExpiry();
}

/**
 * Merges readings into `rateLimits`. Readings with the same reset belong to one window, where the lowest
 * `remaining` is the newest, so readings that arrive out of order or late can't raise it.
 */
export function mergeRateLimits(updates: RateLimits | Windows) {
  const next = { ...windows };
  let changed = false;
  for (const key of Object.keys(updates) as Resource[]) {
    const update = updates[key];
    for (const reading of Array.isArray(update) ? update : update ? [update] : []) {
      if (reading.reset * 1000 <= Date.now()) continue;
      const list = next[key] ?? [];
      const old = list.find((w) => w.reset === reading.reset);
      if (old && reading.remaining >= old.remaining) continue;
      next[key] = [...list.filter((w) => w !== old), reading];
      changed = true;
    }
  }
  if (changed) commit(next);
}

/** Forgets every reading. */
export function clearRateLimits() {
  commit({});
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const resets = Object.values(windows).flatMap((list) => list.map((w) => w.reset * 1000));
  if (resets.length) expiryTimer = setTimeout(() => commit(windows), Math.max(0, Math.min(...resets) - Date.now()));
}

function readSaved(): { login?: string; windows?: Windows } | undefined {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

// Readings from before a reload, and from other tabs as they arrive.
const saved = readSaved();
viewerLogin = saved?.login;
if (saved?.windows) mergeRateLimits(saved.windows);
globalThis.addEventListener?.("storage", (e: StorageEvent) => {
  if (e.key !== KEY) return;
  const other = readSaved();
  if (other?.windows && other.login === viewerLogin) mergeRateLimits(other.windows);
});

// Another account has its own limits.
auth.subscribe(() => {
  const login = auth.get().viewer?.login;
  if (!login || login === viewerLogin) return;
  const had = viewerLogin;
  viewerLogin = login;
  if (had) clearRateLimits();
});

export function recordRateLimit(headers: Headers) {
  const resource = headers.get("x-ratelimit-resource");
  const remaining = headers.get("x-ratelimit-remaining");
  if (!resource || remaining === null) return;
  if (resource !== "core" && resource !== "graphql" && resource !== "search") return;
  mergeRateLimits({
    [resource]: {
      remaining: Number(remaining),
      limit: Number(headers.get("x-ratelimit-limit")),
      reset: Number(headers.get("x-ratelimit-reset")),
    },
  });
}

/** Speculative and background requests stop while less than this share of a rate limit is left. */
const LOW_SHARE = 0.2;

/** Whether less than `LOW_SHARE` of `resource`'s current window is left. */
export function isRateLimitLow(resource: Resource): boolean {
  const r = rateLimits.get()[resource];
  if (!r || !r.limit || r.reset * 1000 < Date.now()) return false;
  return r.remaining / r.limit <= LOW_SHARE;
}

/** Request counters, exposed as `window.__gitgudApiStats` for tests and the dev console. */
export const apiStats = {
  total: 0,
  rest: 0,
  graphql: 0,
  byName: {} as Record<string, number>,
  reset() {
    this.total = this.rest = this.graphql = 0;
    this.byName = {};
  },
};

(globalThis as { __gitgudApiStats?: typeof apiStats }).__gitgudApiStats = apiStats;

export function recordRequest(kind: "rest" | "graphql", name: string) {
  apiStats.total++;
  apiStats[kind]++;
  const key = `${kind}:${name}`;
  apiStats.byName[key] = (apiStats.byName[key] ?? 0) + 1;
}
