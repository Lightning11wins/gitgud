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

export const rateLimits = createStore<RateLimits>({});

export function recordRateLimit(headers: Headers) {
  const resource = headers.get("x-ratelimit-resource");
  const remaining = headers.get("x-ratelimit-remaining");
  if (!resource || remaining === null) return;
  if (resource !== "core" && resource !== "graphql" && resource !== "search") return;
  rateLimits.set({
    ...rateLimits.get(),
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
