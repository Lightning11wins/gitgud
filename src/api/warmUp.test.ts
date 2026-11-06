import { describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({ createStore: () => undefined, get: async () => undefined, set: async () => {}, del: async () => {}, clear: async () => {} }));

const { planWarmUp } = await import("./warmUp");

const now = 1_700_000_000_000;
const limit = (used: number, resetIn: number) => ({ used, remaining: 5000 - used, limit: 5000, reset: (now + resetIn) / 1000 });

describe("planWarmUp", () => {
  it("warms limits with no window and checks again when the first window resets", () => {
    const plan = planWarmUp({ core: limit(0, 3_600_000), graphql: limit(10, 600_000), search: limit(0, 60_000) }, now);
    expect(plan.warm).toEqual(["core"]);
    expect(plan.checkAt).toBe(now + 602_000);
  });

  it("waits an hour after warming every limit", () => {
    const plan = planWarmUp({ core: limit(0, 3_600_000), graphql: limit(0, 3_600_000) }, now);
    expect(plan.warm).toEqual(["core", "graphql"]);
    expect(plan.checkAt).toBe(now + 3_602_000);
  });

  it("waits at least a minute when a reset is already past", () => {
    expect(planWarmUp({ core: limit(5, -10_000), graphql: limit(5, 1000) }, now)).toEqual({ warm: [], checkAt: now + 60_000 });
  });

  it("retries later when GitHub reports no limits", () => {
    expect(planWarmUp({}, now)).toEqual({ warm: [], checkAt: now + 300_000 });
  });
});
