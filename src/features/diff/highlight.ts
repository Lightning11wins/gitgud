import { useEffect, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "./highlight.worker";

/** Syntax tokens for a block of lines: line i is (length, class) pairs in data[starts[i]..starts[i+1]]. */
export interface Tokens {
  starts: Uint32Array;
  data: Uint32Array;
}

export const PRI_IDLE = 0;
export const PRI_VISIBLE = 2;

interface Entry {
  id: number;
  /** Undefined while pending; null when the language isn't supported. */
  tokens: Tokens | null | undefined;
  pri: number;
  listeners: Set<() => void>;
  /** Mounted users near the viewport; their entries are never evicted. */
  holders: number;
}

const MAX_ENTRIES = 800;
const MAX_CHARS = 2_000_000;
const entries = new Map<string, Entry>();
const byId = new Map<number, Entry>();
let worker: Worker | null = null;
let nextId = 1;
let sheet: CSSStyleSheet | null = null;

function addPalette(items: [number, string, string, number][]) {
  if (!items.length) return;
  if (!sheet) {
    const el = document.createElement("style");
    el.dataset.gitgud = "highlight";
    document.head.appendChild(el);
    sheet = el.sheet!;
  }
  for (const [c, light, dark, style] of items) {
    const extra = `${style & 1 ? "font-style:italic;" : ""}${style & 2 ? "font-weight:600;" : ""}${style & 4 ? "text-decoration:underline;" : ""}`;
    sheet.insertRule(`.hl-${c}{color:${light};${extra}}`, sheet.cssRules.length);
    sheet.insertRule(`:root[data-theme="dark"] .hl-${c}{color:${dark}}`, sheet.cssRules.length);
    sheet.insertRule(`@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .hl-${c}{color:${dark}}}`, sheet.cssRules.length);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    addPalette(m.palette);
    const entry = byId.get(m.id);
    byId.delete(m.id);
    if (!entry) return;
    entry.tokens = m.starts ? { starts: m.starts, data: m.data } : null;
    entry.listeners.forEach((l) => l());
  };
  return worker;
}

const post = (m: WorkerRequest) => getWorker().postMessage(m);

function evict() {
  for (const [key, e] of entries) {
    if (entries.size <= MAX_ENTRIES) return;
    if (e.listeners.size || e.holders) continue;
    if (e.tokens === undefined) {
      post({ type: "cancel", id: e.id });
      byId.delete(e.id);
    }
    entries.delete(key);
  }
}

function request(key: string, lang: string, code: () => string, pri: number): Entry {
  let e = entries.get(key);
  if (e) {
    entries.delete(key);
    entries.set(key, e);
    if (e.tokens === undefined && pri > e.pri) {
      e.pri = pri;
      post({ type: "pri", id: e.id, pri });
    }
    return e;
  }
  e = { id: nextId++, tokens: undefined, pri, listeners: new Set(), holders: 0 };
  entries.set(key, e);
  const text = code();
  if (text.length > MAX_CHARS) e.tokens = null;
  else {
    byId.set(e.id, e);
    post({ type: "hl", id: e.id, lang, code: text, pri });
  }
  evict();
  return e;
}

/**
 * Tokens for `code` in `lang`, highlighted in a worker. Returns undefined until ready (render
 * plain text meanwhile) and null when the language isn't supported. Pass a null key to skip.
 */
export function useTokens(key: string | null, lang: string | null, code: () => string, pri: number): Tokens | null | undefined {
  const [, force] = useState(0);
  const entry = key && lang ? request(key, lang, code, pri) : null;
  const pending = entry?.tokens === undefined;
  const visible = pri >= PRI_VISIBLE;
  useEffect(() => {
    if (!entry || !visible) return;
    entry.holders++;
    return () => {
      entry.holders--;
    };
  }, [entry, visible]);
  useEffect(() => {
    if (!entry || !pending) return;
    const l = () => force((n) => n + 1);
    if (entry.tokens !== undefined) return l();
    entry.listeners.add(l);
    return () => {
      entry.listeners.delete(l);
    };
  }, [entry, pending]);
  return entry ? entry.tokens : null;
}
