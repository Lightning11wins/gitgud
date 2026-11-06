// Drives the PR pages in headless Chromium, signed in with the gh CLI token, saving screenshots per step.
// Usage: node scripts/pull-flows.mjs <scenario> <outDir> [--dark]
// Scenarios: read (cli/cli checks, commits, tabs), sandbox (reviewers, title, draft), merge, compare.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const [scenario = "read", outDir = "flows"] = argv.filter((a) => !a.startsWith("--"));
const dark = argv.includes("--dark");
const param = (name, def) => process.env[name] ?? def;
mkdirSync(outDir, { recursive: true });

const { createServer } = await import("vite");
const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: dark ? "dark" : "light" });
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));

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

let n = 0;
const stats = () => page.evaluate(() => ({ ...globalThis.__gitgudApiStats, reset: undefined }));
const resetStats = () => page.evaluate(() => globalThis.__gitgudApiStats.reset());
const shot = async (name, full = false) => {
  const file = `${outDir}/${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log("saved", file);
};
const idle = () => page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => console.log("networkidle timeout"));
const go = async (path) => {
  await page.goto(base + path);
  await idle();
};
const click = async (selector) => {
  await page.locator(selector).first().click();
  await page.waitForTimeout(300);
  await idle();
};

try {
  if (scenario === "read") {
    const pr = param("PR", "/cli/cli/pull/14957");
    await go(pr);
    console.log("cold load:", JSON.stringify(await stats()));
    await shot("conversation");
    await click("text=Show all checks");
    await shot("checks-expanded", true);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    await shot("sticky");
    await resetStats();
    await click(".pull-tabs >> text=Checks");
    await shot("checks-tab", true);
    await page.hover(".pull-tabs >> text=Commits");
    await page.waitForTimeout(800);
    await click(".pull-tabs >> text=Commits");
    await shot("commits-tab", true);
    await click(".commit-row .commit-title");
    await shot("commit-view");
    await click(".pull-tabs >> text=Conversation");
    console.log("tab switches:", JSON.stringify(await stats()));
    await resetStats();
    await page.reload();
    await idle();
    console.log("warm load:", JSON.stringify(await stats()));
  } else if (scenario === "shot") {
    await go(param("PR", "/cli/cli/pull/14957"));
    await shot("page", true);
  } else if (scenario === "sandbox") {
    const pr = param("PR", "/Lightning11wins/gitgud-sandbox/pull/16");
    await go(pr);
    await click("button[aria-label='Request reviewers']");
    await shot("reviewer-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await click(".pull-title-actions >> text=Edit");
    await page.fill(".pull-title-edit input", "Clarify guide section 3 (edited)");
    await shot("title-editing");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await shot("title-cancelled");
  } else if (scenario === "writes") {
    const pr = param("PR", "/Lightning11wins/gitgud-sandbox/pull/16");
    await go(pr);
    await click(".pull-title-actions >> text=Edit");
    await page.fill(".pull-title-edit input", "Clarify guide section 3 (edited)");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await idle();
    await shot("title-saved");
    await click("text=Convert to draft");
    await page.waitForTimeout(1500);
    await shot("converted-to-draft", true);
    await click("text=Ready for review");
    await page.waitForTimeout(1500);
    await shot("ready-again", true);
  } else if (scenario === "merge") {
    const pr = param("PR", "/Lightning11wins/gitgud-sandbox/pull/16");
    await go(pr);
    await click("button[aria-label='Select merge method']");
    await shot("method-menu");
    await click(".merge-method >> text=Squash and merge");
    await click(".merge-action .btn-group .btn >> nth=0");
    await page.waitForTimeout(1000);
    await shot("merge-confirm", true);
    await click("text=Confirm squash and merge");
    await page.waitForTimeout(2500);
    await idle();
    await shot("merged", true);
    await click("text=Delete branch");
    await page.waitForTimeout(2000);
    await shot("branch-deleted", true);
    await click("text=Restore branch");
    await page.waitForTimeout(2000);
    await shot("branch-restored", true);
  } else if (scenario === "branch") {
    await go(param("PR", "/Lightning11wins/gitgud-sandbox/pull/16"));
    await click("text=Delete branch");
    await page.waitForSelector("text=Restore branch", { timeout: 15000 });
    await shot("branch-deleted");
    console.log("branches after delete:", execFileSync("gh", ["api", "repos/Lightning11wins/gitgud-sandbox/branches", "-q", "[.[].name]|join(\",\")"], { encoding: "utf8" }).trim());
    await click("text=Restore branch");
    await page.waitForSelector("text=Delete branch", { timeout: 15000 });
    await shot("branch-restored");
    console.log("branches after restore:", execFileSync("gh", ["api", "repos/Lightning11wins/gitgud-sandbox/branches", "-q", "[.[].name]|join(\",\")"], { encoding: "utf8" }).trim());
  } else if (scenario === "compare") {
    await go(param("CMP", "/Lightning11wins/gitgud-sandbox/compare/main...unopened-branch"));
    await shot("compare", true);
    if (process.env.CREATE) {
      await page.fill(".compare-title-input", "Add extra helper");
      await click(".compare-draft input");
      await click("text=Create draft pull request");
      await page.waitForTimeout(3000);
      await idle();
      console.log("navigated to", page.url());
      await shot("created", true);
    }
  } else {
    console.log("unknown scenario", scenario);
  }
} finally {
  await browser.close();
  await server.close();
}
