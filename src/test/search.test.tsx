// @vitest-environment happy-dom
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navigate, openApp, useFakeGitHub } from "./app";
import { fakeRepo } from "./world";

const github = useFakeGitHub();

describe("repo list search", () => {
  it("hides the previous search's counts until the new ones arrive", async () => {
    const repo = fakeRepo(github());
    repo.addIssue({ title: "Crash on start" });
    repo.addIssue({ title: "Typo in docs" });
    openApp("/acme/app");
    const tab = () => screen.getByRole("link", { name: /^Issues/ });
    await within(tab()).findByText("2");
    const release = github().hold("RepoCounts");
    await navigate("/acme/app?q=is%3Aopen+label%3Abug");
    expect(within(tab()).queryByText("2")).toBeNull();
    expect(within(tab()).getByRole("status", { name: "Loading count" })).toBeTruthy();
    await act(async () => release());
    expect(await within(tab()).findByText("2")).toBeTruthy();
  });

  it("shows cached rows matching a narrower search before GitHub answers", async () => {
    const repo = fakeRepo(github());
    const bug = { id: "L_1", name: "bug", color: "d73a4a", description: null };
    repo.addIssue({ title: "Crash on start", labels: [bug] });
    repo.addIssue({ title: "Typo in docs" });
    openApp("/acme/app");
    await screen.findByText("Typo in docs");
    github().hold("SearchList");
    await navigate("/acme/app?q=is%3Aopen+label%3Abug");
    expect(screen.getByText("Crash on start")).toBeTruthy();
    expect(screen.queryByText("Typo in docs")).toBeNull();
  });
});
