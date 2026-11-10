// Finds icons and avatars that sit off-center from the text beside them, signed in with the gh CLI token.
// Usage: node scripts/audit-alignment.mjs [--pages /a,/b/c] [--dark] [--tolerance 1] [--all]
// Starts its own Vite dev server unless BASE is set. Writes to GitHub are blocked.
// An icon is off when its vertical center is more than --tolerance px from the middle of the
// nearest text on its line, halfway between the cap-height and x-height centers. --all prints every pair.
// Exits 1 when anything is found.
import { execFileSync } from "node:child_process";
import { launchBrowser } from "./browser.mjs";
import { sandbox } from "./sandbox.mjs";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const { repo: SB, owner: SB_OWNER } = sandbox();
const PR = "cli/cli/pull/14957";
const tolerance = Number(opt("tolerance", 1));

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const token = gh("auth", "token");
const viewer = JSON.parse(gh("api", "user", "-q", "{login, name, avatarUrl: .avatar_url, url: .html_url}"));

const DEFAULT_PAGES = [
  "/",
  `/${SB_OWNER}`,
  `/${SB}`,
  `/${SB}/issues`,
  `/${SB}/pulls`,
  `/${SB}/issues/14`,
  `/${SB}/issues/1`,
  `/${SB}/pull/15`,
  `/${SB}/pull/15/commits`,
  `/${SB}/pull/15/checks`,
  `/${SB}/pull/15/files`,
  `/${SB}/pull/17`,
  `/${PR}`,
  `/${PR}/checks`,
  `/${SB}/compare/main...small-fix`,
  `/${SB}/issues/new`,
  "/settings",
];
const pages = opt("pages") ? opt("pages").split(",") : DEFAULT_PAGES;

let server;
if (!process.env.BASE) {
  const { createServer } = await import("vite");
  server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "silent" });
  await server.listen();
}
const base = process.env.BASE ?? server.resolvedUrls.local[0].replace(/\/$/, "");

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: argv.includes("--dark") ? "dark" : "light",
});
await context.route("https://api.github.com/**", (route) => {
  const req = route.request();
  const url = req.url();
  let ok = req.method() === "GET" || req.method() === "HEAD" || url.endsWith("/markdown");
  if (req.method() === "POST" && url.endsWith("/graphql")) ok = !/^\s*mutation\b/.test(JSON.parse(req.postData() ?? "{}").query ?? "");
  return ok ? route.continue() : route.abort();
});

const page = await context.newPage();
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

/** Icons that center on something other than the text beside them. */
const ALLOW = [
  { icon: /span\.merge-section-icon/, why: "centers on the title and detail lines together" },
  { icon: /span\.merge-box-badge/, why: "centers on the merge box's first section" },
  { icon: /div\.tl-form-row > img\.avatar/, why: "aligns with the top of the comment box" },
];

/** Runs in the page. Pairs each icon with the nearest text on its line and returns the offsets. */
function scan() {
  const ctx = document.createElement("canvas").getContext("2d");
  const metricsCache = new Map();
  const metrics = (style) => {
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let m = metricsCache.get(font);
    if (!m) {
      ctx.font = font;
      const cap = ctx.measureText("H");
      m = { ascent: cap.fontBoundingBoxAscent, cap: cap.actualBoundingBoxAscent, x: ctx.measureText("x").actualBoundingBoxAscent };
      metricsCache.set(font, m);
    }
    return m;
  };
  const describe = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      parts.unshift(e.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return parts.join(" > ");
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
  };

  // Every rendered text line: its rect and its visual middle (between cap and x-height centers).
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim() || !n.parentElement || n.parentElement.closest("svg, script, style, textarea, .markdown-body, .diff-table, pre")) continue;
    if (!shown(n.parentElement)) continue;
    const m = metrics(getComputedStyle(n.parentElement));
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 2) continue;
      const baseline = r.top + m.ascent;
      lines.push({ node: n, r, mid: baseline - (m.cap + m.x) / 4, text: n.data.trim().slice(0, 24) });
    }
  }

  // Icons pair only with text under one of their four nearest ancestors.
  const near = (icon, node) => {
    let a = icon.parentElement;
    for (let i = 0; a && i < 4; i++, a = a.parentElement) if (a.contains(node)) return true;
    return false;
  };
  const out = [];
  for (const icon of document.querySelectorAll("svg, img.avatar, .label-dot")) {
    if (icon.parentElement?.closest("svg") || !shown(icon) || icon.closest(".markdown-body, .diff-table")) continue;
    const ir = icon.getBoundingClientRect();
    if (ir.height > 40) continue;
    const cy = ir.top + ir.height / 2;
    // The nearest text that overlaps the icon vertically, within 48px horizontally, sharing a row ancestor.
    let best = null;
    for (const l of lines) {
      if (l.r.bottom < ir.top || l.r.top > ir.bottom) continue;
      const dx = l.r.left >= ir.right ? l.r.left - ir.right : ir.left >= l.r.right ? ir.left - l.r.right : 0;
      if (dx > 48 || !near(icon, l.node)) continue;
      if (!best || dx < best.dx) best = { ...l, dx };
    }
    if (!best) continue;
    out.push({ icon: describe(icon), text: best.text, textAt: describe(best.node.parentElement), off: +(cy - best.mid).toFixed(1), y: Math.round(ir.top + scrollY) });
  }
  return out;
}

let found = 0;
for (const path of pages) {
  await page.goto(base + path);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => console.log(`${path}: networkidle timeout`));
  await page.waitForTimeout(500);
  const pairs = await page.evaluate(scan);
  const seen = new Set();
  for (const p of pairs) {
    const bad = Math.abs(p.off) > tolerance && !ALLOW.some((a) => a.icon.test(p.icon));
    if (!bad && !argv.includes("--all")) continue;
    const key = `${p.icon}|${p.textAt}|${p.off}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (bad) found++;
    console.log(`${path}  ${p.off > 0 ? "+" : ""}${p.off}px  ${p.icon}  vs "${p.text}" in ${p.textAt}  (y=${p.y})`);
  }
}
console.log(`${found} misaligned`);
await browser.close();
await server?.close();
process.exit(found ? 1 : 0);
