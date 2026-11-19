import { describe, expect, it } from "vitest";
import { parseEditorConfig, tabWidth } from "./editorconfig";

const width = (text: string, path: string) => tabWidth(parseEditorConfig(text), path);

describe("tabWidth", () => {
  it("reads tab_width, falling back to a numeric indent_size", () => {
    expect(width("[*]\ntab_width = 2", "a.c")).toBe(2);
    expect(width("[*]\nindent_size = 3", "a.c")).toBe(3);
    expect(width("[*]\nindent_size = 4\ntab_width = 8", "a.c")).toBe(8);
    expect(width("[*]\nindent_style = tab\nindent_size = tab", "a.c")).toBeUndefined();
    expect(width("[*]\nindent_style = space", "a.c")).toBeUndefined();
  });

  it("lets later sections override earlier ones and unset clear them", () => {
    const config = "root = true\n\n[*]\nindent_size = 4\n\n# Go\n[*.go]\nindent_size = tab\ntab_width = 8\n\n[Makefile]\nindent_size = unset\n";
    expect(width(config, "main.c")).toBe(4);
    expect(width(config, "cmd/main.go")).toBe(8);
    expect(width(config, "Makefile")).toBeUndefined();
  });

  it("matches globs without a slash at any depth and globs with one from the root", () => {
    const config = "[*.ts]\nindent_size = 2\n[lib/*.ts]\nindent_size = 4\n[/vendor/**]\nindent_size = 8";
    expect(width(config, "a.ts")).toBe(2);
    expect(width(config, "src/deep/a.ts")).toBe(2);
    expect(width(config, "lib/a.ts")).toBe(4);
    expect(width(config, "src/lib/a.ts")).toBe(2);
    expect(width(config, "vendor/x/y.c")).toBe(8);
    expect(width(config, "src/vendor/y.c")).toBeUndefined();
  });

  it("supports braces, brackets, question marks, and number ranges", () => {
    const config = "[*.{js,{c,h}}]\nindent_size = 2\n[file[0-9].txt]\nindent_size = 3\n[[!a]?.md]\nindent_size = 5\n[v{1..10}.txt]\nindent_size = 6\n[**/docs/*.rst]\nindent_size = 7";
    expect(width(config, "x.js")).toBe(2);
    expect(width(config, "x.h")).toBe(2);
    expect(width(config, "x.cc")).toBeUndefined();
    expect(width(config, "file7.txt")).toBe(3);
    expect(width(config, "filex.txt")).toBeUndefined();
    expect(width(config, "bc.md")).toBe(5);
    expect(width(config, "ab.md")).toBeUndefined();
    expect(width(config, "v10.txt")).toBe(6);
    expect(width(config, "v11.txt")).toBeUndefined();
    expect(width(config, "docs/a.rst")).toBe(7);
    expect(width(config, "a/docs/a.rst")).toBe(7);
  });

  it("matches special characters literally", () => {
    expect(width("[a+b (1).c]\nindent_size = 3", "a+b (1).c")).toBe(3);
    expect(width("[a.c]\nindent_size = 3", "abc")).toBeUndefined();
  });
});
