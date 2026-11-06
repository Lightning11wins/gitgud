import { describe, expect, it } from "vitest";
import { structuredPatch } from "diff";
import { buildRows, expandGap, ignoreWhitespace, parsePatch, gapSize, type GapExpansion, type Hunk, type Row } from "./model";

function rand(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function ghPatch(a: string, b: string) {
  const p = structuredPatch("a", "b", a, b, "", "", { context: 3 });
  return p.hunks.map((h: any) => {
    const os = h.oldLines === 0 ? h.oldStart - 1 : h.oldStart;
    const ns = h.newLines === 0 ? h.newStart - 1 : h.newStart;
    return `@@ -${os},${h.oldLines} +${ns},${h.newLines} @@\n${h.lines.join("\n")}`;
  }).join("\n");
}

describe("expand", () => {
  for (let s = 1; s < 300; s++) {
    it("reconstructs files " + s, () => {
      const r = rand(s);
      const n = Math.floor(r() * 120);
      const oldL = Array.from({ length: n }, (_, i) => `l${i}`);
      const newL: string[] = [];
      for (const l of oldL) {
        const x = r();
        if (x < 0.04) continue;
        if (x < 0.08) newL.push(l + "x");
        else newL.push(l);
        if (r() < 0.03) newL.push("add" + r());
      }
      const a = oldL.map((l) => l + "\n").join("");
      const b = newL.map((l) => l + "\n").join("");
      const patch = ghPatch(a, b);
      const hunks = parsePatch(patch);
      if (!hunks.length) return;
      let exp: Record<number, GapExpansion> = {};
      for (let iter = 0; iter < 200; iter++) {
        let any = false;
        for (let g = 0; g <= hunks.length; g++) {
          if (gapSize(hunks, g, newL.length, exp[g]) > 0) {
            const dir = r() < 0.4 ? "up" : r() < 0.7 ? "down" : "all";
            const d = g === 0 && dir === "down" ? "up" : g === hunks.length && dir === "up" ? "down" : dir;
            exp = { ...exp, [g]: expandGap(hunks, g, newL.length, exp[g], d as any) };
            any = true;
          }
        }
        if (!any) break;
      }
      const rows = buildRows(hunks, exp, newL, true);
      const L: string[] = [];
      const R: string[] = [];
      for (const row of rows) {
        if (row.r !== "l") { if (row.r === "h") expect(row.up || row.down || row.all).toBe(false); continue; }
        if (row.L) { expect(row.L.n).toBe(L.length + 1); L.push(row.L.t); }
        if (row.R) { expect(row.R.n).toBe(R.length + 1); R.push(row.R.t); }
      }
      expect(L).toEqual(oldL);
      expect(R).toEqual(newL);
    });
  }
  it("emptied file", () => {
    const hunks = parsePatch("@@ -1,3 +0,0 @@\n-a\n-b\n-c");
    const rows = buildRows(hunks, {}, [], true);
    expect(rows.filter((r) => r.r === "l").length).toBe(3);
    expect(gapSize(hunks, 1, 0)).toBe(0);
  });
});

/** Expands every gap fully. */
function expandAll(hunks: Hunk[], headLen: number) {
  const exp: Record<number, GapExpansion> = {};
  for (let g = 0; g <= hunks.length; g++) if (gapSize(hunks, g, headLen) > 0) exp[g] = expandGap(hunks, g, headLen, undefined, "all");
  return exp;
}

function sides(rows: Row[]) {
  const L: string[] = [];
  const R: string[] = [];
  for (const row of rows) {
    if (row.r !== "l") continue;
    if (row.L) {
      expect(row.L.n).toBe(L.length + 1);
      L.push(row.L.t);
    }
    if (row.R) {
      expect(row.R.n).toBe(R.length + 1);
      R.push(row.R.t);
    }
  }
  return { L, R };
}

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
const text = (l: string[]) => l.map((x) => x + "\n").join("");

describe("ignoreWhitespace", () => {
  it("shows whitespace-only changes as context with both texts", () => {
    const oldL = lines(9, (i) => `line${i}`);
    const newL = oldL.map((l, i) => (i === 3 ? "  " + l : i === 5 ? l + "!" : l));
    const hunks = ignoreWhitespace(parsePatch(ghPatch(text(oldL), text(newL))));
    expect(hunks.length).toBe(1);
    const rows = buildRows(hunks, {}, newL, true).filter((r) => r.r === "l");
    const ws = rows.find((r) => r.R?.n === 4)!;
    expect(ws).toMatchObject({ L: { n: 4, t: "line3", k: 0 }, R: { n: 4, t: "  line3", k: 0 }, c: true });
    const real = rows.filter((r) => r.L?.k || r.R?.k);
    expect(real.map((r) => [r.L?.n, r.R?.n])).toEqual([[6, 6]]);
  });

  it("drops hunks with only whitespace changes and keeps the rest numbered", () => {
    const oldL = lines(60, (i) => `x${i}`);
    const newL = oldL.map((l, i) => (i === 5 ? "\t" + l : i === 40 ? l + "y" : l));
    const raw = parsePatch(ghPatch(text(oldL), text(newL)));
    expect(raw.length).toBe(2);
    const hunks = ignoreWhitespace(raw);
    expect(hunks.length).toBe(1);
    expect(hunks[0]).toMatchObject({ oldStart: 38, oldLines: 7, newStart: 38, newLines: 7 });
    expect(gapSize(hunks, 0, newL.length)).toBe(37);
    const { L, R } = sides(buildRows(hunks, expandAll(hunks, newL.length), newL, true));
    expect(R).toEqual(newL);
    expect(L.length).toBe(oldL.length);
  });

  it("trims context around real changes inside a whitespace-changed run", () => {
    const oldL = lines(30, (i) => `a${i}`);
    const newL = oldL.map((l, i) => (i >= 5 && i < 20 ? "  " + l : i === 20 ? "changed" : l));
    const hunks = ignoreWhitespace(parsePatch(ghPatch(text(oldL), text(newL))));
    expect(hunks.length).toBe(1);
    expect(hunks[0]).toMatchObject({ oldStart: 18, oldLines: 7, newStart: 18, newLines: 7 });
    expect(hunks[0].lines.map((l) => l.type).join("")).toBe("   -+   ");
    expect(hunks[0].lines[0]).toMatchObject({ text: "  a17", oldText: "a17", old: 18, new: 18 });
  });

  it("keeps a blank line added between whitespace changes", () => {
    const oldL = ["a", "b", "c"];
    const newL = [" a", "", " b", "c"];
    const hunks = ignoreWhitespace(parsePatch(ghPatch(text(oldL), text(newL))));
    const changed = hunks.flatMap((h) => h.lines.filter((l) => l.type !== " "));
    expect(changed).toEqual([{ type: "+", text: "", old: 0, new: 2 }]);
  });

  it("returns nothing for a file with only whitespace changes", () => {
    const oldL = lines(10, (i) => `w${i}`);
    expect(ignoreWhitespace(parsePatch(ghPatch(text(oldL), text(oldL.map((l) => l + " ")))))).toEqual([]);
  });

  for (let s = 1; s < 200; s++) {
    it("keeps patch lines, numbering, and expansion " + s, () => {
      const r = rand(s * 7919);
      const oldL = lines(Math.floor(r() * 150), (i) => `v${i % 7} ${i}`);
      const newL: string[] = [];
      for (const l of oldL) {
        const x = r();
        if (x < 0.03) continue;
        if (x < 0.12) newL.push("  " + l.replace(" ", "\t"));
        else if (x < 0.15) newL.push(l + "z");
        else newL.push(l);
        if (r() < 0.02) newL.push(r() < 0.5 ? "" : "new" + r());
      }
      const raw = parsePatch(ghPatch(text(oldL), text(newL)));
      const hunks = ignoreWhitespace(raw);
      const original = new Set(raw.flatMap((h) => h.lines.map((l) => `${l.old}:${l.new}`)));
      const key = (l: { old: number; new: number; type: string }) => (l.type === " " ? null : `${l.old}:${l.new}`);
      let prevEnd = 0;
      for (const h of hunks) {
        expect(h.lines.some((l) => l.type !== " ")).toBe(true);
        let o = h.oldStart;
        let n = h.newStart;
        for (const l of h.lines) {
          if (l.type !== "+") expect(l.old).toBe(o++);
          if (l.type !== "-") expect(l.new).toBe(n++);
          const k = key(l);
          if (k) expect(original.has(k)).toBe(true);
          if (l.type === " " && l.oldText !== undefined) expect(l.oldText.replace(/\s+/g, "")).toBe(l.text.replace(/\s+/g, ""));
        }
        expect(o - h.oldStart).toBe(h.oldLines);
        expect(n - h.newStart).toBe(h.newLines);
        expect(h.newStart).toBeGreaterThan(prevEnd);
        prevEnd = h.newStart + h.newLines - 1;
      }
      if (!hunks.length) return;
      const { L, R } = sides(buildRows(hunks, expandAll(hunks, newL.length), newL, true));
      expect(R).toEqual(newL);
      expect(L.map((t) => t.replace(/\s+/g, ""))).toEqual(oldL.map((t) => t.replace(/\s+/g, "")));
    });
  }
});
