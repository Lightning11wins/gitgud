import { useSyncExternalStore } from "react";
import { createStore } from "./store";

export type ThemePref = "system" | "light" | "dark";

const KEY = "gitgud-theme";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const themePref = createStore<ThemePref>(read());

function apply(pref: ThemePref) {
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

apply(themePref.get());

export function setTheme(pref: ThemePref) {
  themePref.set(pref);
  apply(pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked; the choice lasts for this session.
  }
}

/** Whether dark colors are showing right now. */
export function isDark(): boolean {
  const pref = themePref.get();
  if (pref !== "system") return pref === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeDark(listener: () => void): () => void {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const off = themePref.subscribe(listener);
  query.addEventListener("change", listener);
  return () => {
    off();
    query.removeEventListener("change", listener);
  };
}

/** Whether dark colors are showing, updating when the theme or system setting changes. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribeDark, isDark);
}
