import { createContext, useContext, useEffect, useRef } from "react";

/** False inside UI that stays mounted while hidden (e.g. inactive PR tabs), disabling its hotkeys. */
export const HotkeysActive = createContext(true);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/**
 * Binds a single-key shortcut like "j", "/", "?" or "shift+R". Ignored while typing in a field
 * or when a modifier other than shift is held. Pass `enabled: false` to unbind temporarily.
 */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  enabled = useContext(HotkeysActive) && enabled;
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const wantShift = key.startsWith("shift+");
    const k = wantShift ? key.slice(6) : key;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key.toLowerCase() !== k.toLowerCase() && e.key !== k) return;
      if (wantShift !== e.shiftKey && k.length === 1 && /[a-z]/i.test(k)) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, enabled]);
}
