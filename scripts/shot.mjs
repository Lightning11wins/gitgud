// Opens an app path in headless Chromium, signed in with the gh CLI token, and saves a screenshot.
// Usage: node scripts/shot.mjs <path> [out.png] [--width 1400] [--height 900] [--dark] [--full]
// An out path ending in .pdf prints the page to PDF instead, as the browser's print dialog would.
// Starts its own Vite dev server unless BASE is set. Prints console errors, failed requests, and API stats.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(width|height|wait)$/));
const [path = "/", out = "shot.png"] = positional;
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
const page = await browser.newPage({
  viewport: { width: Number(opt("width", 1400)), height: Number(opt("height", 900)) },
  colorScheme: flag("dark") ? "dark" : "light",
});
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));
page.on("requestfailed", (r) => console.log("request failed:", r.url(), r.failure()?.errorText));

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
const t0 = Date.now();
await page.goto(base + path);
await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => console.log("networkidle timeout"));
await page.waitForTimeout(Number(opt("wait", 300)));
console.log(`loaded in ${Date.now() - t0}ms`);
if (out.endsWith(".pdf")) await page.pdf({ path: out, format: "Letter", margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" } });
else await page.screenshot({ path: out, fullPage: flag("full") });
const stats = await page.evaluate(() => {
  const s = globalThis.__gitgudApiStats;
  return s && { total: s.total, rest: s.rest, graphql: s.graphql, byName: s.byName };
});
console.log("api stats:", JSON.stringify(stats));
console.log("saved", out);
await browser.close();
await server?.close();
