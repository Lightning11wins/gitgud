import { describe, expect, it } from "vitest";
import { narrowList } from "./localSearch";
import type { ListData, ListItem } from "./searchList";

const SOURCE = "repo:acme/app is:open (is:issue OR is:pr) sort:updated-desc";

function row(id: string, fields: { pr?: boolean; draft?: boolean; labels?: string[]; author?: string; assignees?: string[] } = {}): ListItem {
  return {
    __typename: fields.pr ? "PullRequest" : "Issue",
    id,
    state: "OPEN",
    isDraft: fields.draft,
    labels: { nodes: (fields.labels ?? []).map((name) => ({ id: `L_${name}`, name, color: "d73a4a", description: null })) },
    author: { login: fields.author ?? "octo", avatarUrl: "" },
    assignees: { nodes: (fields.assignees ?? []).map((login) => ({ id: `U_${login}`, login })) },
  } as ListItem;
}

const list = (items: ListItem[], hasNextPage = true): ListData => ({ items, total: 500, hasNextPage, endCursor: "Y3Vyc29yOjUw" });

const ids = (data: ListData | undefined) => data?.items.map((i) => i.id);

describe("narrowList", () => {
  const rows = [
    row("a", { pr: true, labels: ["ai-review"] }),
    row("b", { labels: ["bug", "Good First Issue"], assignees: ["mona"] }),
    row("c", { pr: true, draft: true, author: "hubot" }),
    row("d", { labels: ["bug"] }),
  ];

  it("keeps the matching rows in order, through the cached list's end", () => {
    const narrowed = narrowList(list(rows), SOURCE, `repo:acme/app is:open label:bug (is:issue OR is:pr) sort:updated-desc`);
    expect(ids(narrowed)).toEqual(["b", "d"]);
    expect(narrowed?.hasNextPage).toBe(true);
  });

  it("narrows a mixed list to one kind", () => {
    expect(ids(narrowList(list(rows), SOURCE, "repo:acme/app is:open is:pr sort:updated-desc"))).toEqual(["a", "c"]);
  });

  it("matches labels by name, ignoring case, with quotes and comma for either", () => {
    const search = (label: string) => ids(narrowList(list(rows), SOURCE, `${SOURCE} ${label}`));
    expect(search(`label:"good first issue"`)).toEqual(["b"]);
    expect(search(`label:"ai-review"`)).toEqual(["a"]);
    expect(search("label:ai-review,bug")).toEqual(["a", "b", "d"]);
    expect(search("-label:bug")).toEqual(["a", "c"]);
    expect(search("no:label")).toEqual(["c"]);
  });

  it("matches authors, assignees, and drafts", () => {
    const search = (q: string) => ids(narrowList(list(rows), SOURCE, `${SOURCE} ${q}`));
    expect(search("author:Hubot")).toEqual(["c"]);
    expect(search("assignee:mona")).toEqual(["b"]);
    expect(search("no:assignee is:issue")).toEqual(["d"]);
    expect(search("is:draft")).toEqual(["c"]);
  });

  it("gives nothing for what rows can't answer", () => {
    for (const extra of ["crash", "review:required", "author:@me", "author:app/dependabot", "label:bug OR label:docs", "constructor:x"]) {
      expect(narrowList(list(rows), SOURCE, `${SOURCE} ${extra}`), extra).toBeUndefined();
    }
  });

  it("gives nothing unless the search keeps every source token, including its sort", () => {
    expect(narrowList(list(rows), SOURCE, "repo:acme/app is:open label:bug sort:created-desc")).toBeUndefined();
    expect(narrowList(list(rows), SOURCE, "repo:acme/app is:closed label:bug")).toBeUndefined();
  });

  it("narrows a source with free text", () => {
    const source = `${SOURCE} crash`;
    expect(ids(narrowList(list(rows), source, `${source} label:bug`))).toEqual(["b", "d"]);
  });

  it("gives nothing when no cached row matches but more exist", () => {
    expect(narrowList(list(rows), SOURCE, `${SOURCE} label:docs`)).toBeUndefined();
    expect(ids(narrowList(list(rows, false), SOURCE, `${SOURCE} label:docs`))).toEqual([]);
  });
});
