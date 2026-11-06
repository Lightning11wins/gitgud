// Checks prefetching, list stand-ins, seeded pages, and the click guard on a public repo (read-only).
// Usage: node scripts/prefetch-flows.mjs [owner/repo] [outDir]
// Starts its own Vite dev server unless BASE is set. Prints GraphQL errors, request counts per step, and timings.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [slug = "cli/cli", outDir = process.env.TMPDIR ?? "/tmp"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
let server;
if (!process.env.BASE) {
  const { createServer } = await import("vite");
  server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
}
const base = process.env.BASE ?? server.resolvedUrls.local[0].replace(/\/$/, "");
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));
const started = Date.now();
if (process.env.VERBOSE) {
  page.on("request", (r) => {
    if (!r.url().startsWith("https://api.github.com")) return;
    const op = /query (\w+)/.exec(r.postData() ?? "")?.[1] ?? r.url().replace("https://api.github.com", "");
    console.log(`  +${Date.now() - started}ms ${op}`);
  });
}
page.on("response", async (r) => {
  if (!r.url().endsWith("/graphql") || r.request().method() !== "POST") return;
  const body = await r.json().catch(() => null);
  const op = /query (\w+)/.exec(r.request().postData() ?? "")?.[1];
  if (body?.errors) console.log(`GraphQL errors in ${op}:`, JSON.stringify(body.errors).slice(0, 400));
});

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

const stats = () => page.evaluate(() => ({ ...globalThis.__gitgudApiStats.byName }));
let last = {};
async function step(name) {
  const now = await stats();
  const delta = Object.fromEntries(Object.entries(now).flatMap(([k, v]) => (v - (last[k] ?? 0) ? [[k, v - (last[k] ?? 0)]] : [])));
  console.log(`+${Date.now() - started}ms ${name}:`, JSON.stringify(delta));
  last = now;
}
// Waits until no GitHub request has been in flight for 500ms. (Playwright's networkidle only covers the first load.)
let inFlight = 0;
let idleSince = Date.now();
page.on("request", (r) => r.url().startsWith("https://api.github.com") && inFlight++);
for (const ev of ["requestfinished", "requestfailed"]) {
  page.on(ev, (r) => r.url().startsWith("https://api.github.com") && --inFlight === 0 && (idleSince = Date.now()));
}
async function settle() {
  const end = Date.now() + 30000;
  await page.waitForTimeout(100);
  while (inFlight > 0 || Date.now() - idleSince < 500) {
    if (Date.now() > end) return console.log("settle timeout");
    await page.waitForTimeout(100);
  }
}
const row = (i) => page.locator(".list-row").nth(i);

// 1. The All list, then its top rows warm in the background.
await page.goto(`${base}/${slug}`);
await row(0).waitFor();
await settle();
await page.waitForTimeout(1500);
await settle();
await step("open All list");

// 2. The Issues tab shows the All list's issues at once.
let t = Date.now();
await page.click(".tabs a:has-text('Issues')");
await row(0).waitFor();
console.log(`Issues tab first row after ${Date.now() - t}ms`);
await page.screenshot({ path: `${outDir}/issues-tab.png` });
await settle();
await step("Issues tab");

// 3. Hovering a row prefetches its page.
await page.click(".tabs a:has-text('Pull requests')");
await row(3).waitFor();
// The tab shows borrowed rows at once; wait for its own list so the hovered row stays put.
await settle();
await step("Pull requests tab");
await row(3).hover();
await page.waitForTimeout(400);
await settle();
await step("hover PR row 3");

// 4. Opening it shows the seeded or cached page at once.
t = Date.now();
await row(3).locator("[data-row-link]").click();
await page.locator(".pull-title").waitFor();
console.log(`PR title after ${Date.now() - t}ms`);
await page.locator(".pull-tabs").waitFor();
console.log(`PR tabs after ${Date.now() - t}ms`);
await settle();
await page.waitForTimeout(2500);
await settle();
await step("open PR (and idle files prefetch)");
await page.screenshot({ path: `${outDir}/pull.png` });

// 5. A row that slides under a still pointer can't be clicked right away.
await page.goBack();
await row(5).waitFor();
await settle();
const box = await row(2).locator("[data-row-link]").boundingBox();
await page.mouse.move(box.x + 20, box.y + box.height / 2);
await page.waitForTimeout(300);
const before = page.url();
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.style.height = "56px";
  document.querySelector(".lr-body")?.parentElement?.prepend(spacer);
});
await page.waitForTimeout(250);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);
console.log(`click right after shift ${page.url() === before ? "dropped" : "went through (bad)"}`);
await page.waitForTimeout(700);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);
console.log(`click after the grace period ${page.url() !== before ? "went through" : "dropped (bad)"}`);

await browser.close();
await server?.close();
