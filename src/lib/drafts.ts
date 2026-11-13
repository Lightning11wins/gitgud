import { clear, createStore as createIdbStore, del, get, set } from "idb-keyval";
import { createStore, useStore } from "./store";

const draftDb = createIdbStore("gitgud-drafts", "drafts");

/** Debounced writes by key; `set`, `clear`, and `clearAll` cancel them. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Drafts whose last save failed, with the error, until a later save of the same key succeeds. */
const failures = createStore<ReadonlyMap<string, Error>>(new Map());

function setFailure(key: string, error: Error | undefined) {
  const current = failures.get();
  if (!error && !current.has(key)) return;
  const next = new Map(current);
  if (error) next.set(key, error);
  else next.delete(key);
  failures.set(next);
}

// Leaving with an unsaved draft loses it, so ask first.
const confirmLeave = (e: BeforeUnloadEvent) => e.preventDefault();
failures.subscribe(() => {
  if (failures.get().size) window.addEventListener("beforeunload", confirmLeave);
  else window.removeEventListener("beforeunload", confirmLeave);
});

function cancel(key: string) {
  clearTimeout(pending.get(key));
  pending.delete(key);
}

async function write(key: string, text: string) {
  try {
    await (text ? set(key, text, draftDb) : del(key, draftDb));
    setFailure(key, undefined);
  } catch (e) {
    setFailure(key, new Error(`Failed to save your draft: ${e instanceof Error ? e.message : String(e)}`, { cause: e }));
  }
}

/**
 * Unsent comment text, keyed by a caller-chosen string like `owner/repo#12:comment`
 * or `owner/repo#12:reply:<threadId>`. Survives reloads and crashes. A failed save is reported by
 * `useDraftError` rather than thrown, so callers needn't handle it.
 */
export const drafts = {
  get: (key: string) => get<string>(key, draftDb).catch(() => undefined),
  set: (key: string, text: string) => {
    cancel(key);
    return write(key, text);
  },
  /** Saves `text` once typing pauses. The write still happens if the caller unmounts first. */
  setSoon: (key: string, text: string, ms = 250) => {
    cancel(key);
    pending.set(key, setTimeout(() => void write(key, text), ms));
  },
  clear: (key: string) => {
    cancel(key);
    return write(key, "");
  },
  /** Erases every draft. Throws when they can't be erased, so another account never sees them. */
  clearAll: async () => {
    pending.forEach(clearTimeout);
    pending.clear();
    await clear(draftDb);
    if (failures.get().size) failures.set(new Map());
  },
};

/** Why the draft at `key` couldn't be saved, or undefined when its last save succeeded. */
export function useDraftError(key: string): Error | undefined {
  return useStore(failures).get(key);
}
