import { clear, createStore, del, get, set } from "idb-keyval";

const draftDb = createStore("gitgud-drafts", "drafts");

/**
 * Unsent comment text, keyed by a caller-chosen string like `owner/repo#12:comment`
 * or `owner/repo#12:reply:<threadId>`. Survives reloads and crashes.
 */
export const drafts = {
  get: (key: string) => get<string>(key, draftDb).catch(() => undefined),
  set: (key: string, text: string) => (text ? set(key, text, draftDb) : del(key, draftDb)).catch(() => {}),
  clear: (key: string) => del(key, draftDb).catch(() => {}),
  clearAll: () => clear(draftDb).catch(() => {}),
};
