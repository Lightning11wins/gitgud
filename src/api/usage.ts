import { createStore } from "@/lib/store";

/** A GitHub rate limit, as named by the `x-ratelimit-resource` header. */
export type UsageResource = "core" | "graphql" | "search";

/** What one operation spent. */
export interface Spent {
  requests: number;
  points: number;
  /** Points counted as 1 per request because GitHub didn't report a cost. */
  estimated: number;
  /** Requests that cost nothing, like unchanged (304) responses. */
  free: number;
}

/** What one operation spent in one minute. */
export interface UsageEntry extends Spent {
  /** Start of the minute, in ms since the epoch. */
  minute: number;
  resource: UsageResource;
  /** GraphQL operation name, or REST method and path template. */
  name: string;
}

/** One operation's spending over a range. */
export interface OperationUsage extends Spent {
  resource: UsageResource;
  name: string;
}

/** A tab's entries for one account, keyed by minute, then by `${resource} ${name}`. */
type Ledger = Record<string, Record<string, Spent>>;

const PREFIX = "gitgud-usage:";
const KEEP_MS = 24 * 60 * 60_000;
const SAVE_DELAY_MS = 1000;

const tabId = Math.random().toString(36).slice(2, 10);
/** This tab's ledgers, by login. */
const own = new Map<string, Ledger>();
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Bumps whenever this tab or another one records usage. */
export const usageVersion = createStore(0);
const bump = () => usageVersion.set(usageVersion.get() + 1);

const keyFor = (login: string, tab: string) => `${PREFIX}${login}:${tab}`;

/** Adds one request's cost to this tab's usage for `login`. Saved for every tab to read for 24 hours. */
export function recordUsage(login: string, resource: UsageResource, name: string, cost: { points: number; estimated?: boolean; free?: boolean }) {
  const ledger = own.get(login) ?? {};
  own.set(login, ledger);
  const minute = String(Math.floor(Date.now() / 60_000) * 60_000);
  const ops = (ledger[minute] ??= {});
  const spent = (ops[`${resource} ${name}`] ??= { requests: 0, points: 0, estimated: 0, free: 0 });
  spent.requests++;
  spent.points += cost.points;
  if (cost.estimated) spent.estimated += cost.points;
  if (cost.free) spent.free++;
  dirty.add(login);
  saveTimer ??= setTimeout(save, SAVE_DELAY_MS);
  bump();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const cutoff = Date.now() - KEEP_MS;
  for (const login of dirty) {
    const ledger = own.get(login)!;
    for (const minute of Object.keys(ledger)) if (Number(minute) < cutoff) delete ledger[minute];
    try {
      localStorage.setItem(keyFor(login, tabId), JSON.stringify(ledger));
    } catch {
      // Storage blocked or full; this tab's usage shows only here.
    }
  }
  dirty.clear();
}

function readLedger(key: string): Ledger {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Every tab's usage for `login` in the last 24 hours, including tabs that have closed. */
export function usageEntries(login: string): UsageEntry[] {
  const cutoff = Date.now() - KEEP_MS;
  const ownKey = keyFor(login, tabId);
  const ledgers = [own.get(login) ?? {}];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${PREFIX}${login}:`) && key !== ownKey) ledgers.push(readLedger(key));
  }
  const entries: UsageEntry[] = [];
  for (const ledger of ledgers) {
    for (const [minute, ops] of Object.entries(ledger)) {
      if (Number(minute) < cutoff) continue;
      for (const [op, spent] of Object.entries(ops)) {
        const space = op.indexOf(" ");
        entries.push({ minute: Number(minute), resource: op.slice(0, space) as UsageResource, name: op.slice(space + 1), ...spent });
      }
    }
  }
  return entries;
}

/** Totals `entries` per operation, most points first. */
export function usageByOperation(entries: UsageEntry[]): OperationUsage[] {
  const byOp = new Map<string, OperationUsage>();
  for (const e of entries) {
    const key = `${e.resource} ${e.name}`;
    const sum = byOp.get(key) ?? { resource: e.resource, name: e.name, requests: 0, points: 0, estimated: 0, free: 0 };
    sum.requests += e.requests;
    sum.points += e.points;
    sum.estimated += e.estimated;
    sum.free += e.free;
    byOp.set(key, sum);
  }
  return [...byOp.values()].sort((a, b) => b.points - a.points || b.requests - a.requests);
}

/** Deletes saved ledgers whose usage is all older than 24 hours, like those of tabs closed a day ago. */
function pruneSaved() {
  const cutoff = Date.now() - KEEP_MS;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX) && Object.keys(readLedger(key)).every((m) => Number(m) < cutoff)) stale.push(key);
  }
  stale.forEach((key) => localStorage.removeItem(key));
}

try {
  pruneSaved();
} catch {
  // Storage blocked.
}
globalThis.addEventListener?.("pagehide", () => {
  if (dirty.size) save();
});
globalThis.addEventListener?.("storage", (e: StorageEvent) => {
  if (e.key?.startsWith(PREFIX)) bump();
});

/** Path parameters in REST paths, by the segment before them. `*` takes the rest of the path. */
const PATH_PARAMS: Record<string, string> = { pulls: "{number}", issues: "{number}", commits: "{ref}", compare: "{basehead}", contents: "*{path}" };

/** A REST request's method and path template, like `GET /repos/{owner}/{repo}/pulls/{number}/files`. */
export function restOperationName(method: string, path: string): string {
  const segments = path.replace(/^https:\/\/api\.github\.com/, "").replace(/[?#].*/, "").split("/");
  if (segments[1] === "repos" && segments.length > 3) segments.splice(2, 2, "{owner}", "{repo}");
  for (let i = 4; i < segments.length - 1; i++) {
    const param = PATH_PARAMS[segments[i]];
    if (!param) continue;
    if (param.startsWith("*")) {
      segments.splice(i + 1, segments.length, param.slice(1));
      break;
    }
    segments[++i] = param;
  }
  return `${method} ${segments.join("/")}`;
}
