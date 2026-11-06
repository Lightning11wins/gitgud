import { toAppPath } from "@/lib/githubUrl";
import { settings } from "@/lib/settings";
import { rateLimits, type RateLimits } from "./rateLimit";

/**
 * Speculative loads: data the user is likely to open next (a hovered link, the next tab), fetched in
 * the background. Pages register prefetchers at module load so callers don't depend on page modules.
 * Loads run a few at a time, newest first, and stop while a rate limit runs low or the setting is off.
 */
export type SubjectKind = "issue" | "pull";
type Prefetcher = (owner: string, repo: string, number: number) => Promise<unknown>;
type PathPrefetcher = (match: RegExpExecArray, params: URLSearchParams) => void;
type Resource = keyof RateLimits;

/** How long a hover or focus must last before it prefetches. */
export const HOVER_DELAY_MS = 150;
/** Speculation stops while less than this share of a rate limit is left. */
const LOW_SHARE = 0.2;
/** Loads at a time: presses run at once, hovers and focus a few at a time, background warming one. */
const MAX_RUNNING = { press: Infinity, intent: 2, background: 1 };
const MAX_QUEUED = 6;
const REPEAT_MS = 60_000;

const prefetchers: Record<SubjectKind, Prefetcher[]> = { issue: [], pull: [] };
const pathPrefetchers: [RegExp, PathPrefetcher][] = [];
const recent = new Map<string, number>();
type Lane = keyof typeof MAX_RUNNING;
type Task = { key: string; resource: Resource; run: () => Promise<unknown> };
const queues: Record<Lane, Task[]> = { press: [], intent: [], background: [] };
const running: Record<Lane, number> = { press: 0, intent: 0, background: 0 };
/** The lane for loads queued by the current `prefetchPath` call. */
let pathLane: Lane = "intent";

export function registerPrefetcher(kind: SubjectKind, fn: Prefetcher) {
  prefetchers[kind].push(fn);
}

/** Prefetches for in-app paths matching `re`; `fn` gets the match and the URL's query parameters. */
export function registerPathPrefetcher(re: RegExp, fn: PathPrefetcher) {
  pathPrefetchers.push([re, fn]);
}

/** Whether speculative loads may spend requests from `resource` right now. */
export function canSpeculate(resource: Resource = "graphql"): boolean {
  if (!settings.get().prefetch || document.hidden) return false;
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return false;
  const r = rateLimits.get()[resource];
  if (!r || !r.limit || r.reset * 1000 < Date.now()) return true;
  return r.remaining / r.limit > LOW_SHARE;
}

/**
 * Queues a speculative load. Repeats of `key` within a minute are ignored, and when the queue is
 * full the oldest waiting load is dropped, since newer intent is a better guess. Background loads
 * have their own lane, so slow warming never delays a hovered link.
 */
export function speculate(key: string, run: () => Promise<unknown>, opts: { resource?: Resource; lane?: Lane } = {}) {
  const { resource = "graphql", lane = pathLane } = opts;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - REPEAT_MS) {
    if (lane === "press") promote(key);
    return;
  }
  if (!canSpeculate(resource)) return;
  recent.set(key, now);
  const queue = queues[lane];
  queue.push({ key, resource, run });
  if (queue.length > MAX_QUEUED) recent.delete(queue.shift()!.key);
  pump(lane);
}

/** Starts a waiting load now, since its link was pressed. */
function promote(key: string) {
  for (const lane of ["intent", "background"] as const) {
    const i = queues[lane].findIndex((t) => t.key === key);
    if (i < 0) continue;
    queues.press.push(...queues[lane].splice(i, 1));
    pump("press");
  }
}

function pump(lane: Lane) {
  const queue = queues[lane];
  while (running[lane] < MAX_RUNNING[lane] && queue.length) {
    const task = queue.pop()!;
    if (!canSpeculate(task.resource)) {
      recent.delete(task.key);
      continue;
    }
    running[lane]++;
    task
      .run()
      .catch(() => {})
      .finally(() => {
        running[lane]--;
        pump(lane);
      });
  }
}

/** Warms the cache for one issue/PR. */
export function prefetchSubject(kind: SubjectKind, owner: string, repo: string, number: number) {
  speculate(`${kind}:${owner}/${repo}#${number}`.toLowerCase(), () => Promise.all(prefetchers[kind].map((fn) => fn(owner, repo, number))));
}

/** Warms the cache for an in-app path or github.com URL, when a page registered a prefetcher for it. */
export function prefetchPath(href: string, lane: Lane = "intent") {
  pathLane = lane;
  try {
    prefetchPathNow(href);
  } finally {
    pathLane = "intent";
  }
}

function prefetchPathNow(href: string) {
  const path = toAppPath(href);
  if (!path) return;
  const url = new URL(path, location.origin);
  const pathname = url.pathname.replace(/\/$/, "");
  for (const [re, fn] of pathPrefetchers) {
    const m = re.exec(pathname);
    if (m) return fn(m, url.searchParams);
  }
  const subject = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)(\/|$)/.exec(pathname);
  if (subject) prefetchSubject(subject[3] === "pull" ? "pull" : "issue", subject[1], subject[2], Number(subject[4]));
}

let intentTimer = 0;

/** Handlers that run `fn` once the pointer or focus rests on an element, for controls that aren't links. */
export function intentHandlers(fn: () => void) {
  const start = () => {
    window.clearTimeout(intentTimer);
    intentTimer = window.setTimeout(fn, HOVER_DELAY_MS);
  };
  const stop = () => window.clearTimeout(intentTimer);
  return { onMouseEnter: start, onMouseLeave: stop, onFocus: start, onBlur: stop };
}

/**
 * Prefetches the target of any link the pointer rests on or keyboard focus reaches, and of any link
 * pressed (touch has no hover).
 */
export function installLinkPrefetch() {
  let current: HTMLAnchorElement | null = null;
  let timer = 0;
  const linkOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLAnchorElement>("a[href]") : null);
  const aim = (a: HTMLAnchorElement | null) => {
    if (a === current) return;
    window.clearTimeout(timer);
    current = a;
    if (a) timer = window.setTimeout(() => prefetchPath(a.getAttribute("href")!), HOVER_DELAY_MS);
  };
  document.addEventListener("pointerover", (e) => aim(linkOf(e.target)));
  document.addEventListener("focusin", (e) => aim(linkOf(e.target)));
  document.addEventListener("pointerdown", (e) => {
    const a = linkOf(e.target);
    if (a) prefetchPath(a.getAttribute("href")!, "press");
  });
}
