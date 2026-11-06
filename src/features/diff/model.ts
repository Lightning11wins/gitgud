import { diffArrays, diffWordsWithSpace, structuredPatch } from "diff";

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

/** One changed file, trimmed from the REST files/commit/compare responses. */
export interface DiffFile {
  filename: string;
  previous_filename?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  sha: string | null;
}

export function trimFile(f: DiffFile): DiffFile {
  const out: DiffFile = { filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes, sha: f.sha };
  if (f.previous_filename) out.previous_filename = f.previous_filename;
  if (f.patch !== undefined) out.patch = f.patch;
  return out;
}

export interface HunkLine {
  /** " " context, "-" deletion, "+" addition. */
  type: " " | "-" | "+";
  text: string;
  /** Old text of a context line whose whitespace changed. */
  oldText?: string;
  old: number;
  new: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: HunkLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split("\n")) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      cur = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], section: m[5], lines: [] };
      hunks.push(cur);
      o = cur.oldStart;
      n = cur.newStart;
      continue;
    }
    if (!cur) continue;
    const c = raw[0];
    const text = raw.slice(1).replace(/\r$/, "");
    if (c === "+") cur.lines.push({ type: "+", text, old: 0, new: n++ });
    else if (c === "-") cur.lines.push({ type: "-", text, old: o++, new: 0 });
    else if (c === " " || (c === undefined && raw === "" && o < cur.oldStart + cur.oldLines)) cur.lines.push({ type: " ", text, old: o++, new: n++ });
  }
  return hunks;
}

/** Diffs two file versions client-side into hunks with 3 lines of context. */
export function diffContents(oldText: string, newText: string): Hunk[] {
  const p = structuredPatch("a", "b", oldText, newText, "", "", { context: 3 });
  return p.hunks.map((h) => {
    const lines = h.lines.filter((l) => l[0] !== "\\").map((l) => l[0] + l.slice(1));
    const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
    return parsePatch(`${header}\n${lines.join("\n")}`)[0];
  });
}

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export function isBinaryText(text: string): boolean {
  return text.slice(0, 8000).includes("\0");
}

/** Kind of a diff cell: context, deletion, addition. */
export const CTX = 0;
export const DEL = 1;
export const ADD = 2;

export interface Cell {
  n: number;
  t: string;
  k: 0 | 1 | 2;
  /** The cell on the other side of a changed line pair, for word highlighting. */
  p?: Cell;
}

export type Row =
  /** A code line. `c` marks lines inside the diff, which accept comments. */
  | { r: "l"; L?: Cell; R?: Cell; c: boolean }
  /** A hunk header or expander for the gap before hunk `gap` (gap === hunks.length is the end of the file). */
  | { r: "h"; gap: number; text: string; up: boolean; down: boolean; all: boolean };

/** Lines shown from the top (after the previous hunk) and bottom (before the next hunk) of a gap. */
export interface GapExpansion {
  top: number;
  bottom: number;
}

export const EXPAND_STEP = 20;

interface Gap {
  start: number;
  /** Inclusive; Infinity while the file length is unknown. */
  end: number;
  offset: number;
}

function gapOf(hunks: Hunk[], g: number, headLen: number | undefined): Gap {
  if (g === hunks.length) {
    const last = hunks[g - 1];
    // An empty new file's hunk is "+0,0"; the gap after it still starts at line 1.
    const start = last.newStart + Math.max(1, last.newLines);
    return { start, end: headLen ?? Infinity, offset: last.oldStart + last.oldLines - start };
  }
  const h = hunks[g];
  const prev = hunks[g - 1];
  const start = prev ? prev.newStart + prev.newLines : 1;
  return { start, end: h.newStart - 1, offset: h.oldStart - h.newStart };
}

/** Number of hidden lines in gap `g`, or Infinity when unknown. */
export function gapSize(hunks: Hunk[], g: number, headLen: number | undefined, exp?: GapExpansion): number {
  const gap = gapOf(hunks, g, headLen);
  return Math.max(0, gap.end - gap.start + 1 - (exp ? exp.top + exp.bottom : 0));
}

function pushBlock(rows: Row[], dels: HunkLine[], adds: HunkLine[]) {
  for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
    const L: Cell | undefined = dels[i] && { n: dels[i].old, t: dels[i].text, k: DEL };
    const R: Cell | undefined = adds[i] && { n: adds[i].new, t: adds[i].text, k: ADD };
    if (L && R) {
      L.p = R;
      R.p = L;
    }
    rows.push({ r: "l", L, R, c: true });
  }
}

const norm = (s: string) => s.replace(/\s+/g, "");

/** Pairs a block's deletions with additions equal but for whitespace, which become context lines. */
function matchWhitespace(out: HunkLine[], dels: HunkLine[], adds: HunkLine[]) {
  if (!dels.length || !adds.length || dels.length * adds.length > 250_000) {
    out.push(...dels, ...adds);
    return;
  }
  let di = 0;
  let ai = 0;
  for (const part of diffArrays(dels.map((l) => norm(l.text)), adds.map((l) => norm(l.text)))) {
    const count = part.value.length;
    if (part.removed) out.push(...dels.slice(di, (di += count)));
    else if (part.added) out.push(...adds.slice(ai, (ai += count)));
    else
      for (let i = 0; i < count; i++, di++, ai++) {
        const d = dels[di];
        const a = adds[ai];
        out.push(d.text === a.text ? { type: " ", text: a.text, old: d.old, new: a.new } : { type: " ", text: a.text, oldText: d.text, old: d.old, new: a.new });
      }
  }
}

/**
 * Hunks as `git diff -w` shows them: lines whose only change is whitespace become context,
 * context is trimmed to `context` lines around the remaining changes, and hunks left without
 * changes are dropped. Every line kept is a line of the original patch.
 */
export function ignoreWhitespace(hunks: Hunk[], context = 3): Hunk[] {
  const out: Hunk[] = [];
  for (const h of hunks) {
    const lines: HunkLine[] = [];
    let dels: HunkLine[] = [];
    let adds: HunkLine[] = [];
    for (const l of h.lines) {
      if (l.type === "-" && adds.length) {
        matchWhitespace(lines, dels, adds);
        dels = [];
        adds = [];
      }
      if (l.type === "-") dels.push(l);
      else if (l.type === "+") adds.push(l);
      else {
        matchWhitespace(lines, dels, adds);
        dels = [];
        adds = [];
        lines.push(l);
      }
    }
    matchWhitespace(lines, dels, adds);

    // Old and new line numbers at each line, counting from the hunk start.
    const oldAt: number[] = [];
    const newAt: number[] = [];
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of lines) {
      oldAt.push(o);
      newAt.push(n);
      if (l.type !== "+") o++;
      if (l.type !== "-") n++;
    }
    const changed = lines.flatMap((l, i) => (l.type === " " ? [] : [i]));
    for (let c = 0; c < changed.length; ) {
      let last = c;
      while (last + 1 < changed.length && changed[last + 1] - changed[last] - 1 <= 2 * context) last++;
      const from = Math.max(0, changed[c] - context);
      const to = Math.min(lines.length - 1, changed[last] + context);
      const slice = lines.slice(from, to + 1);
      const oldLines = slice.filter((l) => l.type !== "+").length;
      const newLines = slice.filter((l) => l.type !== "-").length;
      out.push({
        oldStart: oldLines ? oldAt[from] : oldAt[from] - 1,
        oldLines,
        newStart: newLines ? newAt[from] : newAt[from] - 1,
        newLines,
        section: h.section,
        lines: slice,
      });
      c = last + 1;
    }
  }
  return out;
}

/**
 * Flattens hunks into split-view rows: hunk headers with expanders, expanded context
 * from `head` (the new file's lines), and paired deletion/addition lines.
 */
export function buildRows(hunks: Hunk[], expansion: Record<number, GapExpansion>, head: string[] | undefined, canExpand: boolean): Row[] {
  const rows: Row[] = [];
  const ctx = (gap: Gap, from: number, to: number) => {
    for (let n = from; n <= to; n++) {
      const t = head![n - 1] ?? "";
      rows.push({ r: "l", L: { n: n + gap.offset, t, k: CTX }, R: { n, t, k: CTX }, c: false });
    }
  };
  const gapRows = (g: number) => {
    const gap = gapOf(hunks, g, head?.length);
    const exp = expansion[g] ?? { top: 0, bottom: 0 };
    const size = gap.end - gap.start + 1;
    const remaining = Math.max(0, size - exp.top - exp.bottom);
    if (head && exp.top) ctx(gap, gap.start, Math.min(gap.end, gap.start + exp.top - 1));
    const h = hunks[g];
    const text = h ? `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.section ? " " + h.section : ""}` : "";
    if (remaining > 0 && canExpand) {
      const last = g === hunks.length;
      const small = remaining <= EXPAND_STEP;
      rows.push({ r: "h", gap: g, text, up: !last && !small, down: g > 0 && !small, all: small });
    } else if (h && (size <= 0 || remaining > 0)) {
      rows.push({ r: "h", gap: g, text, up: false, down: false, all: false });
    }
    if (head && exp.bottom) ctx(gap, Math.max(gap.start + exp.top, gap.end - exp.bottom + 1), gap.end);
  };

  hunks.forEach((h, g) => {
    gapRows(g);
    let dels: HunkLine[] = [];
    let adds: HunkLine[] = [];
    const flush = () => {
      if (dels.length || adds.length) pushBlock(rows, dels, adds);
      dels = [];
      adds = [];
    };
    for (const l of h.lines) {
      if (l.type === "-") {
        if (adds.length) flush();
        dels.push(l);
      } else if (l.type === "+") adds.push(l);
      else {
        flush();
        rows.push({ r: "l", L: { n: l.old, t: l.oldText ?? l.text, k: CTX }, R: { n: l.new, t: l.text, k: CTX }, c: true });
      }
    }
    flush();
  });
  if (hunks.length && canExpand) gapRows(hunks.length);
  return rows;
}

/** Applies an expand action to gap `g`. */
export function expandGap(hunks: Hunk[], g: number, headLen: number, prev: GapExpansion | undefined, dir: "up" | "down" | "all"): GapExpansion {
  const cur = prev ?? { top: 0, bottom: 0 };
  const remaining = gapSize(hunks, g, headLen, cur);
  if (dir === "all" || remaining <= EXPAND_STEP) return g === hunks.length ? { top: cur.top + remaining, bottom: cur.bottom } : { top: cur.top, bottom: cur.bottom + remaining };
  return dir === "down" ? { top: cur.top + EXPAND_STEP, bottom: cur.bottom } : { top: cur.top, bottom: cur.bottom + EXPAND_STEP };
}

/** The lines of one side of the patch, for highlighting: text plus the line number of each. */
export function sideLines(hunks: Hunk[], side: "L" | "R"): { text: string; nums: Int32Array } {
  const texts: string[] = [];
  const nums: number[] = [];
  for (const h of hunks)
    for (const l of h.lines) {
      if (side === "L" ? l.type === "+" : l.type === "-") continue;
      texts.push(l.text);
      nums.push(side === "L" ? l.old : l.new);
    }
  return { text: texts.join("\n"), nums: Int32Array.from(nums) };
}

const MAX_WORD_DIFF = 400;
const wordCache = new WeakMap<Cell, [number, number][] | null>();

/** Character ranges of `cell` that differ from its paired line, or null when nothing useful to mark. */
export function wordRanges(cell: Cell): [number, number][] | null {
  const other = cell.p;
  if (!other) return null;
  const hit = wordCache.get(cell);
  if (hit !== undefined) return hit;
  let mine: [number, number][] | null = null;
  let theirs: [number, number][] | null = null;
  if (cell.t.length <= MAX_WORD_DIFF && other.t.length <= MAX_WORD_DIFF) {
    const [a, b] = cell.k === DEL ? [cell.t, other.t] : [other.t, cell.t];
    const del: [number, number][] = [];
    const add: [number, number][] = [];
    let pa = 0;
    let pb = 0;
    let common = 0;
    for (const part of diffWordsWithSpace(a, b)) {
      const len = part.value.length;
      if (part.removed) del.push([pa, (pa += len)]);
      else if (part.added) add.push([pb, (pb += len)]);
      else {
        pa += len;
        pb += len;
        common += part.value.trim().length;
      }
    }
    if (common > 0) {
      mine = cell.k === DEL ? del : add;
      theirs = cell.k === DEL ? add : del;
    }
  }
  wordCache.set(cell, mine);
  wordCache.set(other, theirs);
  return mine;
}

const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock|Podfile\.lock|pubspec\.lock|mix\.lock)$|\.min\.(js|css)$|\.map$|\.snap$/;

export const LARGE_DIFF_LINES = 1000;

/** Why a file's diff starts hidden behind "Load diff", or null. */
export function hiddenReason(f: DiffFile): string | null {
  if (f.status === "removed") return "This file was deleted.";
  if (GENERATED.test(f.filename)) return "Some generated files are not rendered by default.";
  if (f.additions + f.deletions > LARGE_DIFF_LINES) return "Large diffs are not rendered by default.";
  return null;
}

export function isGenerated(path: string): boolean {
  return GENERATED.test(path);
}
