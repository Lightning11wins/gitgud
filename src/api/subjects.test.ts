import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { findListRow, patchCopy, syncSubjects } from "./subjects";
import type { SubjectHeader } from "./types";

const header = (over: Partial<SubjectHeader> = {}): SubjectHeader => ({
  __typename: "Issue",
  id: "I1",
  number: 1,
  title: "Old",
  url: "https://github.com/o/r/issues/1",
  state: "OPEN",
  stateReason: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  repository: { nameWithOwner: "o/r" },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  ...over,
});

const row = (over: Partial<SubjectHeader> = {}) => ({ kind: "row" as const, data: header(over) });
const meta = (over: Partial<SubjectHeader> = {}) => ({ kind: "meta" as const, data: header(over) });
const LATER = "2026-01-02T00:00:00Z";
const bug = { nodes: [{ id: "L1", name: "bug", color: "f00", description: null }] };

describe("patchCopy", () => {
  it("takes a newer row whole", () => {
    const next = row({ title: "New", updatedAt: LATER });
    expect(patchCopy(row(), next)).toBe(next.data);
  });

  it("keeps a copy when the other one is older", () => {
    const r = row({ updatedAt: LATER });
    expect(patchCopy(r, row())).toBe(r.data);
    expect(patchCopy(r, meta({ title: "Stale" }))).toBe(r.data);
  });

  it("gives a row the header and updatedAt of metadata at least as new", () => {
    const patched = patchCopy(row(), meta({ title: "Edited", state: "CLOSED", stateReason: "COMPLETED", labels: bug }));
    expect(patched).toMatchObject({ title: "Edited", state: "CLOSED", stateReason: "COMPLETED", labels: bug });
    expect(patchCopy(row(), meta({ updatedAt: LATER })).updatedAt).toBe(LATER);
  });

  it("returns the same copy when nothing differs", () => {
    const r = row();
    expect(patchCopy(r, meta())).toBe(r.data);
  });

  it("gives metadata the header of a newer row and keeps its own updatedAt", () => {
    const m = meta({ __typename: "PullRequest", isDraft: true });
    const patched = patchCopy(m, row({ __typename: "PullRequest", title: "New", state: "MERGED", isDraft: false, labels: bug, updatedAt: LATER }));
    expect(patched).toMatchObject({ title: "New", state: "MERGED", isDraft: false, labels: bug, updatedAt: m.data.updatedAt });
  });

  it("ignores rows that are not newer than metadata", () => {
    const m = meta();
    expect(patchCopy(m, row({ title: "Same time" }))).toBe(m.data);
  });
});

describe("syncSubjects", () => {
  it("patches other cached copies and keeps their fetch time", () => {
    const client = new QueryClient();
    syncSubjects(client);
    client.setQueryData(["repo-list", "o", "r"], { items: [header()] }, { updatedAt: 1000 });
    client.setQueryData(["issue", "o", "r", 1], header({ title: "Renamed", updatedAt: LATER }));
    expect(client.getQueryData<{ items: SubjectHeader[] }>(["repo-list", "o", "r"])?.items[0].title).toBe("Renamed");
    expect(client.getQueryState(["repo-list", "o", "r"])?.dataUpdatedAt).toBe(1000);
    expect(findListRow(client, "O", "R", 1)?.title).toBe("Renamed");
  });
});
