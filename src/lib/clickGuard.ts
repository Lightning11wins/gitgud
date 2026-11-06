/**
 * Drops clicks that land on a control only because the page moved under a still pointer, like a row
 * pushed down by content that just loaded. The user aimed at whatever was there before.
 *
 * While the pointer rests, the control under it is sampled a few times a second. When that control
 * changes without the pointer moving, clicks on the new one are ignored for a moment.
 */

/** Controls a click can act on. */
const ACTIONABLE = "a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=menuitem], [role=option], [role=tab], [tabindex]";
const SAMPLE_MS = 100;
/** How long after a shift clicks on the newly arrived control are dropped. */
export const SHIFT_GRACE_MS = 600;
/** Changes this soon after a click, key press, or scroll are the user's doing, like a menu opening. */
const INPUT_GRACE_MS = 300;
/** Changes this soon after the pointer moves are hover effects, like a button revealed on a row. */
const MOVE_GRACE_MS = 120;

export interface ShiftState {
  x: number;
  y: number;
  /** The control under the pointer at the last sample. */
  under: Element | null;
  /** When the control under a still pointer last changed. */
  shiftedAt: number;
  /** The control that arrived with that change. */
  arrived: Element | null;
  inputAt: number;
  movedAt: number;
}

export const actionableAt = (el: Element | null) => el?.closest(ACTIONABLE) ?? null;

/** Records a sample: whether the control under an unmoved pointer changed. */
export function sample(s: ShiftState, under: Element | null, now: number) {
  if (under !== s.under && now - s.inputAt > INPUT_GRACE_MS && now - s.movedAt > MOVE_GRACE_MS) {
    s.shiftedAt = now;
    s.arrived = under;
  }
  s.under = under;
}

/** Whether a click on `target` should be dropped. Keyboard clicks are always kept. */
export function shouldDrop(s: ShiftState, target: Element | null, now: number, fromKeyboard: boolean): boolean {
  if (fromKeyboard || !s.arrived || now - s.shiftedAt > SHIFT_GRACE_MS) return false;
  return actionableAt(target) === s.arrived;
}

export function installClickGuard() {
  const s: ShiftState = { x: -1, y: -1, under: null, shiftedAt: 0, arrived: null, inputAt: 0, movedAt: 0 };
  let timer = 0;
  const tick = () => {
    if (s.x < 0 || document.hidden) return;
    sample(s, actionableAt(document.elementFromPoint(s.x, s.y)), performance.now());
  };
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      if (e.clientX === s.x && e.clientY === s.y) return;
      s.x = e.clientX;
      s.y = e.clientY;
      s.movedAt = performance.now();
      // The pointer moved, so whatever is under it now is what the user aimed at. A shift just
      // before stays recorded: small movements while clicking don't mean the user saw it.
      s.under = actionableAt(e.target as Element);
      if (!timer) timer = window.setInterval(tick, SAMPLE_MS);
    },
    { passive: true },
  );
  document.addEventListener("mouseout", (e) => {
    if (e.relatedTarget) return;
    s.x = s.y = -1;
    s.arrived = null;
    window.clearInterval(timer);
    timer = 0;
  });
  const input = () => (s.inputAt = performance.now());
  document.addEventListener("pointerdown", input, { capture: true, passive: true });
  document.addEventListener("keydown", input, { capture: true, passive: true });
  // Scrolling moves content under the pointer on purpose.
  document.addEventListener("wheel", input, { capture: true, passive: true });
  window.addEventListener("scroll", input, { capture: true, passive: true });
  window.addEventListener(
    "click",
    (e) => {
      // `detail` is 0 for clicks synthesized from Enter or Space.
      if (!shouldDrop(s, e.target as Element, performance.now(), e.detail === 0)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
