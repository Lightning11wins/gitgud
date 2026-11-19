import { describe, expect, it } from "vitest";
import { dependencyNumbers } from "./dependencies";

describe("dependencyNumbers", () => {
  it("finds every PR a body depends on, in order, once each", () => {
    const body = "Adds the export button.\n\nDepends on #12\ndepends on #9 and Depends on #12.\n\nFixes #30";
    expect(dependencyNumbers(body)).toEqual([12, 9]);
  });

  it("finds none without the phrase", () => {
    expect(dependencyNumbers("Follow-up to #12. Dependson #4, depends on 5")).toEqual([]);
  });
});
