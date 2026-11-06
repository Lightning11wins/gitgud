import { describe, expect, it } from "vitest";
import { structuredPatch } from "diff";
import { buildRows, expandGap, parsePatch, gapSize, type GapExpansion } from "./model";

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
      const rows = buildRows(hunks, exp, newL, false, true);
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
    const rows = buildRows(hunks, {}, [], false, true);
    expect(rows.filter((r) => r.r === "l").length).toBe(3);
    expect(gapSize(hunks, 1, 0)).toBe(0);
  });
});
