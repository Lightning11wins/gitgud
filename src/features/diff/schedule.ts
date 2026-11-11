import { startTransition, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Upgrades diff chunks (mount, then apply syntax tokens) right away when they're near the
 * viewport, and otherwise one at a time while the main thread is idle and not scrolling,
 * so every line ends up in the DOM for Ctrl+F without janking the scroll.
 */
interface Task {
  el: Element;
  weight: number;
  /** An idle grant passes `done`, to call once it has rendered or will never need to. */
  grant: (urgent: boolean, done: () => void) => void;
}

const NEAR_MARGIN = "1200px 0px";
const IDLE_BUDGET_ROWS = 160;
const SCROLL_QUIET_MS = 150;

const tasks = new Set<Task>();
const byEl = new Map<Element, Set<Task>>();
const near = new Set<Element>();
const nearListeners = new Map<Element, Set<() => void>>();
let io: IntersectionObserver | null = null;
let lastScroll = 0;
let idleHandle: number | null = null;
/**
 * Idle grants not yet rendered. The next batch waits for these: input interrupts transition renders, so batches
 * granted meanwhile would pile up until React expires them and renders all at once, freezing the page.
 */
let inFlight = 0;

const ric: (cb: (d: { timeRemaining: () => number }) => void) => number =
  typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 500 }) : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 32);

function observer(): IntersectionObserver {
  if (io) return io;
  window.addEventListener("scroll", () => (lastScroll = performance.now()), { passive: true, capture: true });
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) near.add(e.target);
        else near.delete(e.target);
        nearListeners.get(e.target)?.forEach((l) => l());
        if (!e.isIntersecting) continue;
        const set = byEl.get(e.target);
        if (set) for (const t of [...set]) run(t, true);
      }
    },
    { rootMargin: NEAR_MARGIN },
  );
  return io;
}

function observe(el: Element) {
  const refs = (byEl.get(el)?.size ?? 0) + (nearListeners.get(el)?.size ?? 0);
  if (refs === 0) observer().observe(el);
}

function unobserve(el: Element) {
  const refs = (byEl.get(el)?.size ?? 0) + (nearListeners.get(el)?.size ?? 0);
  if (refs === 0) {
    io?.unobserve(el);
    near.delete(el);
  }
}

function run(t: Task, urgent: boolean) {
  remove(t);
  if (urgent) return t.grant(true, () => {});
  inFlight++;
  let pending = true;
  t.grant(false, () => {
    if (!pending) return;
    pending = false;
    inFlight--;
    pump();
  });
}

function remove(t: Task) {
  tasks.delete(t);
  const set = byEl.get(t.el);
  set?.delete(t);
  if (set && !set.size) byEl.delete(t.el);
  unobserve(t.el);
}

function pump() {
  if (idleHandle !== null || inFlight || !tasks.size) return;
  idleHandle = ric((deadline) => {
    idleHandle = null;
    if (performance.now() - lastScroll < SCROLL_QUIET_MS) return pump();
    let budget = IDLE_BUDGET_ROWS;
    for (const t of tasks) {
      if (budget <= 0 || deadline.timeRemaining() < 4) break;
      budget -= t.weight;
      run(t, false);
    }
    pump();
  });
}

function schedule(el: Element, weight: number, grant: Task["grant"]): () => void {
  observe(el);
  const t: Task = { el, weight, grant };
  if (near.has(el)) {
    grant(true, () => {});
    unobserve(el);
    return () => {};
  }
  tasks.add(t);
  let set = byEl.get(el);
  if (!set) byEl.set(el, (set = new Set()));
  set.add(t);
  pump();
  return () => remove(t);
}

/** False until the element is near the viewport or its idle turn comes; then true for good. */
export function useScheduled(ref: RefObject<Element | null>, want: boolean, weight: number): boolean {
  const [granted, setGranted] = useState(false);
  const done = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!want || granted || !ref.current) return;
    return schedule(ref.current, weight, (urgent, d) => {
      done.current = d;
      if (urgent) setGranted(true);
      else startTransition(() => setGranted(true));
    });
  }, [ref, want, granted, weight]);
  useEffect(() => {
    if (granted) done.current?.();
  }, [granted]);
  useEffect(() => () => done.current?.(), []);
  return granted;
}

/** Whether the element is within the prefetch margin of the viewport. */
export function useNear(ref: RefObject<Element | null>): boolean {
  const [isNear, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    observe(el);
    const l = () => setNear(near.has(el));
    let set = nearListeners.get(el);
    if (!set) nearListeners.set(el, (set = new Set()));
    set.add(l);
    l();
    return () => {
      set.delete(l);
      if (!set.size) nearListeners.delete(el);
      unobserve(el);
    };
  }, [ref]);
  return isNear;
}
