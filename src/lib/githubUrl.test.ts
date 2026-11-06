import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSettings } from "./settings";
import { toAppPath } from "./githubUrl";

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
});
