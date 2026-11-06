import { clear, createStore, del, get, set } from "idb-keyval";

const draftDb = createStore("gitgud-drafts", "drafts");

/** Debounced writes by key; `set`, `clear`, and `clearAll` cancel them. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function cancel(key: string) {
  clearTimeout(pending.get(key));
  pending.delete(key);
}

/**
 * Unsent comment text, keyed by a caller-chosen string like `owner/repo#12:comment`
 * or `owner/repo#12:reply:<threadId>`. Survives reloads and crashes.
 */
export const drafts = {
  get: (key: string) => get<string>(key, draftDb).catch(() => undefined),
  set: (key: string, text: string) => {
    cancel(key);
    return (text ? set(key, text, draftDb) : del(key, draftDb)).catch(() => {});
  },
  /** Saves `text` once typing pauses. The write still happens if the caller unmounts first. */
  setSoon: (key: string, text: string, ms = 250) => {
    cancel(key);
    pending.set(key, setTimeout(() => void drafts.set(key, text), ms));
  },
  clear: (key: string) => {
    cancel(key);
    return del(key, draftDb).catch(() => {});
  },
  clearAll: () => {
    pending.forEach(clearTimeout);
    pending.clear();
    return clear(draftDb).catch(() => {});
  },
};
