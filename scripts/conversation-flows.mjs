// Drives the issue pages in headless Chromium, signed in with the gh CLI token, saving screenshots per step.
// Usage: node scripts/conversation-flows.mjs <scenario> <outDir> [--dark]
// Scenarios:
//   perf    PATHS="/a/b/issues/1,..." cold and warm loads with timings and API counts (read-only).
//   write   creates an issue in the sandbox via the new-issue page, then exercises comment, edit, react,
//           quote, delete, title, metadata, sub-issues, close/reopen, preview, autocomplete. Writes ONLY to GITGUD_SANDBOX.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { sandbox } from "./sandbox.mjs";

const argv = process.argv.slice(2);
const [scenario = "perf", outDir = "flows"] = argv.filter((a) => !a.startsWith("--"));
const dark = argv.includes("--dark");
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
page.on("dialog", (d) => d.accept());
page.on("requestfailed", (r) => console.log("request failed:", r.method(), r.url(), r.failure()?.errorText, (r.postData() ?? "").slice(0, 60)));

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
const resetStats = () => page.evaluate(() => globalThis.__gitgudApiStats?.reset?.());
const shot = async (name, full = false) => {
  const file = `${outDir}/${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log("saved", file);
};
const idle = () => page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => console.log("networkidle timeout"));
const settle = async (ms = 400) => {
  await page.waitForTimeout(ms);
  await idle();
};
/** Polls `fn` for up to 10s and reports whether it became true. */
const check = async (fn, what) => {
  const end = Date.now() + 10000;
  let ok = false;
  while (!(ok = await fn().catch(() => false)) && Date.now() < end) await page.waitForTimeout(200);
  console.log(ok ? "PASS" : "FAIL", what);
};
const composer = () => page.locator(".tl-form textarea").first();
const lastComment = () => page.locator(".tl-item.comment:not(.body)").last();

/** Loads `path` and reports when the body and the full timeline were on screen. */
async function timedLoad(path) {
  const t0 = Date.now();
  await page.goto(base + path);
  await page.locator(".tl-item.body").waitFor({ timeout: 60000 });
  const body = Date.now() - t0;
  await page.waitForFunction(() => !document.querySelector(".tl-loading"), null, { timeout: 120000 });
  await idle();
  const all = Date.now() - t0;
  const rows = await page.locator(".tl-item").count();
  const s = await stats();
  return { body, all, rows, requests: s.total, byName: s.byName };
}

try {
  if (scenario === "perf") {
    const paths = (process.env.PATHS ?? `/${sandbox().repo}/issues/14,/microsoft/vscode/issues/93814`).split(",");
    for (const p of paths) {
      await resetStats();
      console.log("cold", p, JSON.stringify(await timedLoad(p)));
      await shot(`cold-${p.split("/").pop()}`);
      // Warm: reload uses the IndexedDB cache and only probes updatedAt.
      await page.evaluate(() => globalThis.__gitgudApiStats?.reset?.());
      console.log("warm", p, JSON.stringify(await timedLoad(p)));
      const fps = await page.evaluate(async () => {
        const start = performance.now();
        let frames = 0;
        let worst = 0;
        let last = start;
        const h = document.documentElement.scrollHeight;
        await new Promise((resolve) => {
          const step = (t) => {
            frames++;
            worst = Math.max(worst, t - last);
            last = t;
            const p = (t - start) / 3000;
            window.scrollTo(0, h * Math.min(p, 1));
            if (p < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
        return { fps: Math.round(frames / 3), worstFrameMs: Math.round(worst) };
      });
      console.log("scroll", p, JSON.stringify(fps));
      await shot(`scrolled-${p.split("/").pop()}`);
    }
  } else if (scenario === "write") {
    const stamp = new Date().toISOString().slice(0, 19);
    // New issue: template chooser, then the bug template with a label preset. ISSUE=n reuses one instead.
    let number = Number(process.env.ISSUE ?? 0);
    if (!number) {
    await page.goto(`${base}/${sandbox().repo}/issues/new`);
    await settle();
    await shot("new-chooser");
    await page.locator(".template-list .box-row", { hasText: "Bug report" }).getByRole("button", { name: "Get started" }).click();
    await settle();
    await check(async () => (await page.locator(".new-issue .sidebar-labels").innerText()).includes("bug"), "template preset the bug label");
    await check(async () => (await page.locator(".new-issue textarea").inputValue()).includes("## What happened"), "template prefilled the body");
    await page.locator("#new-issue-title").fill(`gitgud flow test ${stamp}`);
    await page.getByRole("button", { name: "Edit assignees" }).click();
    await settle();
    await page.locator(".select-menu-item", { hasText: viewer.login }).first().click();
    await page.keyboard.press("Escape");
    await settle(200);
    await shot("new-filled");
    await page.locator(".new-issue textarea").focus();
    await page.keyboard.press("Control+Enter");
    await page.waitForURL(/\/issues\/\d+$/, { timeout: 20000 });
    number = Number(page.url().split("/").pop());
    console.log("created issue", number);
    } else await page.goto(`${base}/${sandbox().repo}/issues/${number}`);
    await settle();
    await shot("issue-created");
    await check(async () => (await page.locator(".sidebar").innerText()).includes(viewer.login), "assignee applied on create");

    // Autocomplete and preview.
    await composer().click();
    await page.keyboard.type("Hello @" + viewer.login.slice(0, 4));
    await page.waitForTimeout(600);
    await shot("mention-autocomplete");
    await check(async () => (await page.locator(".composer-suggest").count()) > 0, "mention suggestions shown");
    await page.keyboard.press("Enter");
    await page.keyboard.type("see #1 and **bold**");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await check(async () => (await composer().inputValue()).includes(`@${viewer.login} `), "mention inserted");
    await page.locator(".tl-form").getByRole("tab", { name: "Preview" }).click();
    await settle();
    await shot("preview");
    await check(async () => (await page.locator(".tl-form .composer-preview strong").count()) > 0, "preview rendered markdown");
    await page.locator(".tl-form").getByRole("tab", { name: "Write" }).click();

    // Comment.
    await resetStats();
    await page.locator(".tl-form").getByRole("button", { name: "Comment", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".tl-item.pending"), null, { timeout: 15000 });
    await settle();
    await check(async () => (await lastComment().innerText()).includes("bold"), "comment added");
    await page.waitForTimeout(2000);
    console.log("comment stats:", JSON.stringify((await stats()).byName));

    // React.
    await lastComment().getByRole("button", { name: "Add reaction" }).click();
    await page.locator(".reaction-picker button[title='hooray']").click();
    await settle();
    await check(async () => (await lastComment().locator(".reaction-pill").count()) > 1, "reaction added");

    // Edit.
    await lastComment().getByRole("button", { name: "Comment actions" }).click();
    await page.locator(".select-menu-item", { hasText: "Edit" }).click();
    await lastComment().locator("textarea").fill("Edited by the flow test");
    await lastComment().getByRole("button", { name: "Update comment" }).click();
    await settle();
    await shot("edited");
    await check(async () => (await lastComment().innerText()).includes("Edited by the flow test"), "comment edited");

    // Quote reply.
    await lastComment().getByRole("button", { name: "Comment actions" }).click();
    await page.locator(".select-menu-item", { hasText: "Quote reply" }).click();
    await page.waitForTimeout(300);
    await check(async () => (await composer().inputValue()).startsWith("> Edited by the flow test"), "quote reply filled composer");
    await composer().fill("");

    // Delete.
    await lastComment().getByRole("button", { name: "Comment actions" }).click();
    await page.locator(".select-menu-item", { hasText: "Delete" }).click();
    await settle();
    await check(async () => (await page.locator(".tl-item.comment:not(.body)").count()) === 0, "comment deleted");

    // Title.
    await page.locator(".issue-header").getByRole("button", { name: "Edit" }).click();
    await page.locator(".issue-title-edit input").fill(`gitgud flow test ${stamp} (renamed)`);
    await page.keyboard.press("Enter");
    await settle();
    await check(async () => (await page.locator(".issue-title").innerText()).includes("(renamed)"), "title renamed");

    // Labels and milestone.
    await page.getByRole("button", { name: "Edit labels" }).click();
    await settle();
    await page.locator(".select-menu-item", { hasText: "documentation" }).first().click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Edit milestone" }).click();
    await settle();
    await page.locator(".select-menu-item").first().click();
    await settle();
    await shot("metadata");
    await check(async () => {
      const side = await page.locator(".sidebar").innerText();
      return side.includes("documentation") && !side.includes("No milestone");
    }, "labels and milestone applied");

    // Sub-issue add and remove.
    await page.getByRole("button", { name: "Add sub-issue" }).click();
    await page.locator(".sidebar-add input").fill("#13");
    await page.keyboard.press("Enter");
    await settle();
    await check(async () => (await page.locator(".sidebar-subissue").count()) === 1, "sub-issue added");
    await shot("sub-issue");
    await page.getByRole("button", { name: "Remove sub-issue #13" }).click();
    await settle();
    await check(async () => (await page.locator(".sidebar-subissue").count()) === 0, "sub-issue removed");

    // Image paste notice.
    await composer().click();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" }));
      document.querySelector(".tl-form textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    await check(async () => (await page.locator(".tl-form .composer-notice").count()) === 1, "image paste notice");

    // Close as not planned, reopen, then close as completed.
    await page.getByRole("button", { name: "Choose close reason" }).click();
    await page.locator(".select-menu-item", { hasText: "Close as not planned" }).click();
    await page.locator(".tl-form").getByRole("button", { name: /not planned/i }).click();
    await settle();
    await shot("closed-not-planned");
    const ghState = () => JSON.parse(execFileSync("gh", ["api", `repos/${sandbox().repo}/issues/${number}`, "-q", "{state, state_reason}"], { encoding: "utf8" }));
    await check(async () => {
      const st = ghState();
      return st.state === "closed" && st.state_reason === "not_planned";
    }, "closed as not planned on GitHub");
    await page.locator(".tl-form").getByRole("button", { name: "Reopen issue" }).click();
    await settle();
    await check(async () => (await page.locator(".issue-subtitle").innerText()).includes("Open"), "reopened");

    // Hotkeys.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await check(async () => (await page.locator(".timeline .focused").count()) === 1, "j focuses a comment");
    await page.keyboard.press("r");
    await check(() => composer().evaluate((el) => el === document.activeElement), "r focuses the composer");

    await page.getByRole("button", { name: "Choose close reason" }).click();
    await page.locator(".select-menu-item", { hasText: "Close as completed" }).click();
    await page.locator(".tl-form").getByRole("button", { name: "Close issue" }).click();
    await settle();
    await shot("final", true);
    await check(async () => ghState().state_reason === "completed", "closed as completed on GitHub");
  }
} finally {
  await browser.close();
  await server.close();
}
