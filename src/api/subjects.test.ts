import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { findListRow, patchMeta, patchRow, syncSubjects, type ListRow } from "./subjects";

const row = (over: Partial<ListRow> = {}): ListRow => ({
  __typename: "Issue",
  id: "I1",
  number: 1,
  title: "Old",
  state: "OPEN",
  stateReason: null,
  updatedAt: "2026-01-01T00:00:00Z",
  repository: { nameWithOwner: "o/r" },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  ...over,
});

const meta = (over: Record<string, unknown> = {}) =>
  ({
    __typename: "Issue",
    id: "I1",
    title: "Old",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2026-01-01T00:00:00Z",
    labels: { nodes: [] },
    assignees: { nodes: [] },
    ...over,
  }) as Parameters<typeof patchMeta>[0];

describe("patchRow", () => {
  it("takes a newer row whole", () => {
    const next = row({ title: "New", updatedAt: "2026-01-02T00:00:00Z" });
    expect(patchRow(row(), { row: next })).toBe(next);
  });

  it("keeps the row when the other copy is older", () => {
    const r = row({ updatedAt: "2026-01-02T00:00:00Z" });
    expect(patchRow(r, { row: row() })).toBe(r);
    expect(patchRow(r, { meta: meta({ title: "Stale" }) })).toBe(r);
  });

  it("copies header fields from metadata at least as new", () => {
    const labels = { nodes: [{ name: "bug", color: "f00", description: null }] };
    const patched = patchRow(row(), { meta: meta({ title: "Edited", state: "CLOSED", stateReason: "COMPLETED", labels }) });
    expect(patched).toMatchObject({ title: "Edited", state: "CLOSED", stateReason: "COMPLETED", labels });
  });

  it("returns the same row when nothing differs", () => {
    const r = row();
    expect(patchRow(r, { meta: meta() })).toBe(r);
  });
});

describe("patchMeta", () => {
  it("takes the title and state of a newer row and keeps its own updatedAt", () => {
    const m = meta({ __typename: "PullRequest", merged: false });
    const patched = patchMeta(m, { row: row({ title: "New", state: "MERGED", updatedAt: "2026-01-02T00:00:00Z" }) });
    expect(patched).toMatchObject({ title: "New", state: "MERGED", merged: true, updatedAt: m.updatedAt });
  });

  it("ignores rows that are not newer", () => {
    const m = meta();
    expect(patchMeta(m, { row: row({ title: "Same time" }) })).toBe(m);
  });
});

describe("syncSubjects", () => {
  it("patches other cached copies and keeps their fetch time", () => {
    const client = new QueryClient();
    syncSubjects(client);
    client.setQueryData(["repo-list", "o", "r"], { items: [row()] }, { updatedAt: 1000 });
    client.setQueryData(["issue", "o", "r", 1], meta({ title: "Renamed", updatedAt: "2026-01-02T00:00:00Z" }));
    expect(client.getQueryData<{ items: ListRow[] }>(["repo-list", "o", "r"])?.items[0].title).toBe("Renamed");
    expect(client.getQueryState(["repo-list", "o", "r"])?.dataUpdatedAt).toBe(1000);
    expect(findListRow(client, "O", "R", 1)?.title).toBe("Renamed");
  });
});
