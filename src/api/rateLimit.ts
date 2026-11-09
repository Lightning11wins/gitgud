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

/** The latest reading of each rate limit. Entries drop when their window resets. */
export const rateLimits = createStore<RateLimits>({});

/**
 * Merges readings into `rateLimits`. A later reset starts a new window, and within a window the lowest
 * `remaining` is the newest, so readings that arrive out of order or late can't raise it.
 */
export function mergeRateLimits(updates: RateLimits) {
  const current = rateLimits.get();
  const next = { ...current };
  let changed = false;
  for (const key of Object.keys(updates) as (keyof RateLimits)[]) {
    const update = updates[key];
    const old = current[key];
    if (!update || update.reset * 1000 <= Date.now()) continue;
    if (old && (update.reset < old.reset || (update.reset === old.reset && update.remaining >= old.remaining))) continue;
    next[key] = update;
    changed = true;
  }
  if (!changed) return;
  rateLimits.set(next);
  scheduleExpiry();
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const resets = Object.values(rateLimits.get()).map((r) => r.reset * 1000);
  if (resets.length) expiryTimer = setTimeout(dropExpired, Math.max(0, Math.min(...resets) - Date.now()));
}

function dropExpired() {
  const now = Date.now();
  rateLimits.set(Object.fromEntries(Object.entries(rateLimits.get()).filter(([, r]) => r.reset * 1000 > now)));
  scheduleExpiry();
}

// Another account has its own limits.
let viewerLogin: string | undefined;
auth.subscribe(() => {
  const login = auth.get().viewer?.login;
  if (!login || login === viewerLogin) return;
  if (viewerLogin) {
    rateLimits.set({});
    scheduleExpiry();
  }
  viewerLogin = login;
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
export function isRateLimitLow(resource: keyof RateLimits): boolean {
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
