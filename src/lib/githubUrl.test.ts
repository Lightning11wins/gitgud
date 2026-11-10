import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSettings } from "./settings";
import { isValidName, toAppPath } from "./githubUrl";

vi.stubGlobal("location", { origin: "http://localhost" });

describe("toAppPath", () => {
  beforeEach(() => updateSettings({ repoTab: "all" }));

  it("opens repos on the All tab by default", () => {
    expect(toAppPath("cli/cli")).toBe("/cli/cli");
    expect(toAppPath("https://github.com/cli/cli/")).toBe("/cli/cli");
  });

  it("opens repos on the default tab", () => {
    updateSettings({ repoTab: "pulls" });
    expect(toAppPath("cli/cli")).toBe("/cli/cli/pulls");
    expect(toAppPath("https://github.com/cli/cli")).toBe("/cli/cli/pulls");
    expect(toAppPath("cli/cli#12")).toBe("/cli/cli/issues/12");
    expect(toAppPath("https://github.com/cli/cli/issues")).toBe("/cli/cli/issues");
    expect(toAppPath("/cli/cli?q=is%3Aclosed")).toBe("/cli/cli?q=is%3Aclosed");
  });

  it("rejects names that could change an API path", () => {
    expect(toAppPath("https://github.com/cli/cli%23/issues/1")).toBeNull();
    expect(toAppPath("https://github.com/cli/cli%3Fx%2F/pulls")).toBeNull();
    expect(toAppPath("/cli%2F..%2F..%2Fuser/x/issues")).toBeNull();
  });
});

describe("isValidName", () => {
  it("accepts GitHub owner and repo names", () => {
    for (const name of ["cli", "vercel", "next.js", "my_repo-2", ".github"]) expect(isValidName(name)).toBe(true);
  });

  it("rejects other names", () => {
    for (const name of ["", ".", "..", "a%2Fb", "a#b", "a?b", "a b", "a/b"]) expect(isValidName(name)).toBe(false);
  });
});
