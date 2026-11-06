import { describe, expect, it } from "vitest";
import { sample, shouldDrop, SHIFT_GRACE_MS, type ShiftState } from "./clickGuard";

const a = { closest: () => a } as unknown as Element;
const b = { closest: () => b } as unknown as Element;

function state(under: Element | null): ShiftState {
  return { x: 10, y: 10, under, shiftedAt: 0, arrived: null, inputAt: 0, movedAt: 0 };
}

describe("click guard", () => {
  it("drops a click on a control that just slid under a still pointer", () => {
    const s = state(a);
    sample(s, b, 1000);
    expect(shouldDrop(s, b, 1100, false)).toBe(true);
  });

  it("keeps clicks once the user has had time to see the change", () => {
    const s = state(a);
    sample(s, b, 1000);
    expect(shouldDrop(s, b, 1000 + SHIFT_GRACE_MS + 1, false)).toBe(false);
  });

  it("keeps clicks on the control the user aimed at", () => {
    const s = state(a);
    sample(s, a, 1000);
    expect(shouldDrop(s, a, 1100, false)).toBe(false);
  });

  it("keeps keyboard clicks", () => {
    const s = state(a);
    sample(s, b, 1000);
    expect(shouldDrop(s, b, 1100, true)).toBe(false);
  });

  it("ignores changes caused by the user's own input or pointer movement", () => {
    const clicked = { ...state(a), inputAt: 900 };
    sample(clicked, b, 1000);
    expect(shouldDrop(clicked, b, 1100, false)).toBe(false);
    const moved = { ...state(a), movedAt: 950 };
    sample(moved, b, 1000);
    expect(shouldDrop(moved, b, 1100, false)).toBe(false);
  });
});
