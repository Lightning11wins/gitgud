// Finds elements that look interactive but do nothing, signed in with the gh CLI token.
// Usage: node scripts/audit-affordances.mjs [--pages /a,/b/c] [--no-links] [--dark]
// Starts its own Vite dev server unless BASE is set. Writes to GitHub are blocked.
// Checks, per page (plus popovers opened from it):
//   pointer    cursor: pointer with no click handler on the element or an ancestor
//   button     <button> with no click handler and no form to submit
//   hover      a :hover rule changes color, underline, or border on a non-interactive element
//   link-style underlined or link-colored text outside links and buttons
//   title      a tooltip that names an action on an element with no handler
//   self-link  a link to the page it's on (active tabs excepted)
//   not-found  an in-app link whose target renders the NotFound page
//   dead-click a pointer element whose only handler is an ancestor's, and clicking it changes nothing
// Exits 1 when anything is found.
import { execFileSync } from "node:child_process";
import { launchBrowser } from "./browser.mjs";
import { sandbox } from "./sandbox.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const { repo: SB, owner: SB_OWNER } = sandbox();
const PR = "cli/cli/pull/14957";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const token = gh("auth", "token");
const viewer = JSON.parse(gh("api", "user", "-q", "{login, name, avatarUrl: .avatar_url, url: .html_url}"));
const sha = gh("api", `repos/${SB}/pulls/15/commits`, "-q", ".[0].sha");

const OPEN = {
  user: ".app-header button:has(.avatar)",
  comment: 'button[aria-label="Comment actions"]',
  reaction: 'button[aria-label="Add reaction"]',
  labels: 'button[aria-label="Edit labels"]',
};
const DEFAULT_PAGES = [
  { path: "/", open: [OPEN.user] },
  { path: `/${SB_OWNER}` },
  { path: "/microsoft" },
  { path: `/${SB}` },
  { path: `/${SB}/issues` },
  { path: `/${SB}/pulls` },
  { path: `/${SB}/issues/14`, open: [OPEN.comment, OPEN.reaction, OPEN.labels] },
  { path: `/${SB}/issues/1` },
  { path: `/${SB}/pull/15`, open: [OPEN.comment] },
  { path: `/${SB}/pull/15/commits` },
  { path: `/${SB}/pull/15/checks` },
  { path: `/${SB}/pull/15/files` },
  { path: `/${SB}/pull/15/commits/${sha}` },
  { path: `/${PR}` },
  { path: `/${PR}/commits` },
  { path: `/${PR}/checks` },
  { path: `/${PR}/files` },
  { path: `/${SB}/compare/main...unopened-branch` },
  { path: `/${SB}/issues/new` },
  { path: "/settings" },
];
const pages = opt("pages") ? opt("pages").split(",").map((path) => ({ path })) : DEFAULT_PAGES;

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

// Records native click-type listeners so delegated handlers count as handlers.
await context.addInitScript(() => {
  const TYPES = new Set(["click", "auxclick", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup"]);
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (TYPES.has(type) && this instanceof Element) this.__auditClick = true;
    return add.call(this, type, ...rest);
  };
});

// Read-only: GET, GraphQL queries, and /markdown previews pass; everything else is aborted.
await context.route("https://api.github.com/**", (route) => {
  const req = route.request();
  const url = req.url();
  let ok = req.method() === "GET" || req.method() === "HEAD" || url.endsWith("/markdown");
  if (req.method() === "POST" && url.endsWith("/graphql")) ok = !/^\s*mutation\b/.test(JSON.parse(req.postData() ?? "{}").query ?? "");
  if (!ok) console.log(`blocked write: ${req.method()} ${url}`);
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

/** Patterns that are intentional. */
const ALLOW = [{ kind: "self-link", selector: /a\.brand$/, why: "the logo links home on every page" }];

/**
 * Runs in the page. Returns findings for the current DOM and the in-app hrefs on it. With
 * `cands`, it instead marks and returns pointer elements handled only by an ancestor, for click tests.
 */
function scan(cands) {
  const CLICK = ["onClick", "onClickCapture", "onMouseDown", "onMouseUp", "onPointerDown", "onPointerUp", "onDoubleClick", "onAuxClick"];
  const ACTION_TITLE =
    /^(click|open|go to|view|show|hide|toggle|copy|jump|expand|collapse|edit|delete|remove|add|mark|resolve|unresolve|load|sort|filter|select|change|switch|reply|close|reopen|refresh|retry|cancel|submit|apply|dismiss)\s+\w|\bclick\b/i;
  const reactProps = (el) => {
    const k = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return k ? el[k] : null;
  };
  const isRoot = (el) => Object.keys(el).some((k) => k.startsWith("_reactListening"));
  const clickHandler = (el) => {
    if (el.__auditClick && !isRoot(el)) return true;
    const p = reactProps(el);
    return !!p && CLICK.some((k) => typeof p[k] === "function");
  };
  const interactive = (el) => {
    switch (el.tagName) {
      case "A":
        return el.hasAttribute("href") || clickHandler(el);
      case "BUTTON":
        return (!!el.form && (el.type === "submit" || el.type === "reset")) || clickHandler(el);
      case "INPUT":
      case "SELECT":
      case "TEXTAREA":
      case "OPTION":
      case "SUMMARY":
        return true;
      case "LABEL":
        return !!el.control || clickHandler(el);
    }
    return el.isContentEditable || clickHandler(el);
  };
  const handled = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) if (interactive(e)) return true;
    return false;
  };
  const nativeHandled = (el) => !!el.closest("a[href], button, input, select, textarea, summary, label, [contenteditable]");
  const visible = (el) => el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true });
  const describe = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => !/^(octicon|row|grow|muted|truncate)$/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
      if (cls.length && parts.length >= 2) break;
    }
    return parts.join(" > ");
  };
  const snippet = (el) =>
    (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.outerHTML.slice(0, 80)).replace(/\s+/g, " ").trim().slice(0, 60);
  const findings = [];
  const add = (kind, el, extra = "") => findings.push({ kind, selector: describe(el), text: snippet(el) + extra });

  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  document.body.append(probe);
  const linkColor = getComputedStyle(probe).color;
  probe.remove();

  const all = [...document.body.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement && el.tagName !== "svg"));
  if (cands) {
    const sigs = new Map();
    for (const el of all) {
      el.removeAttribute("data-audit-cand");
      if (!visible(el) || nativeHandled(el) || clickHandler(el) || !handled(el) || getComputedStyle(el).cursor !== "pointer") continue;
      const sig = describe(el);
      if (sigs.has(sig)) continue;
      sigs.set(sig, snippet(el));
      el.setAttribute("data-audit-cand", sig);
    }
    return [...sigs].map(([selector, text]) => ({ selector, text }));
  }
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const ok = handled(el);
    if (cs.cursor === "pointer" && !ok && getComputedStyle(el.parentElement).cursor !== "pointer") add("pointer", el);
    if (el.tagName === "BUTTON" && !el.disabled && !interactive(el) && !ok) add("button", el);
    if (!ok && !el.closest("a, button")) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (ownText && cs.textDecorationLine.includes("underline") && !["INS", "U", "ABBR"].includes(el.tagName)) add("link-style", el, " (underlined)");
      else if (ownText && cs.color === linkColor && !el.closest(".markdown-body, .label, .counter, .state-badge")) add("link-style", el, " (link color)");
    }
    const title = el.getAttribute("title");
    if (title && ACTION_TITLE.test(title) && !ok) add("title", el, ` [title="${title}"]`);
    if (el.tagName === "A" && el.hasAttribute("href")) {
      const href = el.getAttribute("href");
      const url = new URL(href, location.href);
      const current = el.matches('[aria-current]:not([aria-current="false"]), .active, [data-selected="true"]');
      if (href === "#" || href === "") add("self-link", el, ` [href="${href}"]`);
      else if (href.startsWith("#") && !document.getElementById(decodeURIComponent(href.slice(1)))) add("self-link", el, ` [missing anchor ${href}]`);
      else if (!url.hash && url.origin === location.origin && url.pathname + url.search === location.pathname + location.search && !current)
        add("self-link", el, ` [href="${href}"]`);
    }
  }

  // :hover rules whose subject is a non-interactive element.
  const splitList = (sel) => {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < sel.length; i++) {
      if ("([".includes(sel[i])) depth++;
      else if (")]".includes(sel[i])) depth--;
      else if (sel[i] === "," && depth === 0) {
        out.push(sel.slice(start, i).trim());
        start = i + 1;
      }
    }
    return [...out, sel.slice(start).trim()];
  };
  const subjectStart = (sel) => {
    let depth = 0;
    let at = 0;
    for (let i = 0; i < sel.length; i++) {
      if ("([".includes(sel[i])) depth++;
      else if (")]".includes(sel[i])) depth--;
      else if (depth === 0 && " >+~".includes(sel[i])) at = i + 1;
    }
    return at;
  };
  const rules = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.cssRules?.length && !(r instanceof CSSStyleRule)) walk(r.cssRules);
      else if (r instanceof CSSStyleRule && r.selectorText.includes(":hover")) rules.push(r);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheet.
    }
  }
  const seen = new Set();
  for (const rule of rules) {
    const props = [...rule.style];
    const cue = props.some((p) => /^(color|text-decoration|border|outline|opacity|filter)/.test(p));
    const bg = props.some((p) => /^(background|box-shadow)/.test(p));
    if (!cue && !bg) continue;
    for (const sel of splitList(rule.selectorText)) {
      const at = subjectStart(sel);
      if (!sel.slice(at).includes(":hover")) continue;
      const baseSel = (sel.slice(0, at) + sel.slice(at).replace(/:hover/g, "").replace(/::?(before|after)$/, "")).trim() || "*";
      let matches;
      try {
        matches = document.querySelectorAll(baseSel.endsWith(">") || baseSel.endsWith(" ") ? baseSel + "*" : baseSel);
      } catch {
        continue;
      }
      for (const el of matches) {
        if (seen.has(el) || !visible(el) || handled(el)) continue;
        // Row highlights around links are fine; background alone elsewhere still suggests a target.
        if (!cue && el.querySelector("a[href], button, input, select, textarea")) continue;
        seen.add(el);
        add("hover", el, ` [${sel}]`);
      }
    }
  }

  const hrefs = [...document.querySelectorAll("a[href]")]
    .map((a) => new URL(a.getAttribute("href"), location.href))
    .filter((u) => u.origin === location.origin)
    .map((u) => u.pathname + u.search);
  return { findings, hrefs: [...new Set(hrefs)], elements: all.length };
}

const report = new Map();
const hrefSources = new Map();
const record = (where, findings) => {
  const list = report.get(where) ?? [];
  for (const f of findings) {
    if (ALLOW.some((a) => a.kind === f.kind && a.selector.test(f.selector))) continue;
    const same = list.find((g) => g.kind === f.kind && g.selector === f.selector);
    if (same) same.count++;
    else list.push({ ...f, count: 1 });
  }
  report.set(where, list);
};
const notFoundText = /doesn't handle this page/i;

const MAX_CLICK_TESTS = 30;
let popups = 0;
context.on("page", () => popups++);

/** Clicks one element per candidate signature and reports those that change nothing. */
async function clickTests(path) {
  const cands = (await page.evaluate(scan, true)).slice(0, MAX_CLICK_TESTS);
  for (const { selector, text } of cands) {
    await page.evaluate(scan, true);
    const marked = await page.evaluate(
      async (sig) => {
        const el = [...document.querySelectorAll("[data-audit-cand]")].find((e) => e.getAttribute("data-audit-cand") === sig);
        if (!el) return false;
        document.querySelectorAll("[data-audit-target]").forEach((e) => e.removeAttribute("data-audit-target"));
        el.setAttribute("data-audit-target", "");
        window.__auditMutations = 0;
        window.__auditObserver?.disconnect();
        window.__auditObserver = new MutationObserver((list) => {
          window.__auditMutations += list.filter((m) => !(m.type === "attributes" && m.attributeName?.startsWith("data-audit"))).length;
        });
        window.__auditObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        await new Promise((r) => setTimeout(r, 300));
        const quiet = window.__auditMutations === 0;
        window.__auditMutations = 0;
        return quiet ? "quiet" : "noisy";
      },
      selector,
    );
    if (marked !== "quiet") continue;
    const url = page.url();
    const before = popups;
    const focused = await page.evaluateHandle(() => document.activeElement);
    // Empty or covered elements can't take a real click; a dispatched one still reaches the handlers.
    const target = page.locator("[data-audit-target]");
    await target.click({ timeout: 2000 }).catch(() => target.dispatchEvent("click"));
    await page.waitForTimeout(300);
    const changed = await page.evaluate((f) => window.__auditMutations > 0 || document.activeElement !== f, focused);
    if (!changed && page.url() === url && popups === before) record(path, [{ kind: "dead-click", selector, text }]);
    else {
      await page.goto(base + path);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

for (const { path, open = [] } of pages) {
  await page.goto(base + path);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (notFoundText.test((await page.locator(".app-main").textContent()) ?? "")) record(path, [{ kind: "not-found", selector: "main", text: "page renders NotFound" }]);
  const { findings, hrefs, elements } = await page.evaluate(scan);
  const requests = await page.evaluate(() => globalThis.__gitgudApiStats?.total ?? 0);
  console.log(`${path}: ${elements} elements, ${requests} API requests`);
  record(path, findings);
  for (const h of hrefs) if (!hrefSources.has(h)) hrefSources.set(h, path);
  for (const sel of open) {
    const trigger = page.locator(sel).first();
    if (!(await trigger.count())) {
      console.log(`${path}: no ${sel} to open`);
      continue;
    }
    await trigger.click();
    await page.waitForTimeout(400);
    const before = new Set((report.get(path) ?? []).map((f) => f.kind + f.selector));
    const opened = (await page.evaluate(scan)).findings.filter((f) => !before.has(f.kind + f.selector));
    record(`${path} (after clicking ${sel})`, opened);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  await clickTests(path);
}

// Follows every in-app link once with the API blocked; only the route match matters.
if (!argv.includes("--no-links")) {
  const links = await context.newPage();
  await links.route("https://api.github.com/**", (route) => route.abort());
  await links.goto(base + "/settings");
  for (const [href, from] of hrefSources) {
    await links.evaluate((href) => {
      history.pushState(null, "", href);
      dispatchEvent(new PopStateEvent("popstate"));
    }, href);
    await links.waitForTimeout(100);
    if (notFoundText.test((await links.locator(".app-main").textContent()) ?? "")) record(from, [{ kind: "not-found", selector: `a[href="${href}"]`, text: href }]);
  }
  console.log(`followed ${hrefSources.size} in-app links`);
}

let total = 0;
for (const [where, list] of report) {
  if (!list.length) continue;
  console.log(`\n${where}`);
  for (const f of list) console.log(`  ${f.kind.padEnd(10)} ${f.selector}${f.count > 1 ? ` (x${f.count})` : ""}  "${f.text}"`);
  total += list.length;
}
console.log(total ? `\n${total} findings` : "\nno findings");
await browser.close();
await server?.close();
process.exit(total ? 1 : 0);
