// Review flows on sandbox PR 15: start a pending review with a line comment, reply, discard,
// resolve and unresolve a thread, and toggle a reaction on a review comment. Checks GitHub state too.
// Writes to the GITGUD_SANDBOX repo and restores what it changes.
// Usage: PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node scripts/review-flows.mjs [--dark]
import { execFileSync } from "node:child_process";
import { launchBrowser } from "./browser.mjs";
import { sandbox } from "./sandbox.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const { repo: R, owner: R_OWNER, name: R_NAME } = sandbox();
const { createServer } = await import("vite");
const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const viewer = JSON.parse(execFileSync("gh", ["api", "user", "-q", "{login, name, avatarUrl: .avatar_url, url: .html_url}"], { encoding: "utf8" }));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: flag("dark") ? "dark" : "light" });
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 300)));
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
page.on("dialog", (d) => d.accept());
const check = (label, ok) => console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
const pend = () => execFileSync("gh", ["api", "graphql", "-f", `query={ repository(owner:"${R_OWNER}", name:"${R_NAME}") { pullRequest(number:15) { reviews(states:PENDING, first:5) { nodes { id comments { totalCount } } } } } }`, "--jq", ".data.repository.pullRequest.reviews.nodes"], { encoding: "utf8" }).trim();
await page.goto(`${base}/${R}/pull/15/files`);
await page.waitForSelector(".dk", { timeout: 60000 });
await page.locator(".ft-filter").fill("src/inventory.ts");
await page.locator('.ft-row[title="src/inventory.ts"]').click();
await page.locator(".ft-filter").fill("");
await page.waitForTimeout(800);
const inv = page.locator('section.df[data-path="src/inventory.ts"]');
await inv.locator('.dn[data-c][data-s="R"]').nth(3).click();
await inv.locator(".dt textarea").fill("review-flows line comment");
await inv.locator(".dt button", { hasText: /Start a review|Add review comment/ }).first().click();
const t0b = Date.now(); await inv.locator("text=Pending").first().waitFor({ timeout: 15000 }).catch(() => {}); console.log("badge after ms", Date.now() - t0b);
check("pending badge", (await inv.locator("text=Pending").count()) > 0);
console.log("github pending:", pend());
await inv.locator(".rt-reply-fake").first().click();
await inv.locator(".rt textarea").first().fill("review-flows reply");
await inv.locator(".rt button", { hasText: /Reply|Add review comment|Comment/ }).first().click();
await page.waitForTimeout(3000);
console.log("comments in thread:", await inv.locator(".rt").first().locator("text=review-flows").count());
console.log("github pending after reply:", pend());
await page.locator(".review-submit-btn:visible").first().click();
await page.locator("button", { hasText: "Discard pending review" }).click();
await page.waitForTimeout(3000);
check("pending gone in UI", (await inv.locator("text=Pending").count()) === 0);
check("thread gone in UI", (await inv.locator(".rt", { hasText: "review-flows" }).count()) === 0);
console.log("github pending after discard:", pend());
await page.goto(`${base}/${R}/pull/15`);
const rb = () => page.locator("button", { hasText: /^(Un)?[Rr]esolve conversation$/ }).first();
await rb().waitFor({ timeout: 30000 }).catch(() => {});
if (await rb().count()) {
  const id = await rb().evaluate((el) => el.closest(".rt").dataset.threadId);
  const th = () => page.locator(`.rt[data-thread-id="${id}"]`);
  const txt = async () => { if (!(await th().locator("button", { hasText: /esolve conversation/ }).count())) { await th().locator(".rt-header").click(); await page.waitForTimeout(200); } return th().locator("button", { hasText: /esolve conversation/ }).innerText(); };
  const before = await txt();
  await th().locator("button", { hasText: /esolve conversation/ }).click();
  await page.waitForTimeout(2500);
  const mid = await txt();
  await th().locator("button", { hasText: /esolve conversation/ }).click();
  await page.waitForTimeout(2500);
  console.log(`resolve: ${before} -> ${mid} -> ${await txt()}`);
} else console.log("no resolve button");
const rc = page.locator(".rt-comment").first();
const eyes = () => rc.locator(".reaction-pill[data-tooltip$='eyes emoji']");
const eyesBefore = await eyes().count();
await rc.locator(".reaction-pill.add").click();
await page.locator(".reaction-picker button[data-tooltip='eyes']").click();
await page.waitForTimeout(2500);
check("reaction toggled on review comment", (await eyes().count()) !== eyesBefore || (await eyes().getAttribute("aria-pressed")) !== null);
await rc.locator(".reaction-pill.add").click();
await page.locator(".reaction-picker button[data-tooltip='eyes']").click();
await page.waitForTimeout(2500);
check("reaction restored", (await eyes().count()) === eyesBefore);
await browser.close();
await server.close();
