// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = new Map<string, unknown>();
let failWrites = false;
const write = (fn: () => void) => async () => {
  if (failWrites) throw new Error("quota exceeded");
  fn();
};
vi.mock("idb-keyval", () => ({
  createStore: () => undefined,
  get: async (key: string) => db.get(key),
  set: (key: string, value: unknown) => write(() => db.set(key, value))(),
  del: (key: string) => write(() => db.delete(key))(),
  clear: () => write(() => db.clear())(),
}));

const { drafts, useDraftError } = await import("./drafts");

/** Whether leaving the page now would ask the user first. */
function leaveAsks(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("drafts", () => {
  beforeEach(() => {
    db.clear();
    failWrites = false;
    vi.useFakeTimers();
  });
  afterEach(async () => {
    failWrites = false;
    await drafts.clearAll();
    vi.useRealTimers();
  });

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

  it("reports a failed save, and asks before leaving, until a later save succeeds", async () => {
    const { result } = renderHook(() => useDraftError("k"));
    failWrites = true;
    await act(() => drafts.set("k", "text"));
    expect(result.current?.message).toBe("Failed to save your draft: quota exceeded");
    expect(leaveAsks()).toBe(true);
    failWrites = false;
    await act(() => drafts.set("k", "text"));
    expect(result.current).toBeUndefined();
    expect(leaveAsks()).toBe(false);
  });

  it("throws when clearAll can't erase the drafts", async () => {
    failWrites = true;
    await expect(drafts.clearAll()).rejects.toThrow("quota exceeded");
  });
});
