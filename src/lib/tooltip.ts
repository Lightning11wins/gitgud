/**
 * Tooltips like GitHub's: a dark bubble below the element, shown on hover and keyboard focus.
 * Elements opt in with the props from `tooltip`; one listener on the document shows them all.
 */

/** How long the pointer must rest on an element before its tooltip shows, so passing over it shows nothing. */
const SHOW_DELAY_MS = 50;
/** Gap between the element and its tooltip. */
const GAP = 4;
/** Closest the tooltip comes to the viewport edges. */
const MARGIN = 8;

/**
 * Props that show `text` in a tooltip and expose it to assistive tech. A "label" tooltip names an
 * element with no text of its own, like an icon button. A "description" adds to the name an element
 * already has. Without `text`, there's no tooltip.
 *
 * Use this instead of `title`, except for the full text of truncated strings, which keeps the
 * browser's tooltip like GitHub does.
 */
export function tooltip(text: string | null | undefined, kind: "label" | "description" = "description") {
  if (!text) return {};
  return kind === "label" ? { "data-tooltip": text, "aria-label": text } : { "data-tooltip": text, "aria-description": text };
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where a tooltip of `size` goes for an element at `anchor`: centered below it, or above when it doesn't fit below. */
export function placeTooltip(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - size.height;
  const side = below + size.height > viewport.height - MARGIN && above >= MARGIN ? "above" : "below";
  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.max(MARGIN, Math.min(centered, viewport.width - MARGIN - size.width));
  return { top: side === "below" ? below : above, left, side } as const;
}

/** Starts showing tooltips for elements with `data-tooltip`. Call once at startup. */
export function installTooltips() {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.popover = "manual";
  // Elements carry their own text for assistive tech (see `tooltip`), so this copy would repeat it.
  tip.setAttribute("aria-hidden", "true");
  document.body.append(tip);

  /** The element whose tooltip shows, or will once the delay passes. */
  let current: HTMLElement | null = null;
  let timer = 0;
  const watcher = new MutationObserver(() => {
    if (current) show(current);
  });

  const show = (el: HTMLElement) => {
    const text = el.dataset.tooltip;
    if (!text || !el.isConnected) return hide();
    tip.textContent = text;
    if (!tip.matches(":popover-open")) tip.showPopover();
    const r = el.getBoundingClientRect();
    const place = placeTooltip(r, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: innerWidth, height: innerHeight });
    tip.style.top = `${place.top}px`;
    tip.style.left = `${place.left}px`;
    tip.dataset.side = place.side;
  };
  const hide = () => {
    clearTimeout(timer);
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  /** Makes `el` the element with the tooltip; it shows after `delay`, and again whenever its text changes. */
  const target = (el: HTMLElement | null, delay: number) => {
    if (el === current) return;
    hide();
    watcher.disconnect();
    current = el;
    if (!el) return;
    watcher.observe(el, { attributes: true, attributeFilter: ["data-tooltip"] });
    timer = window.setTimeout(() => show(el), delay);
  };
  const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null);

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    // The pointer may cross onto the tooltip, so people can move it out of the way or magnify it.
    if (tip.contains(e.target as Node)) return;
    target(owner(e.target), SHOW_DELAY_MS);
  });
  document.documentElement.addEventListener("pointerleave", () => target(null, 0));
  document.addEventListener("focusin", (e) => {
    const el = owner(e.target);
    if (el && (e.target as Element).matches(":focus-visible")) target(el, 0);
  });
  document.addEventListener("focusout", (e) => {
    if (owner(e.target) === current) target(null, 0);
  });
  // A press acts on the element, so get out of the way of what it opens. The tooltip stays the
  // element's and comes back if the press changes its text, like "Copied!".
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  addEventListener("scroll", hide, { capture: true, passive: true });
  addEventListener("resize", hide);
  addEventListener("blur", hide);
}
