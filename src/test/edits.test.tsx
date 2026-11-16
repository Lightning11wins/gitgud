// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invalidateSubject } from "@/features/conversation/mutations";
import { openApp, useFakeGitHub } from "./app";
import { fakeRepo } from "./world";

const github = useFakeGitHub();

/** Refetches the issue, as returning to the tab or a change made in the app does. */
const refetchIssue = () => act(() => invalidateSubject("issue", "acme", "app", 1));

const sidebarLabels = () => [...document.querySelectorAll(".sidebar-labels .label")].map((l) => l.textContent);

describe("edits open while GitHub changes the same field", () => {
  it("keeps labels GitHub changed while the labels menu was open, closed unchanged", async () => {
    const repo = fakeRepo(github());
    const bug = repo.addLabel("bug");
    const docs = repo.addLabel("docs");
    const issue = repo.addIssue({ labels: [bug] });
    openApp("/acme/app/issues/1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit labels" }));
    await screen.findByRole("option", { name: /docs/ });
    issue.labels = [bug, docs];
    repo.touch(issue);
    await refetchIssue();
    await waitFor(() => expect(sidebarLabels()).toEqual(["bug", "docs"]));
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(github().calls("UpdateIssueMeta")).toEqual([]);
    expect(sidebarLabels()).toEqual(["bug", "docs"]);
  });

  it("applies the user's label changes on top of labels GitHub changed while the menu was open", async () => {
    const repo = fakeRepo(github());
    const bug = repo.addLabel("bug");
    const docs = repo.addLabel("docs");
    repo.addLabel("ui");
    const issue = repo.addIssue({ labels: [bug] });
    openApp("/acme/app/issues/1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit labels" }));
    fireEvent.click(await screen.findByRole("option", { name: /ui/ }));
    issue.labels = [bug, docs];
    repo.touch(issue);
    await refetchIssue();
    await waitFor(() => expect(sidebarLabels()).toEqual(["bug", "docs"]));
    expect(screen.getByRole("option", { name: /docs/ }).getAttribute("aria-selected")).toBe("true");
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await waitFor(() => expect(issue.labels.map((l) => l.name).sort()).toEqual(["bug", "docs", "ui"]));
  });

  it("keeps a title GitHub changed while the title editor was open, saved unchanged", async () => {
    const repo = fakeRepo(github());
    const issue = repo.addIssue({ title: "Crash on start" });
    openApp("/acme/app/issues/1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit title" }));
    issue.title = "Crash on launch";
    repo.touch(issue);
    await refetchIssue();
    await waitFor(() => expect(document.title).toContain("Crash on launch"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(github().calls("UpdateIssueTitle")).toEqual([]);
    expect(await screen.findByRole("heading", { name: /Crash on launch/ })).toBeTruthy();
  });
});
