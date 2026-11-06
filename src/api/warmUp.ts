import { auth } from "@/auth/token";
import { settings } from "@/lib/settings";
import { gql, rest } from "./client";
import { rateLimits, type RateLimitState } from "./rateLimit";

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

/** Reads every limit for free, starts the windows that aren't running, and returns when to check again. */
async function checkLimits(): Promise<number> {
  const { resources } = await rest<{ resources: Record<string, LimitInfo> }>("/rate_limit");
  const limits = { ...rateLimits.get() };
  for (const r of RESOURCES) {
    const info = resources[r];
    if (!info) continue;
    if (info.used) limits[r] = { remaining: info.remaining, limit: info.limit, reset: info.reset };
    else delete limits[r];
  }
  rateLimits.set(limits);
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

/** Starts each hourly rate limit window as it resets, while signed in with the setting on. */
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
  // Timers stall while the computer sleeps; catch up when the tab shows again.
  document.addEventListener("visibilitychange", () => {
    if (!running || document.visibilityState !== "visible" || !dueAt || Date.now() < dueAt + 5000) return;
    clearTimeout(timer);
    void check();
  });
}
