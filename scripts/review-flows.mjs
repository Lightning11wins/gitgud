// Exercises the review write flows against the sandbox repo in headless Chromium.
// Usage: node scripts/review-flows.mjs [--number 16] [--path docs/guide.md] [--line 17] [--out dir] [--shots-only]
// Writes comments, reactions, and reviews to Lightning11wins/gitgud-sandbox only.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const number = Number(opt("number", 16));
const path = opt("path", "docs/guide.md");
const line = Number(opt("line", 17));
const outDir = opt("out", process.env.TMPDIR ?? ".");
const shotsOnly = argv.includes("--shots-only");

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
let failures = 0;

async function openPage(query, { dark = false, width = 1000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light" });
  page.on("console", (m) => m.type() === "error" && console.log("  console error:", m.text()));
  page.on("pageerror", (e) => console.log("  page error:", e.message));
  page.on("dialog", (d) => d.accept());
  // Chromium doesn't answer proxy auth on CORS preflights; a plain request first caches the credentials.
  if (proxy) await page.goto("https://api.github.com/zen").catch(() => {});
  await page.goto(base + "/src/features/review/dev/harness.html?x");
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
  await page.goto(`${base}/src/features/review/dev/harness.html?${query}`);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => console.log("  networkidle timeout"));
  return page;
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
  }
}

const stats = (page) => page.evaluate(() => JSON.stringify(globalThis.__gitgudApiStats?.byName));
const shot = (page, name, full = true) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });

// Read-only screenshots of the seeded big PR.
for (const dark of [false, true]) {
  const page = await openPage(`number=15&path=src/reports.py&line=12`, { dark, width: 960 });
  await page.waitForSelector(".rt", { timeout: 20000 }).catch(() => {});
  await shot(page, `threads-15${dark ? "-dark" : ""}`);
  console.log(`shot threads-15${dark ? "-dark" : ""}: ${await stats(page)}`);
  await page.close();
}
{
  const page = await openPage(`number=15&hunk=0&width=700`, { width: 760 });
  await page.waitForSelector(".rt", { timeout: 20000 }).catch(() => {});
  await page.locator(".rt-reply-fake").first().click();
  await page.locator(".review-submit-btn").click();
  await page.waitForTimeout(500);
  await shot(page, "threads-15-files");
  await page.close();
}
if (shotsOnly) {
  await browser.close();
  await server.close();
  process.exit(0);
}

const page = await openPage(`number=${number}&path=${encodeURIComponent(path)}&line=${line}&side=RIGHT`);
const submitBtn = page.locator(".review-submit-btn");
const thread = () => page.locator(".rt").first();
await page.waitForSelector(".review-submit-btn", { timeout: 20000 });
await page.waitForSelector(".rt", { timeout: 20000 });
console.log("initial submit button:", (await submitBtn.innerText()).replace(/\s+/g, " "));
await shot(page, "flow-0-initial");

const hasPending = async () => /Finish your review/.test(await submitBtn.innerText());
const run = Date.now().toString(36);

async function newThread(button, text) {
  await page.locator("#new-thread").click();
  const form = page.locator(".new-thread");
  await form.getByRole("button", { name: button }).waitFor({ timeout: 10000 });
  await form.locator("textarea").fill(text);
  await form.getByRole("button", { name: button }).click();
  await form.waitFor({ state: "detached", timeout: 15000 });
  return page.locator(".rt-comment", { hasText: text });
}

async function editComment(c, text) {
  await c.getByLabel("Comment actions").click();
  await page.locator(".popover").getByRole("button", { name: "Edit" }).click();
  await c.locator("textarea").fill(text);
  await c.getByRole("button", { name: "Update comment" }).click();
  await c.locator(".rt-body", { hasText: text }).waitFor({ timeout: 15000 });
}

async function deleteComment(c) {
  await c.getByLabel("Comment actions").click();
  await page.locator(".popover").getByRole("button", { name: "Delete" }).click();
  await c.waitFor({ state: "detached", timeout: 10000 });
}

if (!(await hasPending())) {
  await step("new thread: Add single comment", async () => {
    const c = await newThread("Add single comment", `flow ${run}: single comment`);
    await c.waitFor({ timeout: 15000 });
    if (await c.locator(".rt-pending").count()) throw new Error("Failed to post the single comment immediately: it is pending");
    if (await hasPending()) throw new Error("Failed to post the single comment outside a pending review");
  });
}

await step("new thread: Start a review", async () => {
  const c = await newThread((await hasPending()) ? "Add review comment" : "Start a review", `flow ${run}: start a review`);
  await c.locator(".rt-pending").waitFor({ timeout: 15000 });
  await page.locator(".review-submit-btn", { hasText: "Finish your review" }).waitFor({ timeout: 15000 });
  console.log("  submit button:", (await submitBtn.innerText()).replace(/\s+/g, " "));
});

await step("new thread with pending offers only Add review comment", async () => {
  await page.locator("#new-thread").click();
  const form = page.locator(".new-thread");
  await form.getByRole("button", { name: "Add review comment" }).waitFor({ timeout: 10000 });
  if (await form.getByRole("button", { name: "Add single comment" }).count()) throw new Error("Failed to hide Add single comment");
  await shot(page, "flow-1-new-thread-pending", false);
  await form.locator("textarea").press("Escape");
  await form.waitFor({ state: "detached", timeout: 5000 });
});

await step("reply joins pending review (Add review comment)", async () => {
  await thread().locator(".rt-reply-fake").click();
  const btn = thread().getByRole("button", { name: "Add review comment" });
  await btn.waitFor({ timeout: 10000 });
  await thread().locator("textarea").fill(`flow ${run}: pending reply`);
  await btn.click();
  await thread().locator(".rt-comment", { hasText: `flow ${run}: pending reply` }).locator(".rt-pending").waitFor({ timeout: 15000 });
});

await step("edit pending comment", () => editComment(thread().locator(".rt-comment").last(), `flow ${run}: edited pending reply`));

await step("edit submitted comment shows edited", async () => {
  const c = thread().locator(".rt-comment").first();
  await editComment(c, `exp1: thread w/o review id (edited ${run})`);
  await c.locator(".rt-edited").waitFor({ timeout: 5000 });
});

await step("add and remove reaction", async () => {
  const c = thread().locator(".rt-comment").first();
  await c.getByLabel("Add reaction").first().click();
  await page.locator(".reaction-picker").getByLabel("hooray").click();
  const pill = c.locator(".reaction.active", { hasText: "🎉" });
  await pill.waitFor({ timeout: 10000 });
  await pill.click();
  await c.locator(".reaction", { hasText: "🎉" }).waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(2500);
  if (await c.locator(".reaction", { hasText: "🎉" }).count()) throw new Error("Failed to remove the reaction: it came back");
  // Toggle rocket from the picker and leave it flipped.
  const rocket = c.locator(".reaction.active", { hasText: "🚀" });
  const had = (await rocket.count()) > 0;
  await c.getByLabel("Add reaction").first().click();
  await page.locator(".reaction-picker").getByLabel("rocket").click();
  await rocket.waitFor({ state: had ? "detached" : "visible", timeout: 10000 });
});

await step("resolve collapses, unresolve expands", async () => {
  await thread().getByRole("button", { name: "Resolve conversation" }).click();
  await thread().locator(".rt-resolved-by", { hasText: "marked this conversation as resolved" }).waitFor({ timeout: 10000 });
  if ((await thread().locator(".rt-comment").count()) !== 0) throw new Error("Failed to collapse the resolved thread");
  await shot(page, "flow-2-resolved", false);
  await thread().locator(".rt-header").click();
  await thread().locator(".rt-comment").first().waitFor({ timeout: 5000 });
  await shot(page, "flow-3-resolved-expanded", false);
  await thread().getByRole("button", { name: "Unresolve conversation" }).click();
  await thread().getByRole("button", { name: "Resolve conversation" }).waitFor({ timeout: 10000 });
});

await step("delete pending comment", () => deleteComment(thread().locator(".rt-comment", { hasText: `flow ${run}: edited pending reply` })));

await step("submit pending review as COMMENT", async () => {
  await submitBtn.click();
  const pop = page.locator(".popover .review-submit");
  await pop.waitFor();
  await shot(page, "flow-4-submit-popover", false);
  await pop.locator("textarea").fill(`flow ${run}: submitted from gitgud`);
  await pop.getByRole("button", { name: "Submit review" }).click();
  await page.locator(".review-submit-btn", { hasText: "Review changes" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  if (await page.locator(".rt-pending").count()) throw new Error("Failed to clear Pending badges after submit");
});

await step("reply without pending posts immediately (Reply)", async () => {
  await thread().locator(".rt-reply-fake").click();
  await thread().getByRole("button", { name: "Start a review" }).waitFor({ timeout: 10000 });
  await thread().locator("textarea").fill(`flow ${run}: immediate reply`);
  await thread().getByRole("button", { name: "Reply", exact: true }).click();
  const c = thread().locator(".rt-comment", { hasText: `flow ${run}: immediate reply` });
  await c.waitFor({ timeout: 15000 });
  if (await c.locator(".rt-pending").count()) throw new Error("Failed to post the reply immediately: it is pending");
});

await step("reply: Start a review", async () => {
  await thread().locator(".rt-reply-fake").click();
  await thread().locator("textarea").fill(`flow ${run}: reply starts a review`);
  await thread().getByRole("button", { name: "Start a review" }).click();
  await thread().locator(".rt-comment", { hasText: `flow ${run}: reply starts a review` }).locator(".rt-pending").waitFor({ timeout: 15000 });
  await page.locator(".review-submit-btn", { hasText: "Finish your review" }).waitFor({ timeout: 15000 });
});

await step("discard pending review", async () => {
  await submitBtn.click();
  const pop = page.locator(".popover .review-submit");
  await pop.getByRole("button", { name: "Discard pending review" }).click();
  await page.locator(".review-submit-btn", { hasText: "Review changes" }).waitFor({ timeout: 15000 });
  const c = page.locator(".rt-comment", { hasText: `flow ${run}: reply starts a review` });
  await c.waitFor({ state: "detached", timeout: 15000 });
  await page.waitForTimeout(2500);
  if (await c.count()) throw new Error("Failed to discard: the pending reply came back");
});

await shot(page, "flow-5-final");
console.log("api stats:", await stats(page));
await browser.close();
await server.close();
console.log(failures ? `${failures} step(s) failed` : "all steps passed");
process.exit(failures ? 1 : 0);
