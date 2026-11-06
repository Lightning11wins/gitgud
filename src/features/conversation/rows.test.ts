import { describe, expect, it } from "vitest";
import { buildRows, EVENT_GROUP_MS, rowHasAnchor, type Row } from "./rows";
import type { TimelineItem } from "./types";

const T0 = Date.parse("2026-07-27T12:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const event = (id: string, __typename: string, login = "octocat", ms = 0) =>
  ({ __typename, id, actor: { login, avatarUrl: "", url: "" }, createdAt: at(ms) }) as TimelineItem;
const comment = (id: string, databaseId: number) => ({ __typename: "IssueComment", id, databaseId, createdAt: at(0) }) as unknown as TimelineItem;

const shape = (rows: Row[]) =>
  rows.map((r) => (r.type === "events" ? r.events.map((e) => e.id) : r.type === "item" ? r.item.id : r.type));

describe("buildRows event groups", () => {
  it("folds adjacent label changes by one actor into one row", () => {
    const rows = buildRows([event("a", "LabeledEvent"), event("b", "LabeledEvent", "octocat", 1000), event("c", "UnlabeledEvent", "octocat", 2000)]);
    expect(shape(rows)).toEqual([["a", "b", "c"]]);
    expect(rows[0].key).toBe("a");
  });

  it("folds review requests and assignments, but not into each other", () => {
    const rows = buildRows([
      event("r1", "ReviewRequestedEvent"),
      event("r2", "ReviewRequestedEvent"),
      event("r3", "ReviewRequestRemovedEvent"),
      event("a1", "AssignedEvent"),
      event("a2", "UnassignedEvent"),
    ]);
    expect(shape(rows)).toEqual([["r1", "r2", "r3"], ["a1", "a2"]]);
  });

  it("keeps a single event as an item row", () => {
    expect(shape(buildRows([event("a", "LabeledEvent"), event("b", "AssignedEvent")]))).toEqual(["a", "b"]);
  });

  it("splits on another actor, an item in between, or a gap past the window", () => {
    expect(shape(buildRows([event("a", "LabeledEvent", "x"), event("b", "LabeledEvent", "y")]))).toEqual(["a", "b"]);
    expect(shape(buildRows([event("a", "LabeledEvent"), comment("c", 1), event("b", "LabeledEvent")]))).toEqual(["a", "c", "b"]);
    const late = buildRows([event("a", "LabeledEvent"), event("b", "LabeledEvent", "octocat", 1000), event("c", "LabeledEvent", "octocat", EVENT_GROUP_MS + 1)]);
    expect(shape(late)).toEqual([["a", "b"], "c"]);
  });

  it("does not fold events without an actor", () => {
    const ghost = (id: string) => ({ ...event(id, "LabeledEvent"), actor: null }) as TimelineItem;
    expect(shape(buildRows([ghost("a"), ghost("b")]))).toEqual(["a", "b"]);
  });

  it("reuses an unchanged group row and replaces one that grew", () => {
    const items = [event("a", "LabeledEvent"), event("b", "LabeledEvent")];
    const first = buildRows(items);
    expect(buildRows([...items], first)[0]).toBe(first[0]);
    const grown = buildRows([...items, event("c", "LabeledEvent")], first);
    expect(grown[0]).not.toBe(first[0]);
    expect(shape(grown)).toEqual([["a", "b", "c"]]);
  });
});

describe("rowHasAnchor", () => {
  it("finds every event folded into a row and comments by database id", () => {
    const [group, c] = buildRows([event("a", "LabeledEvent"), event("b", "LabeledEvent"), comment("c", 42)]);
    expect(rowHasAnchor(group, "event-a")).toBe(true);
    expect(rowHasAnchor(group, "event-b")).toBe(true);
    expect(rowHasAnchor(group, "event-c")).toBe(false);
    expect(rowHasAnchor(c, "issuecomment-42")).toBe(true);
    expect(rowHasAnchor(c, "pullrequestreview-42")).toBe(false);
  });
});
