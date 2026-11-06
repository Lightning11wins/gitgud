/// <reference lib="webworker" />
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";

export type WorkerRequest = { type: "hl"; id: number; lang: string; code: string; pri: number } | { type: "pri"; id: number; pri: number } | { type: "cancel"; id: number };

/** `palette` holds new [class, lightColor, darkColor, fontStyle] entries. Line i's tokens are (length, class) pairs in data[starts[i]..starts[i+1]]. */
export type WorkerResponse = { id: number; palette: [number, string, string, number][]; starts: Uint32Array; data: Uint32Array } | { id: number; palette: []; starts: null; data: null };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let highlighter: Promise<HighlighterCore> | null = null;
const loading = new Map<string, Promise<boolean>>();

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [bundledThemes["github-light"](), bundledThemes["github-dark"]()],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

async function ensureLang(h: HighlighterCore, lang: string): Promise<boolean> {
  let p = loading.get(lang);
  if (!p) {
    const load = (bundledLanguages as Record<string, (() => Promise<{ default: unknown }>) | undefined>)[lang];
    p = load
      ? load()
          .then((m) => h.loadLanguage(m.default as Parameters<HighlighterCore["loadLanguage"]>[0]))
          .then(() => true, () => false)
      : Promise.resolve(false);
    loading.set(lang, p);
  }
  return p;
}

// Class 0 is the default text color, rendered without a span.
const palette = new Map<string, number>([["", 0]]);

function classOf(light: string, dark: string, style: number, fresh: [number, string, string, number][]): number {
  const key = `${light}|${dark}|${style}`;
  let c = palette.get(key);
  if (c === undefined) {
    c = palette.size;
    palette.set(key, c);
    fresh.push([c, light, dark, style]);
  }
  return c;
}

const DEFAULT_LIGHT = "#24292e";
const DEFAULT_DARK = "#e1e4e8";

async function highlight(lang: string, code: string): Promise<Omit<WorkerResponse, "id">> {
  const h = await getHighlighter();
  if (!(await ensureLang(h, lang))) return { palette: [], starts: null, data: null };
  const lines = h.codeToTokensWithThemes(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    tokenizeMaxLineLength: 1000,
    tokenizeTimeLimit: 200,
  });
  const fresh: [number, string, string, number][] = [];
  const starts = new Uint32Array(lines.length + 1);
  const out: number[] = [];
  lines.forEach((line, i) => {
    starts[i] = out.length;
    let prevClass = -1;
    for (const tok of line) {
      const l = tok.variants.light;
      const d = tok.variants.dark;
      const light = (l?.color ?? DEFAULT_LIGHT).toLowerCase();
      const dark = (d?.color ?? DEFAULT_DARK).toLowerCase();
      const style = l?.fontStyle && l.fontStyle > 0 ? l.fontStyle : 0;
      const c = light === DEFAULT_LIGHT && dark === DEFAULT_DARK && !style ? 0 : classOf(light, dark, style, fresh);
      if (c === prevClass) out[out.length - 2] += tok.content.length;
      else out.push(tok.content.length, c);
      prevClass = c;
    }
  });
  starts[lines.length] = out.length;
  return { palette: fresh, starts, data: Uint32Array.from(out) };
}

interface Job {
  id: number;
  lang: string;
  code: string;
  pri: number;
  seq: number;
}

const queue = new Map<number, Job>();
let seq = 0;
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (queue.size) {
    let best: Job | null = null;
    for (const j of queue.values()) if (!best || j.pri > best.pri || (j.pri === best.pri && j.seq > best.seq)) best = j;
    queue.delete(best!.id);
    let res: Omit<WorkerResponse, "id">;
    try {
      res = await highlight(best!.lang, best!.code);
    } catch {
      res = { palette: [], starts: null, data: null };
    }
    const msg = { id: best!.id, ...res } as WorkerResponse;
    scope.postMessage(msg, msg.starts ? [msg.starts.buffer, msg.data.buffer] : []);
    // Let newer, higher-priority requests arrive between jobs.
    await new Promise((r) => setTimeout(r, 0));
  }
  running = false;
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === "hl") queue.set(m.id, { id: m.id, lang: m.lang, code: m.code, pri: m.pri, seq: seq++ });
  else if (m.type === "pri") {
    const j = queue.get(m.id);
    if (j && m.pri > j.pri) {
      j.pri = m.pri;
      j.seq = seq++;
    }
  } else queue.delete(m.id);
  pump();
};
