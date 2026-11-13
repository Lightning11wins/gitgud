// @vitest-environment happy-dom
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navigate, openApp, reload, useFakeGitHub } from "./app";
import { fakeRepo } from "./world";

const github = useFakeGitHub();

describe("issue lists and pages", () => {
  it("lists the repository's open issues", async () => {
    const repo = fakeRepo(github());
    repo.addIssue({ title: "Crash on start" });
    repo.addIssue({ title: "Already fixed", state: "CLOSED", stateReason: "COMPLETED" });
    openApp("/acme/app");
    expect(await screen.findByText("Crash on start")).toBeTruthy();
    expect(screen.queryByText("Already fixed")).toBeNull();
  });

  it("shows a cached list after a reload before GitHub answers", async () => {
    const repo = fakeRepo(github());
    repo.addIssue({ title: "Crash on start" });
    openApp("/acme/app");
    await screen.findByText("Crash on start");
    github().hold("SearchList");
    await reload("/acme/app");
    expect(screen.getByText("Crash on start")).toBeTruthy();
  });

  it("shows an issue's header from its list row while the issue loads", async () => {
    const repo = fakeRepo(github());
    repo.addIssue({ title: "Crash on start" });
    openApp("/acme/app");
    await screen.findByText("Crash on start");
    github().hold("IssueMeta");
    await navigate("/acme/app/issues/1");
    expect(screen.getByRole("heading", { name: /Crash on start/ })).toBeTruthy();
  });

  it("shows a title edited on the issue page in the list without refetching it", async () => {
    const repo = fakeRepo(github());
    repo.addIssue({ title: "Crash on start" });
    openApp("/acme/app");
    await screen.findByText("Crash on start");
    await navigate("/acme/app/issues/1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Crash on launch" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    await screen.findByRole("heading", { name: /Crash on launch/ });
    github().hold("SearchList");
    await navigate("/acme/app");
    expect(await screen.findByText("Crash on launch")).toBeTruthy();
  });

  it("shows a newer list row's title on a cached issue page", async () => {
    const repo = fakeRepo(github());
    const issue = repo.addIssue({ title: "Crash on start" });
    openApp("/acme/app/issues/1");
    await screen.findByRole("heading", { name: /Crash on start/ });
    issue.title = "Crash on launch";
    repo.touch(issue);
    await navigate("/acme/app");
    await screen.findByText("Crash on launch");
    github().hold("IssueMeta");
    await navigate("/acme/app/issues/1");
    expect(await screen.findByRole("heading", { name: /Crash on launch/ })).toBeTruthy();
  });
});
