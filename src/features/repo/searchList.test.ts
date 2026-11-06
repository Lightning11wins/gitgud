import { describe, expect, it } from "vitest";
import { fetchAtLeast, type ListData, type ListItem } from "./searchList";

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
