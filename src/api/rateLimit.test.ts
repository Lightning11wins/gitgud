import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({ createStore: () => undefined, get: async () => undefined, set: async () => {}, del: async () => {}, clear: async () => {} }));

const { auth } = await import("@/auth/token");
const { clearRateLimits, mergeRateLimits, rateLimits, recordRateLimit } = await import("./rateLimit");

const now = 1_700_000_000_000;
const reset = now / 1000 + 600;
const viewer = (login: string) => ({ login, name: null, avatarUrl: "", url: "" });

beforeEach(() => {
  vi.useFakeTimers({ now });
  clearRateLimits();
});
afterEach(() => vi.useRealTimers());

describe("mergeRateLimits", () => {
  it("keeps the lowest remaining within a window", () => {
    mergeRateLimits({ graphql: { remaining: 4000, limit: 5000, reset } });
    mergeRateLimits({ graphql: { remaining: 4100, limit: 5000, reset } });
    expect(rateLimits.get().graphql?.remaining).toBe(4000);
    mergeRateLimits({ graphql: { remaining: 3900, limit: 5000, reset } });
    expect(rateLimits.get().graphql?.remaining).toBe(3900);
  });

  it("shows the most spent of several running windows", () => {
    mergeRateLimits({ graphql: { remaining: 4900, limit: 5000, reset: reset + 1800 } });
    mergeRateLimits({ graphql: { remaining: 4950, limit: 5000, reset } });
    expect(rateLimits.get().graphql?.remaining).toBe(4900);
    mergeRateLimits({ graphql: { remaining: 4800, limit: 5000, reset } });
    expect(rateLimits.get().graphql?.remaining).toBe(4800);
    mergeRateLimits({ graphql: { remaining: 4899, limit: 5000, reset: reset + 1800 } });
    expect(rateLimits.get().graphql?.remaining).toBe(4800);
  });

  it("shows the other window when the most spent one resets", () => {
    mergeRateLimits({ graphql: [{ remaining: 10, limit: 5000, reset }, { remaining: 4000, limit: 5000, reset: reset + 1800 }] });
    expect(rateLimits.get().graphql?.remaining).toBe(10);
    vi.advanceTimersByTime(600_000);
    expect(rateLimits.get().graphql).toEqual({ remaining: 4000, limit: 5000, reset: reset + 1800 });
  });

  it("ignores readings whose window already reset", () => {
    mergeRateLimits({ core: { remaining: 10, limit: 5000, reset: now / 1000 - 1 } });
    expect(rateLimits.get().core).toBeUndefined();
  });

  it("drops each window when it resets", () => {
    mergeRateLimits({ search: { remaining: 20, limit: 30, reset: now / 1000 + 60 }, core: { remaining: 10, limit: 5000, reset } });
    vi.advanceTimersByTime(60_000);
    expect(rateLimits.get()).toEqual({ core: { remaining: 10, limit: 5000, reset } });
    vi.advanceTimersByTime(540_000);
    expect(rateLimits.get()).toEqual({});
  });
});

describe("recordRateLimit", () => {
  it("merges the response's rate limit headers", () => {
    const headers = (remaining: number) =>
      new Headers({ "x-ratelimit-resource": "graphql", "x-ratelimit-remaining": String(remaining), "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(reset) });
    recordRateLimit(headers(4000));
    recordRateLimit(headers(4002));
    expect(rateLimits.get().graphql).toEqual({ remaining: 4000, limit: 5000, reset });
  });
});

describe("account changes", () => {
  it("clears the limits when another account signs in", () => {
    auth.set({ status: "signed-in", token: "a", viewer: viewer("alice") });
    mergeRateLimits({ core: { remaining: 10, limit: 5000, reset } });
    auth.set({ status: "signed-out", token: null, viewer: null, rejected: viewer("alice") });
    auth.set({ status: "signed-in", token: "a2", viewer: viewer("alice") });
    expect(rateLimits.get().core?.remaining).toBe(10);
    auth.set({ status: "signed-in", token: "b", viewer: viewer("bob") });
    expect(rateLimits.get()).toEqual({});
  });
});
