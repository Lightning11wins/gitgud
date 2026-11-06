import { describe, expect, it } from "vitest";
import { fetchAtLeast, getQualifier, kindSubset, setQualifier, type ListData, type ListItem } from "./searchList";

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
