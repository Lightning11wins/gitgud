import { describe, expect, it } from "vitest";
import { parseReference } from "./references";

describe("parseReference", () => {
  it("reads issue and pull request URLs", () => {
    expect(parseReference("https://github.com/LightSys/centrallix/pull/170")).toEqual({ owner: "LightSys", repo: "centrallix", number: 170 });
    expect(parseReference("https://github.com/cli/cli/issues/42")).toEqual({ owner: "cli", repo: "cli", number: 42 });
  });

  it("rejects links to comments and other pages", () => {
    expect(parseReference("https://github.com/cli/cli/issues/42#issuecomment-1")).toBeNull();
    expect(parseReference("https://github.com/cli/cli/pull/42/files")).toBeNull();
    expect(parseReference("https://example.com/cli/cli/issues/42")).toBeNull();
  });
});
