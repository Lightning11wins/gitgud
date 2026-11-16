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
});
