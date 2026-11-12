import { describe, expect, it } from "vitest";
import { placeTooltip, tooltip } from "./tooltip";

const viewport = { width: 1000, height: 800 };
const size = { width: 100, height: 24 };

describe("placeTooltip", () => {
  it("centers the tooltip below the element", () => {
    expect(placeTooltip({ top: 100, left: 200, width: 40, height: 20 }, size, viewport)).toEqual({ top: 124, left: 170, side: "below" });
  });

  it("goes above when it doesn't fit below", () => {
    expect(placeTooltip({ top: 760, left: 200, width: 40, height: 20 }, size, viewport)).toEqual({ top: 732, left: 170, side: "above" });
  });

  it("stays below when it fits neither way", () => {
    expect(placeTooltip({ top: 10, left: 200, width: 40, height: 780 }, size, viewport).side).toBe("below");
  });

  it("stays inside the viewport's sides", () => {
    expect(placeTooltip({ top: 100, left: 0, width: 20, height: 20 }, size, viewport).left).toBe(8);
    expect(placeTooltip({ top: 100, left: 980, width: 20, height: 20 }, size, viewport).left).toBe(892);
  });
});

describe("tooltip", () => {
  it("names the element with a label tooltip and describes it otherwise", () => {
    expect(tooltip("Copy", "label")).toEqual({ "data-tooltip": "Copy", "aria-label": "Copy" });
    expect(tooltip("3 comments")).toEqual({ "data-tooltip": "3 comments", "aria-description": "3 comments" });
  });

  it("adds nothing without text", () => {
    expect(tooltip(null)).toEqual({});
    expect(tooltip("")).toEqual({});
  });
});
