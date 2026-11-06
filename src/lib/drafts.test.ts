import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  createStore: () => undefined,
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  clear: async () => db.clear(),
}));

const { drafts } = await import("./drafts");

describe("drafts", () => {
  beforeEach(() => {
    db.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("saves once typing pauses, keeping only the latest text", async () => {
    drafts.setSoon("k", "a");
    drafts.setSoon("k", "ab");
    await vi.advanceTimersByTimeAsync(300);
    expect(db.get("k")).toBe("ab");
  });

  it("drops a pending save when the draft is cleared", async () => {
    drafts.setSoon("k", "text");
    await drafts.clear("k");
    await vi.advanceTimersByTimeAsync(300);
    expect(db.has("k")).toBe(false);
  });

  it("drops pending saves on clearAll so sign-out can't be undone by a late write", async () => {
    drafts.setSoon("a", "one");
    drafts.setSoon("b", "two");
    await drafts.clearAll();
    await vi.advanceTimersByTimeAsync(300);
    expect(db.size).toBe(0);
  });
});
