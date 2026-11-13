// @vitest-environment happy-dom
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invalidateSubject } from "@/features/conversation/mutations";
import { openApp, useFakeGitHub } from "./app";
import { comment, fakeRepo } from "./world";

const github = useFakeGitHub();

/** Refetches the issue and its timeline, as returning to the tab or a change made in the app does. */
const refetchIssue = () => act(() => invalidateSubject("issue", "acme", "app", 1));

describe("issue timelines", () => {
  it("shows items GitHub inserted before the end of a short timeline", async () => {
    const repo = fakeRepo(github());
    const issue = repo.addIssue({ timeline: [comment("C1", "first comment"), comment("C2", "second comment")] });
    openApp("/acme/app/issues/1");
    await screen.findByText("second comment");
    // One item replaced by another before the end leaves every count unchanged.
    issue.timeline[0] = comment("C0", "inserted comment");
    repo.touch(issue);
    await refetchIssue();
    expect(await screen.findByText("inserted comment")).toBeTruthy();
    expect(screen.queryByText("first comment")).toBeNull();
  });

  it("fetches only what follows a long cached timeline", async () => {
    const repo = fakeRepo(github());
    const issue = repo.addIssue({ timeline: Array.from({ length: 150 }, (_, i) => comment(`C${i}`, `comment ${i}`)) });
    openApp("/acme/app/issues/1");
    await screen.findByText("comment 149");
    issue.timeline.push(comment("C150", "new comment"));
    repo.touch(issue);
    const before = github().calls("IssueTimeline").length;
    await refetchIssue();
    await screen.findByText("new comment");
    expect(github().calls("IssueTimeline").slice(before).map((c) => c.vars.after)).toEqual(["150"]);
  });
});
