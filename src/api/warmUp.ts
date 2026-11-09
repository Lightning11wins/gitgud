import { auth } from "@/auth/token";
import { settings } from "@/lib/settings";
import { gql, rest } from "./client";
import { mergeRateLimits, type RateLimits, type RateLimitState } from "./rateLimit";

/** Rate limits with hourly windows. Search resets every minute, so it has none worth starting. */
const RESOURCES = ["core", "graphql"] as const;
type Resource = (typeof RESOURCES)[number];

export interface LimitInfo extends RateLimitState {
  used: number;
}

const WINDOW_MS = 60 * 60_000;
/** Delay past a reset, so GitHub has opened the new window. */
const AFTER_RESET_MS = 2000;
const MIN_DELAY_MS = 60_000;
const RETRY_MS = 5 * 60_000;
/** Readings older than this are reread when a tab shows. */
const STALE_MS = 30_000;

/** Which limits have no window running and need a request now, and when to check again. */
export function planWarmUp(resources: Partial<Record<string, LimitInfo>>, now: number): { warm: Resource[]; checkAt: number } {
  const warm: Resource[] = [];
  let checkAt = Infinity;
  for (const r of RESOURCES) {
    const info = resources[r];
    if (!info) continue;
    if (info.used === 0) warm.push(r);
    const reset = info.used === 0 ? now + WINDOW_MS : info.reset * 1000;
    checkAt = Math.min(checkAt, reset + AFTER_RESET_MS);
  }
  return { warm, checkAt: Number.isFinite(checkAt) ? Math.max(checkAt, now + MIN_DELAY_MS) : now + RETRY_MS };
}

function warmUp(resource: Resource): Promise<unknown> {
  return resource === "core" ? rest("/user") : gql("query WarmUp { viewer { login } }");
}

let readAt = 0;
let reading: Promise<Record<string, LimitInfo>> | undefined;

/** Reads every limit from `/rate_limit`, which costs nothing, and merges the running windows into `rateLimits`. */
async function readLimits(): Promise<Record<string, LimitInfo>> {
  const { resources } = await rest<{ resources: Record<string, LimitInfo> }>("/rate_limit");
  readAt = Date.now();
  const updates: RateLimits = {};
  for (const r of ["core", "graphql", "search"] as const) {
    const info = resources[r];
    if (info?.used) updates[r] = { remaining: info.remaining, limit: info.limit, reset: info.reset };
  }
  mergeRateLimits(updates);
  return resources;
}

/** Rereads every limit, sharing a read already in flight. */
export function refreshRateLimits(): Promise<unknown> {
  reading ??= readLimits().finally(() => (reading = undefined));
  return reading;
}

/** Reads every limit, starts the windows that aren't running, and returns when to check again. */
async function checkLimits(): Promise<number> {
  const resources = await readLimits();
  const plan = planWarmUp(resources, Date.now());
  await Promise.all(plan.warm.map(warmUp));
  return plan.checkAt;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;
let generation = 0;

async function check() {
  const gen = generation;
  dueAt = 0;
  let next: number;
  try {
    // One tab at a time, so the others see the window already started.
    next = await (navigator.locks ? navigator.locks.request("gitgud-warm-up", checkLimits) : checkLimits());
  } catch {
    next = Date.now() + RETRY_MS;
  }
  if (gen !== generation) return;
  dueAt = next;
  timer = setTimeout(check, next - Date.now());
}

/** Starts each hourly rate limit window as it resets, while signed in with the setting on. Rereads stale limits when a tab shows. */
export function startWarmUp() {
  let running = false;
  const sync = () => {
    const enabled = auth.get().status === "signed-in" && settings.get().warmUpRateLimits;
    if (enabled === running) return;
    running = enabled;
    generation++;
    clearTimeout(timer);
    dueAt = 0;
    if (running) void check();
  };
  auth.subscribe(sync);
  settings.subscribe(sync);
  sync();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || auth.get().status !== "signed-in") return;
    // Timers stall while the computer sleeps; catch up when the tab shows again.
    if (running && dueAt && Date.now() >= dueAt + 5000) {
      clearTimeout(timer);
      void check();
    } else if (Date.now() - readAt > STALE_MS) {
      // Other tabs and apps spend the same limits.
      refreshRateLimits().catch(() => {});
    }
  });
}
