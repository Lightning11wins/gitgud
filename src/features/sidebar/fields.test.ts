import { describe, expect, it } from "vitest";
import { shownFields, type IssueField, type RepoIssueFields } from "./data";

const field = (id: string): IssueField => ({ id, name: id, dataType: "TEXT", description: null });
const fields = ["priority", "start", "target", "effort"].map(field);
const value = (id: string) => ({ __typename: "IssueFieldTextValue", field: { id }, value: "x" });

describe("shownFields", () => {
  const repo: RepoIssueFields = { fields, pinned: { "": ["priority"], bug: ["effort", "priority"], task: [] } };
  const names = (typeId: string | undefined, values = [] as ReturnType<typeof value>[]) => shownFields(repo, typeId, values).map((f) => f.id);

  it("shows the type's pins in pin order", () => expect(names("bug")).toEqual(["effort", "priority"]));
  it("uses the no-type pins for issues without a type", () => expect(names(undefined)).toEqual(["priority"]));
  it("adds unpinned fields that have a value", () => expect(names("bug", [value("target")])).toEqual(["effort", "priority", "target"]));
  it("shows nothing for a type with no pins and no values", () => expect(names("task")).toEqual([]));
  it("shows every field when no pins are visible", () =>
    expect(shownFields({ fields, pinned: { "": [], bug: [] } }, "bug", []).map((f) => f.id)).toEqual(["priority", "start", "target", "effort"]));
  it("skips values for fields the repo doesn't list", () => expect(names("task", [value("gone")])).toEqual([]));
});
