import { describe, expect, it } from "vitest";
import {
  baseQuery,
  buildSearch,
  fetchAtLeast,
  getQualifier,
  getState,
  kindSubset,
  mergeKinds,
  overlay,
  setQualifier,
  setState,
  sortKey,
  summarizeChecks,
  type ListData,
  type ListItem,
} from "./searchList";

const item = (id: string) => ({ id }) as ListItem;

/** A search whose results are `ids`, served `size` per page. */
function search(ids: string[], size: number) {
  const calls: (string | null)[] = [];
  const fetch = async (after: string | null): Promise<ListData> => {
    calls.push(after);
    const start = after ? Number(after) : 0;
    const end = Math.min(start + size, ids.length);
    return { items: ids.slice(start, end).map(item), total: ids.length, hasNextPage: end < ids.length, endCursor: String(end) };
  };
  return { fetch, calls };
}

describe("fetchAtLeast", () => {
  it("fetches only the first page when nothing more was loaded", async () => {
    const s = search(["a", "b", "c", "d"], 2);
    const data = await fetchAtLeast(s.fetch, 0);
    expect(data.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(s.calls).toEqual([null]);
  });

  it("refetches as many items as were loaded, so stale rows drop out", async () => {
    // Four rows were loaded before; "b" has since been closed and left the is:open results.
    const s = search(["a", "c", "d", "e", "f"], 2);
    const data = await fetchAtLeast(s.fetch, 4);
    expect(data.items.map((i) => i.id)).toEqual(["a", "c", "d", "e"]);
    expect(data).toMatchObject({ hasNextPage: true, endCursor: "4" });
  });

  it("stops at the end of the results", async () => {
    const s = search(["a", "c"], 2);
    const data = await fetchAtLeast(s.fetch, 4);
    expect(data.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(data.hasNextPage).toBe(false);
    expect(s.calls).toEqual([null]);
  });
});

describe("kindSubset", () => {
  const item = (id: string, __typename: "Issue" | "PullRequest") => ({ id, __typename }) as ListItem;
  const all: ListData = { items: [item("a", "Issue"), item("b", "PullRequest"), item("c", "Issue")], total: 30, hasNextPage: true, endCursor: "x" };

  it("keeps only the requested kind, in order", () => {
    expect(kindSubset(all, "issue")?.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(kindSubset(all, "pr")?.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("gives nothing when the loaded part has none of that kind but more exist", () => {
    expect(kindSubset({ ...all, items: [item("b", "PullRequest")] }, "issue")).toBeUndefined();
    expect(kindSubset({ ...all, items: [item("b", "PullRequest")], hasNextPage: false }, "issue")?.items).toEqual([]);
    expect(kindSubset(undefined, "pr")).toBeUndefined();
  });
});

describe("qualifiers", () => {
  it("reads plain and quoted values, skipping negated ones", () => {
    const q = `is:open label:bug label:"good first issue" -label:wontfix author:octocat`;
    expect(getQualifier(q, "label")).toEqual(["bug", "good first issue"]);
    expect(getQualifier(q, "author")).toEqual(["octocat"]);
    expect(getQualifier(q, "milestone")).toEqual([]);
  });

  it("replaces every value and quotes ones with spaces", () => {
    expect(setQualifier("is:open label:bug sort:created-asc", "label", ["good first issue", "docs"])).toBe(
      `is:open sort:created-asc label:"good first issue" label:docs`,
    );
    expect(setQualifier("is:open label:bug -label:x", "label", [])).toBe("is:open -label:x");
  });

  it("leaves kind tokens out of issue types", () => {
    expect(getQualifier("type:issue type:Bug", "type")).toEqual(["Bug"]);
    expect(setQualifier("type:issue type:Bug", "type", ["Feature request"])).toBe(`type:issue type:"Feature request"`);
  });
});

describe("summarizeChecks", () => {
  it("counts each check once, by its newest run", () => {
    const nodes = [
      { name: "build", conclusion: "FAILURE", databaseId: 1 },
      { name: "lint", conclusion: "SUCCESS", databaseId: 2 },
      { name: "build", conclusion: "SUCCESS", databaseId: 3 },
      { name: "test", conclusion: null, databaseId: 4 },
      { context: "ci/status", state: "SUCCESS", createdAt: "2024-01-02T00:00:00Z" },
      { context: "ci/status", state: "FAILURE", createdAt: "2024-01-01T00:00:00Z" },
      null,
    ];
    expect(summarizeChecks({ state: "PENDING", contexts: { nodes } })).toEqual({ state: "PENDING", passed: 3, total: 4 });
  });
});

describe("state", () => {
  it("reads is: and GitHub's state: syntax", () => {
    expect(getState("is:issue is:open label:bug")).toBe("open");
    expect(getState("is:issue state:open label:enhancement")).toBe("open");
    expect(getState("STATE:Closed")).toBe("closed");
    expect(getState("is:pr is:merged")).toBeNull();
    expect(getState("-state:open label:bug")).toBeNull();
    expect(getState("label:bug")).toBeNull();
  });

  it("toggles by replacing every state token", () => {
    expect(setState("is:issue state:open label:enhancement", "closed")).toBe("is:closed is:issue label:enhancement");
    expect(setState("state:closed is:open", "open")).toBe("is:open");
    expect(setState("is:pr is:merged", "open")).toBe("is:open is:pr");
  });

  it("counts across states for state: queries", () => {
    expect(baseQuery("is:issue state:open label:enhancement sort:updated-desc")).toBe("label:enhancement");
    expect(baseQuery("state:closed is:merged author:me")).toBe("author:me");
  });

  it("keeps state: queries consistent between the mixed list and a kind's list", () => {
    const q = "state:open label:enhancement";
    expect(buildSearch(q, { repo: "cli/cli", defaultSort: "created-desc" })).toBe("repo:cli/cli state:open label:enhancement (is:issue OR is:pr) sort:created-desc");
    expect(buildSearch(q, { repo: "cli/cli", kind: "issue", defaultSort: "created-desc" })).toBe("repo:cli/cli state:open label:enhancement is:issue sort:created-desc");
    const item = (id: string, __typename: "Issue" | "PullRequest", state: string) => ({ id, __typename, state }) as ListItem;
    const all: ListData = { items: [item("a", "Issue", "OPEN"), item("b", "PullRequest", "OPEN")], total: 2, hasNextPage: false, endCursor: null };
    expect(kindSubset(all, "issue")?.items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("mergeKinds", () => {
  const at = (id: string, day: number) => ({ id, createdAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z` }) as ListItem;
  const list = (items: ListItem[], hasNextPage: boolean): ListData => ({ items, total: items.length + (hasNextPage ? 10 : 0), hasNextPage, endCursor: null });
  const newest = sortKey("created")!;

  it("interleaves both lists through the last row both cover", () => {
    const issues = list([at("i9", 9), at("i5", 5), at("i2", 2)], true);
    const pulls = list([at("p8", 8), at("p4", 4)], true);
    expect(mergeKinds(issues, pulls, newest)?.items.map((i) => i.id)).toEqual(["i9", "p8", "i5", "p4"]);
  });

  it("keeps every row when both lists are complete", () => {
    const merged = mergeKinds(list([at("i1", 1)], false), list([at("p3", 3)], false), newest);
    expect(merged?.items.map((i) => i.id)).toEqual(["p3", "i1"]);
    expect(merged?.hasNextPage).toBe(false);
  });

  it("gives up when no row is certain", () => {
    expect(mergeKinds(list([at("i1", 1)], true), list([], true), newest)).toBeUndefined();
  });

  it("sorts oldest first for asc", () => {
    const merged = mergeKinds(list([at("i1", 1), at("i5", 5)], false), list([at("p3", 3)], false), sortKey("created-asc")!);
    expect(merged?.items.map((i) => i.id)).toEqual(["i1", "p3", "i5"]);
  });

  it("has no key for other sorts", () => {
    expect(sortKey("comments")).toBeUndefined();
    expect(sortKey(null)).toBeUndefined();
  });
});

describe("overlay", () => {
  const at = (id: string, day: number) => ({ id, updatedAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z` }) as ListItem;
  const list = (items: ListItem[], hasNextPage: boolean): ListData => ({ items, total: 20, hasNextPage, endCursor: "c" });
  const key = sortKey("updated")!;

  it("puts fresh rows on top and keeps older cached rows past them", () => {
    const fresh = list([at("a", 9), at("b", 7)], true);
    const cached = list([at("b", 6), at("c", 8), at("d", 3)], true);
    expect(overlay(fresh, cached, key).items.map((i) => i.id)).toEqual(["a", "b", "d"]);
  });

  it("uses a complete fresh list as is", () => {
    const fresh = list([at("a", 9)], false);
    expect(overlay(fresh, list([at("z", 1)], true), key)).toBe(fresh);
  });

  it("keeps the cached list without a sort key", () => {
    const cached = list([at("z", 1)], true);
    expect(overlay(list([at("a", 9)], true), cached, undefined)).toBe(cached);
  });
});
