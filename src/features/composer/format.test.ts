import { describe, expect, it } from "vitest";
import { pasteLink } from "./format";

describe("pasteLink", () => {
  const value = "See the docs for details.";
  const start = value.indexOf("the docs");
  const end = start + "the docs".length;

  it("links the selected text to a pasted URL", () => {
    const edit = pasteLink(value, start, end, "https://docs.github.com/en/rest\n")!;
    const result = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
    expect(result).toBe("See [the docs](https://docs.github.com/en/rest) for details.");
    expect(edit.selStart).toBe(edit.selEnd);
    expect(edit.selEnd).toBe(start + edit.text.length);
  });

  it("leaves plain pastes alone", () => {
    expect(pasteLink(value, start, start, "https://github.com")).toBeNull();
    expect(pasteLink(value, start, end, "the manual")).toBeNull();
    expect(pasteLink(value, start, end, "see https://github.com")).toBeNull();
  });

  it("lets a URL pasted over a URL replace it", () => {
    const v = "Go to https://example.com now";
    const s = v.indexOf("https");
    expect(pasteLink(v, s, s + "https://example.com".length, "https://github.com")).toBeNull();
  });
});
