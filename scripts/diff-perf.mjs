// Measures the Files changed tab: time to first diff rows (cold and warm cache), frame times while
// scrolling, long tasks, and API requests. Uses a production build served locally.
// Usage: node scripts/diff-perf.mjs <app path> [--out shot.png] [--dark] [--steps 600] [--px 60] [--dev]
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const path = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "/";
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

const proxyEnv = process.env.HTTPS_PROXY || process.env.https_proxy;
const proxyUrl = proxyEnv && new URL(proxyEnv);
const proxy = proxyUrl && {
  server: `${proxyUrl.protocol}//${proxyUrl.host}`,
  username: decodeURIComponent(proxyUrl.username),
  password: decodeURIComponent(proxyUrl.password),
  bypass: "localhost,127.0.0.1",
};
const browser = await chromium.launch({ proxy });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: flag("dark") ? "dark" : "light" });
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.addInitScript(() => {
  const w = window;
  w.__perf = { longTasks: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
  const tick = () => {
    if (!w.__perf.firstFile && document.querySelector("section.df")) w.__perf.firstFile = performance.now();
    if (!w.__perf.firstRows && document.querySelector(".dk")) w.__perf.firstRows = performance.now();
    if (!w.__perf.firstColor && document.querySelector(".dk [class^='hl-']")) w.__perf.firstColor = performance.now();
    if (!w.__perf.firstColor) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

if (proxy) await page.goto("https://api.github.com/zen").catch(() => {});
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

async function visit(label) {
  await page.goto(base + path);
  await page.waitForSelector(".dk", { timeout: 120000 });
  await page.waitForFunction(() => window.__perf.firstColor, null, { timeout: 30000 }).catch(() => {});
  const p = await page.evaluate(() => ({ ...window.__perf, longTasks: undefined }));
  const fmt = (v) => (v ? `${Math.round(v)}ms` : "n/a");
  console.log(`${label}: first file header ${fmt(p.firstFile)}, first diff rows ${fmt(p.firstRows)}, first highlighted ${fmt(p.firstColor)} (since navigation start)`);
}

await visit("cold");
await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
const stats = await page.evaluate(() => {
  const s = globalThis.__gitgudApiStats;
  return s && { total: s.total, rest: s.rest, graphql: s.graphql, byName: s.byName };
});
console.log("cold api stats:", JSON.stringify(stats));
// Let IndexedDB persistence settle before the warm visit.
await page.waitForTimeout(1500);
await visit("warm");
await page.waitForTimeout(1500);
const counts = await page.evaluate(() => ({
  files: document.querySelectorAll("section.df").length,
  chunks: document.querySelectorAll(".dk").length,
  placeholders: document.querySelectorAll(".dk-ph").length,
  cells: document.querySelectorAll(".dk > *").length,
  nodes: document.getElementsByTagName("*").length,
}));
console.log("dom after 1.5s:", JSON.stringify(counts));

async function scrollTest(label, steps, px) {
  return page.evaluate(
    async ([steps, px]) => {
      const start = window.__perf.longTasks.length;
      window.scrollTo(0, 0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const deltas = [];
      let last = performance.now();
      for (let i = 0; i < steps; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        window.scrollBy(0, px);
      }
      deltas.sort((a, b) => a - b);
      const sum = deltas.reduce((a, b) => a + b, 0);
      return {
        frames: deltas.length,
        avg: +(sum / deltas.length).toFixed(1),
        p50: +deltas[Math.floor(deltas.length * 0.5)].toFixed(1),
        p95: +deltas[Math.floor(deltas.length * 0.95)].toFixed(1),
        p99: +deltas[Math.floor(deltas.length * 0.99)].toFixed(1),
        max: +deltas[deltas.length - 1].toFixed(1),
        over20: deltas.filter((d) => d > 20).length,
        over33: deltas.filter((d) => d > 33.4).length,
        scrolled: Math.round(window.scrollY),
        longTasks: window.__perf.longTasks.slice(start),
      };
    },
    [steps, px],
  ).then((r) => console.log(`${label}:`, JSON.stringify(r)));
}

const steps = Number(opt("steps", 600));
const px = Number(opt("px", 60));
await scrollTest(`scroll ${steps} frames x ${px}px`, steps, px);
await scrollTest(`fast scroll ${steps / 2} frames x ${px * 4}px`, steps / 2, px * 4);
const finalCounts = await page.evaluate(() => ({
  chunks: document.querySelectorAll(".dk").length,
  placeholders: document.querySelectorAll(".dk-ph").length,
  nodes: document.getElementsByTagName("*").length,
  height: document.documentElement.scrollHeight,
}));
console.log("dom after scrolling:", JSON.stringify(finalCounts));
const out = opt("out");
if (out) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out });
  console.log("saved", out);
}
await browser.close();
await server.close?.();
await new Promise((r) => server.httpServer?.close?.(r) ?? r());
process.exit(0);
