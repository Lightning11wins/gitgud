import { describe, expect, it } from "vitest";
import type { ReactionGroup } from "@/api/types";
import { reactorsLabel } from "./Reactions";

const group = (logins: string[], totalCount: number, viewerHasReacted = false): ReactionGroup => ({
  content: "THUMBS_UP",
  viewerHasReacted,
  reactors: { totalCount, nodes: logins.map((login) => ({ login })) },
});

describe("reactorsLabel", () => {
  it("names a single reactor", () => {
    expect(reactorsLabel({ ...group(["greptile-apps[bot]"], 1), content: "EYES" }, "me")).toBe("greptile-apps[bot] reacted with eyes emoji");
  });

  it("counts reactors beyond the fetched names", () => {
    expect(reactorsLabel(group(["alice", "bob"], 5), "me")).toBe("alice, bob, and 3 more reacted with thumbs up emoji");
  });

  it("puts the viewer first as You", () => {
    expect(reactorsLabel(group(["alice", "me"], 2, true), "me")).toBe("You and alice reacted with thumbs up emoji");
  });

  it("follows an optimistic toggle before the server's names arrive", () => {
    expect(reactorsLabel(group(["alice"], 2, true), "me")).toBe("You and alice reacted with thumbs up emoji");
    expect(reactorsLabel(group(["alice", "me"], 1, false), "me")).toBe("alice reacted with thumbs up emoji");
  });
});
