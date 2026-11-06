// Drives the Files changed tab on the sandbox PR: tree navigation, expand context, Load diff,
// viewed toggles, keyboard, and (with --write) line and range comments. Saves screenshots to $TMPDIR.
// Usage: node scripts/diff-flows.mjs [--number 15] [--write] [--dark]
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const R = "Lightning11wins/gitgud-sandbox";
const number = Number(opt("number", 15));
const out = process.env.TMPDIR ?? "/tmp";
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: flag("dark") ? "dark" : "light" });
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("page error:", e.message));
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

let step = 0;
const shot = async (name) => {
  const file = `${out}/flow-${String(++step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("saved", file);
};
const check = (label, ok) => console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
const treeClick = async (path) => {
  await page.locator(".ft-filter").fill(path);
  await page.locator(`.ft-row[title="${path}"]`).click();
  await page.locator(".ft-filter").fill("");
  await page.locator(".ft-filter").blur();
};
const section = (path) => page.locator(`section.df[data-path="${path}"]`);

await page.goto(`${base}/${R}/pull/${number}/files`);
await page.waitForSelector(".dk", { timeout: 60000 });
await page.waitForTimeout(800);
await shot("top");

// Tree navigation.
await treeClick("src/inventory.ts");
await page.waitForTimeout(600);
const invTop = await section("src/inventory.ts").evaluate((el) => el.getBoundingClientRect().top);
check(`tree click scrolls to file (top ${Math.round(invTop)})`, invTop > 50 && invTop < 200);
check("tree highlights the file in view", (await page.locator(".ft-row.active").getAttribute("title")) === "src/inventory.ts");
await shot("inventory");

// Expand context.
const inv = section("src/inventory.ts");
const before = await inv.locator(".dn").count();
const btn = inv.locator(".dh-btn").first();
if (await btn.count()) {
  await btn.evaluate((el) => el.click());
  await page.waitForTimeout(1200);
  const after = await inv.locator(".dn").count();
  check(`expand context adds rows (${before} -> ${after})`, after > before);
  await shot("expanded");
} else check("expand button present", false);

// Keyboard n/p.
await page.keyboard.press("n");
await page.waitForTimeout(500);
const afterN = await page.locator(".ft-row.active").getAttribute("title");
check(`n moves to next file (${afterN})`, afterN !== "src/inventory.ts");
await page.keyboard.press("p");
await page.waitForTimeout(500);
check("p moves back", (await page.locator(".ft-row.active").getAttribute("title")) === "src/inventory.ts");

// Load diff for the large JSON file.
await treeClick("src/big.json");
await page.waitForTimeout(500);
const big = section("src/big.json");
check("big.json starts hidden", (await big.locator(".df-notice button", { hasText: "Load diff" }).count()) === 1);
await shot("big-hidden");
await big.locator(".df-notice button", { hasText: "Load diff" }).click();
await big.locator(".dk").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
check(`big.json renders rows (${await big.locator(".dk").count()} chunks mounted, ${await big.locator(".dk-ph").count()} pending)`, (await big.locator(".dk").count()) > 0);
await shot("big-loaded");

// Deleted file shows a placeholder.
const go = section("src/server.go");
check("deleted file hidden behind Load diff", (await go.locator(".df-notice", { hasText: "deleted" }).count()) === 1);

// Viewed toggle (optimistic, synced to GitHub), then restore.
const first = section("src/generated/module_00.ts");
await first.locator(".df-viewed input").click();
await page.waitForTimeout(300);
check("viewed collapses the file", await first.evaluate((el) => el.classList.contains("collapsed")));
const counter = await page.locator(".dv-viewed").innerText();
check(`viewed counter updates (${counter})`, /^1 \//.test(counter.trim()));
await shot("viewed");
await page.waitForTimeout(1500);
const state = execFileSync("gh", ["api", "graphql", "-f", `query={ repository(owner:"Lightning11wins", name:"gitgud-sandbox") { pullRequest(number:${number}) { files(first:100) { nodes { path viewerViewedState } } } } }`, "--jq", '.data.repository.pullRequest.files.nodes[] | select(.path == "src/generated/module_00.ts")'], { encoding: "utf8" });
console.log("github viewed state:", state.trim());
await first.locator(".df-viewed input").click();
await page.waitForTimeout(1500);
check("unviewed expands the file", !(await first.evaluate((el) => el.classList.contains("collapsed"))));

if (flag("write")) {
  // Range comment: drag across three right-side line numbers of inventory.ts.
  await treeClick("src/inventory.ts");
  await page.waitForTimeout(600);
  const nums = inv.locator('.dn[data-c][data-s="R"]');
  // Pin the two cells by line number so later DOM changes can't shift them.
  const [na, nb] = [await nums.nth(4).getAttribute("data-n"), await nums.nth(6).getAttribute("data-n")];
  const a = inv.locator(`.dn[data-c][data-s="R"][data-n="${na}"]`);
  const b = inv.locator(`.dn[data-c][data-s="R"][data-n="${nb}"]`);
  await a.hover();
  await page.mouse.down();
  await b.hover();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const selected = await inv.locator(".dc.sel").count();
  check(`drag selects lines (${selected} code cells)`, selected === 3);
  const form = inv.locator(".dt textarea");
  check("comment form opens under the range", (await form.count()) === 1);
  await shot("range-form");
  // Esc closes.
  await form.press("Escape");
  await page.waitForTimeout(300);
  check("Esc closes the form", (await inv.locator(".dt textarea").count()) === 0);
  // Reopen with click + shift-click, then start a review.
  await a.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await inv.locator(".dt textarea").press("Escape").catch(() => {});
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await page.waitForTimeout(300);
  check(`shift-click selects a range (${await inv.locator(".dc.sel").count()} cells)`, (await inv.locator(".dc.sel").count()) === 3);
  const ta = inv.locator(".dt textarea");
  await ta.fill(`Range comment from diff-flows ${new Date().toISOString()}`);
  const startBtn = inv.locator(".dt button", { hasText: /Start a review|Add review comment/ });
  await startBtn.first().click();
  await page.waitForFunction(() => document.querySelectorAll("section.df[data-path='src/inventory.ts'] .dt textarea").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const pendingBadges = await inv.locator("text=Pending").count();
  check(`pending thread shows inline (${pendingBadges} Pending badges)`, pendingBadges > 0);
  await shot("pending-thread");
  // Single-line comment on the left side would conflict with the pending review, so file-level comment goes into the review too.
  await inv.locator('button[title="Comment on this file"]').click();
  await page.waitForTimeout(300);
  check("file comment form opens", (await inv.locator(".df-filecomment textarea").count()) === 1);
  await inv.locator(".df-filecomment textarea").fill("File-level comment from diff-flows");
  await inv.locator(".df-filecomment button", { hasText: /Add review comment|Start a review/ }).first().click();
  await page.waitForTimeout(3000);
  check("file-level thread shows at the file top", (await inv.locator(".df-threads").count()) === 1);
  await shot("file-thread");
  const pendingIds = execFileSync("gh", ["api", "graphql", "-f", `query={ repository(owner:"Lightning11wins", name:"gitgud-sandbox") { pullRequest(number:${number}) { reviews(states:PENDING, first:5) { nodes { id } } } } }`, "--jq", ".data.repository.pullRequest.reviews.nodes[].id"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const id of pendingIds) execFileSync("gh", ["api", "graphql", "-f", `query=mutation { deletePullRequestReview(input: { pullRequestReviewId: "${id}" }) { clientMutationId } }`]);
  console.log(`discarded ${pendingIds.length} pending review(s)`);
}

await browser.close();
await server.close();
