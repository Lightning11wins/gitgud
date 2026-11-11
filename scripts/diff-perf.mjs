// Benchmarks the Files changed tab on a production build. Each run uses a fresh browser profile and measures:
//   cold, warm   time to the first file header, diff rows, and syntax colors, and until every chunk is mounted
//   scroll       wheel-like scrolling from the top as soon as rows appear, while most chunks are still unmounted
//   interact     latency of collapsing, marking viewed, Collapse all, Hide whitespace, and typing a comment
// Prints the median of each metric over the runs. GitHub writes are stubbed out, so "Viewed" never changes.
//
// Usage: node scripts/diff-perf.mjs <app path> [--runs 3] [--cpu 1] [--only cold,warm,scroll,interact]
//          [--json out.json] [--baseline old.json] [--trace dir] [--dev]
//   --cpu N       slow the CPU N times (Chrome throttling), to approximate slower machines
//   --json        save every run's numbers; --baseline prints the change from a saved file
//   --trace dir   one extra traced run: saves a Chrome trace per scenario (open in DevTools > Performance)
//                 and prints where main-thread time went (script, style, layout, paint, GC)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const path = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!path) {
  console.error("Usage: node scripts/diff-perf.mjs <app path> [--runs 3] [--cpu 1] [--only ...] [--json out] [--baseline old] [--trace dir] [--dev]");
  process.exit(2);
}
const runs = Number(opt("runs", 3));
const cpu = Number(opt("cpu", 1));
const only = new Set(opt("only", "cold,warm,scroll,interact").split(","));
const traceDir = opt("trace");

const vite = await import("vite");
let server;
if (flag("dev")) {
  server = await vite.createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
} else {
  const outDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "gitgud-dist-"));
  await vite.build({ logLevel: "error", build: { outDir, sourcemap: false } });
  server = await vite.preview({ preview: { port: 0, host: "127.0.0.1" }, build: { outDir }, logLevel: "error" });
}
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const viewer = JSON.parse(execFileSync("gh", ["api", "user", "-q", "{login, name, avatarUrl: .avatar_url, url: .html_url}"], { encoding: "utf8" }));
const browser = await launchBrowser();

/** Runs in the page before the app: load milestones, long tasks, event timings, and stubbed GitHub writes. */
function pageInit() {
  const w = window;
  const p = (w.__perf = { start: 0, longTasks: [], events: [] });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => p.longTasks.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => p.events.push([e.startTime, e.duration, e.name, e.interactionId]))).observe({ type: "event", durationThreshold: 16 });
  const tick = () => {
    const now = performance.now();
    if (!p.firstFile && document.querySelector("section.df")) p.firstFile = now;
    if (!p.firstRows && document.querySelector(".dk")) p.firstRows = now;
    if (!p.firstColor && document.querySelector(".dk [class^='hl-']")) p.firstColor = now;
    if (p.firstRows && !p.allMounted && !document.querySelector(".dk-ph")) p.allMounted = now;
    if (!p.allMounted || !p.firstColor) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Benchmarks must not change anything on GitHub: GraphQL mutations succeed without being sent, other writes fail.
  const realFetch = w.fetch.bind(w);
  w.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.startsWith("https://api.github.com") && method !== "GET" && method !== "HEAD") {
      const isMutation = url.endsWith("/graphql") && /^\s*mutation\b/.test(JSON.parse(init?.body ?? "{}").query ?? "");
      if (url.endsWith("/graphql") && !isMutation) return realFetch(input, init);
      if (isMutation) return Promise.resolve(new Response(JSON.stringify({ data: {} }), { headers: { "content-type": "application/json" } }));
      return Promise.reject(new Error(`diff-perf blocked a GitHub write: ${method} ${url}`));
    }
    return realFetch(input, init);
  };
}

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(pageInit);
  await page.goto(base + "/settings");
  await page.evaluate(
    ([token, viewer]) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("gitgud-auth");
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readwrite");
          tx.objectStore("kv").put(token, "token");
          tx.objectStore("kv").put(viewer, "viewer");
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    [token, viewer],
  );
  if (cpu > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
  return page;
}

/** Sum of long tasks, and total blocking time (the part of each over 50ms), between two page timestamps. */
const blocking = (tasks, from, to = Infinity) => {
  const inside = tasks.filter(([s]) => s >= from && s < to);
  return { long: inside.reduce((a, [, d]) => a + d, 0), tbt: inside.reduce((a, [, d]) => a + Math.max(0, d - 50), 0) };
};

/** Waits until the main thread has had no long task for `quiet` ms (at most `max`), and returns the timestamp of the last one. */
const settle = (page, from, quiet = 500, max = 15000) =>
  page.evaluate(
    ([from, quiet, max]) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const check = () => {
          const last = window.__perf.longTasks.filter(([s]) => s >= from).reduce((a, [s, d]) => Math.max(a, s + d), from);
          const now = performance.now();
          if (now - Math.max(last, t0) >= quiet || now - t0 > max) resolve(last);
          else setTimeout(check, 50);
        };
        check();
      }),
    [from, quiet, max],
  );

async function load(page, label, out) {
  await page.goto(base + path);
  await page.waitForSelector(".dk", { timeout: 180000 });
  await page.waitForFunction(() => window.__perf.allMounted, null, { timeout: 180000, polling: 200 }).catch(() => console.log(`${label}: chunks still unmounted after 180s`));
  const p = await page.evaluate(() => window.__perf);
  out[`${label}.firstFile`] = p.firstFile;
  out[`${label}.firstRows`] = p.firstRows;
  out[`${label}.firstColor`] = p.firstColor;
  out[`${label}.allMounted`] = p.allMounted;
  const b = blocking(p.longTasks, 0, p.allMounted);
  out[`${label}.longTasks`] = b.long;
  out[`${label}.tbt`] = b.tbt;
}

/**
 * Scrolls down 20,000px at 5,000px/s from the top as soon as rows appear, with a compositor scroll gesture like
 * a mouse wheel: it keeps moving while the main thread is busy, so content that renders late shows as blank.
 */
async function scroll(page, out) {
  await page.goto(base + path);
  await page.waitForSelector(".dk", { timeout: 180000 });
  const files = await page.locator(".dv-files").boundingBox();
  const x = files.x + files.width / 2;
  await page.evaluate((x) => {
    const s = (window.__scroll = { from: performance.now(), deltas: [], blank: 0, stop: false });
    let last = s.from;
    const tick = () => {
      const now = performance.now();
      const d = now - last;
      last = now;
      s.deltas.push(d);
      // The time since the last frame counts as blank when an unmounted chunk's placeholder shows. Hit tests stay cheap however big the DOM is.
      if ([0.3, 0.6, 0.9].some((f) => document.elementFromPoint(x, innerHeight * f)?.classList.contains("dk-ph"))) s.blank += d;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, x);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(x), y: 500, yDistance: -20000, speed: 5000, gestureSourceType: "mouse" });
  const r = await page.evaluate(() => {
    const s = window.__scroll;
    s.stop = true;
    return { ...s, to: performance.now(), scrolled: scrollY };
  });
  await cdp.detach();
  const p = await page.evaluate(() => window.__perf);
  const d = r.deltas.sort((a, b) => a - b);
  out["scroll.blankMs"] = r.blank;
  out["scroll.frameP95"] = d[Math.floor(d.length * 0.95)];
  out["scroll.frameMax"] = d[d.length - 1];
  out["scroll.over50ms"] = d.filter((x) => x > 50).length;
  out["scroll.tbt"] = blocking(p.longTasks, r.from, r.to).tbt;
  if (Math.abs(r.scrolled - 20000) > 100) console.log(`scroll: moved ${Math.round(r.scrolled)}px, not 20000`);
}

/** Runs `act` and records its slowest event (input to next paint, like INP) and the main-thread blocking that follows. */
async function timeIt(page, out, name, act) {
  const from = await page.evaluate(() => performance.now());
  await act();
  const last = await settle(page, from);
  const p = await page.evaluate(() => window.__perf);
  out[`${name}.latency`] = p.events.filter(([s]) => s >= from).reduce((a, [, d]) => Math.max(a, d), 0);
  out[`${name}.tbt`] = blocking(p.longTasks, from, last + 1).tbt;
}

async function interact(page, out) {
  await page.goto(base + path);
  await page.waitForSelector(".dk", { timeout: 180000 });
  await page.waitForFunction(() => window.__perf.allMounted, null, { timeout: 180000, polling: 200 }).catch(() => {});
  await settle(page, 0, 1000);
  // A file a few screens down, so content sits above and below it.
  const target = await page.evaluate(() => {
    const files = [...document.querySelectorAll("section.df")];
    const f = files.find((s, i) => i >= Math.min(5, files.length - 1) && s.querySelector(".dk .dn[data-c][data-s='R']"));
    f?.scrollIntoView({ block: "start" });
    return f?.dataset.path;
  });
  if (!target) return console.log("interact: no file with commentable lines");
  await page.waitForTimeout(500);
  const file = page.locator(`section.df[data-path="${target}"]`);
  await timeIt(page, out, "collapseFile", () => file.locator("button[aria-label='Collapse file']").click());
  await timeIt(page, out, "expandFile", () => file.locator("button[aria-label='Expand file']").click());
  if (await file.locator(".df-viewed input").count()) {
    await timeIt(page, out, "markViewed", () => file.locator(".df-viewed input").click());
    await timeIt(page, out, "unmarkViewed", () => file.locator(".df-viewed input").click());
  }
  await timeIt(page, out, "collapseAll", () => page.locator("button[aria-label='Collapse all']").click());
  await timeIt(page, out, "expandAll", () => page.locator("button[aria-label='Expand all']").click());
  await timeIt(page, out, "hideWhitespace", () => page.locator(".dv-ws input").click());
  await timeIt(page, out, "showWhitespace", () => page.locator(".dv-ws input").click());

  await file.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  const num = file.locator(".dk .dn[data-c][data-s='R']").nth(10);
  await num.scrollIntoViewIfNeeded();
  const box = await num.boundingBox();
  await timeIt(page, out, "openCommentForm", async () => {
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForSelector(".new-thread textarea");
  });
  // Typing: per-keystroke latency at a steady pace, then how long a burst of 40 keys takes to show.
  const typeFrom = await page.evaluate(() => performance.now());
  await page.keyboard.type("steady typing test ", { delay: 50 });
  const keys = (await page.evaluate(() => window.__perf.events)).filter(([s, , n]) => s >= typeFrom && n === "keydown").map(([, d]) => d);
  // Keys under 16ms aren't reported by the Event Timing API.
  const typed = 19;
  const all = [...keys, ...Array(Math.max(0, typed - keys.length)).fill(16)].sort((a, b) => a - b);
  out["typing.keyP50"] = all[Math.floor(all.length * 0.5)];
  out["typing.keyMax"] = all[all.length - 1];
  // Keys sent back to back, like mashing the keyboard: time until the last one shows.
  const burst = "abcdefghijklmnopqrstuvwxyzabcdefghijklmn";
  const want = (await page.locator(".new-thread textarea").inputValue()).length + burst.length;
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.type(burst);
  out["typing.burst40"] = await page.evaluate(
    ([want, t0]) =>
      new Promise((resolve) => {
        const ta = document.querySelector(".new-thread textarea");
        const wait = () => (ta.value.length >= want ? requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0))) : setTimeout(wait, 5));
        wait();
      }),
    [want, t0],
  );
  await page.locator(".new-thread button", { hasText: "Cancel" }).click();
}

/** Main-thread self time in a Chrome trace, by kind of work. */
function breakdown(trace) {
  const events = (trace.traceEvents ?? trace).filter((e) => e.ph === "X" || e.ph === "M");
  const mains = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const kind = (n) =>
    /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|InvalidateLayout|StyleRecalc)/.test(n)
      ? "style"
      : /^(Layout|IntersectionObserver|UpdateLayer|ComputeIntersections)/.test(n)
        ? "layout"
        : /^(Paint|PrePaint|Layerize|Commit|CompositeLayers|PaintImage|Decode|RasterTask|UpdateLayerTree)/.test(n)
          ? "paint"
          : /GC|^BlinkGC|^V8\.GC/.test(n)
            ? "gc"
            : /^(FunctionCall|EvaluateScript|v8\.|V8\.|TimerFire|EventDispatch|FireAnimationFrame|RunMicrotasks|FireIdleCallback|ParseHTML|XHR|HandlePostMessage)/.test(n)
              ? "script"
              : "other";
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !mains.has(`${e.pid}:${e.tid}`) || !e.dur) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  const totals = { script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0 };
  for (const list of byThread.values()) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    const self = new Map();
    for (const e of list) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - e.dur);
      self.set(e, e.dur);
      stack.push(e);
    }
    // Top-level task wrappers (RunTask) count only their unexplained remainder, as "other".
    for (const [e, t] of self) totals[kind(e.name)] += Math.max(0, t) / 1000;
  }
  return totals;
}

const results = [];
const traced = !!traceDir;
for (let run = 0; run < runs + (traced ? 1 : 0); run++) {
  const tracing = traced && run === runs;
  const out = {};
  const page = await newPage();
  const traceAround = async (name, fn) => {
    if (!tracing) return fn();
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "v8.execute", "blink.user_timing"] });
    await fn();
    const buf = await browser.stopTracing();
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(join(traceDir, `${name}.json`), buf);
    const b = breakdown(JSON.parse(buf.toString()));
    console.log(`trace ${name}:`, Object.entries(b).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(", "), `(${join(traceDir, name + ".json")})`);
  };
  // The cold visit fills the cache that the later scenarios read.
  await traceAround("cold", () => load(page, "cold", out));
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (only.has("warm")) await traceAround("warm", () => load(page, "warm", out));
  if (only.has("scroll")) await traceAround("scroll", () => scroll(page, out));
  if (only.has("interact")) await traceAround("interact", () => interact(page, out));
  if (run === 0) {
    const dom = await page.evaluate(() => ({ files: document.querySelectorAll("section.df").length, chunks: document.querySelectorAll(".dk, .dk-ph").length, nodes: document.getElementsByTagName("*").length }));
    console.log("dom:", JSON.stringify(dom));
  }
  if (!only.has("cold")) for (const k of Object.keys(out)) if (k.startsWith("cold.")) delete out[k];
  await page.context().close();
  if (!tracing) {
    results.push(out);
    console.log(`run ${run + 1}/${runs} done`);
  }
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
};
const metrics = [...new Set(results.flatMap((r) => Object.keys(r)))];
const baseline = opt("baseline") ? JSON.parse(readFileSync(opt("baseline"), "utf8")) : null;
const fmt = (v) => (v === undefined ? "n/a" : Math.round(v).toString());
console.log(`\n${path}  cpu x${cpu}  median of ${results.length}${baseline ? `  vs ${opt("baseline")}` : ""}`);
for (const m of metrics) {
  const v = median(results.map((r) => r[m]));
  let line = `${m.padEnd(26)} ${fmt(v).padStart(7)}`;
  if (baseline) {
    const b = median(baseline.runs.map((r) => r[m]));
    if (b !== undefined && v !== undefined) line += `  was ${fmt(b).padStart(7)}  ${b ? `${v >= b ? "+" : ""}${Math.round(((v - b) / b) * 100)}%` : ""}`;
  }
  console.log(line);
}
const json = opt("json");
if (json) writeFileSync(json, JSON.stringify({ path, cpu, runs: results }, null, 1));
await browser.close();
await server.close?.();
process.exit(0);
