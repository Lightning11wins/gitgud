import { QueryClient, hashKey, type QueryKey } from "@tanstack/react-query";
import { experimental_createQueryPersister, type PersistedQuery } from "@tanstack/query-persist-client-core";
import { clear, createStore, del, entries, get, getMany, keys as storedKeys, set } from "idb-keyval";
import { getToken } from "@/auth/token";
import { AuthError, GitHubError } from "./client";
import { syncSubjects } from "./subjects";

const cacheDb = createStore("gitgud-cache", "queries");

/** Bump to discard every persisted query after a breaking change to cached data shapes. */
const CACHE_VERSION = "1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const persister = experimental_createQueryPersister<PersistedQuery>({
  storage: {
    getItem: (key) => get<PersistedQuery>(key, cacheDb),
    // Skip writes from requests that finish after sign-out.
    setItem: (key, value) => (getToken() ? set(key, value, cacheDb) : undefined),
    removeItem: (key) => del(key, cacheDb),
    entries: () => entries<string, PersistedQuery>(cacheDb),
  },
  // IndexedDB stores structured clones, so skip JSON round-trips.
  serialize: (q) => q,
  deserialize: (q) => q,
  buster: CACHE_VERSION,
  maxAge: MAX_AGE_MS,
  prefix: "q",
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      persister: persister.persisterFn,
      // Data this recent, like a prefetch just before a click, needs no refetch on mount.
      staleTime: 10_000,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (count, err) => !(err instanceof AuthError) && !(err instanceof GitHubError && err.status < 500) && count < 2,
    },
  },
});

syncSubjects(queryClient);

/** Query key roots that `restoreRecent` loads at startup: lists and their counts, which pages show first. */
const RESTORE_ROOTS = ["repo-list", "list-checks", "repo-header", "dashboard"];
const RESTORE_MAX = 60;

/**
 * Reads the most recently fetched lists from IndexedDB into memory. Pages then render from memory on
 * the first frame, and other pages can borrow their rows (see `api/subjects.ts`). Call `apply` once
 * the user is known to be signed in.
 */
export function readRecent(): Promise<{ apply: () => void }> {
  const read = async () => {
    const prefixes = RESTORE_ROOTS.map((r) => `q-["${r}"`);
    const wanted = (await storedKeys(cacheDb)).filter((k): k is string => typeof k === "string" && prefixes.some((p) => k.startsWith(p)));
    const stored = (await getMany<PersistedQuery | undefined>(wanted, cacheDb)).filter(
      (q): q is PersistedQuery => !!q && q.buster === CACHE_VERSION && q.state.dataUpdatedAt > Date.now() - MAX_AGE_MS,
    );
    return stored.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, RESTORE_MAX);
  };
  return read().then(
    (stored) => ({
      apply: () => {
        // Oldest first, so subject sync spreads the newest copies last.
        for (const q of [...stored].reverse()) {
          if (queryClient.getQueryData(q.queryKey) === undefined) queryClient.setQueryData(q.queryKey, q.state.data, { updatedAt: q.state.dataUpdatedAt });
        }
      },
    }),
    () => ({ apply: () => {} }),
  );
}

export async function clearCache() {
  queryClient.clear();
  await clear(cacheDb);
}

/** Bytes used by this origin (cache, drafts, token), as reported by the browser. */
export async function storageUsage(): Promise<number | undefined> {
  return (await navigator.storage?.estimate?.())?.usage;
}

/** Writes a query's current in-memory state to IndexedDB, e.g. after an optimistic `setQueryData`. */
export function persistQueryData(key: QueryKey) {
  void persister.persistQueryByKey(key, queryClient).catch(() => {});
}

export function cachedData<T>(key: QueryKey): T | undefined {
  return queryClient.getQueryData<T>(key);
}

/**
 * Cheap freshness check for expensive queries. Runs `probe` (a small query returning a
 * version stamp like `updatedAt`) and returns the cached value when the stamp matches;
 * otherwise runs `load`. Cached values must carry the stamp as `stamp`.
 *
 *   queryFn: () => probeThenLoad(key, () => fetchUpdatedAt(), (stamp) => fetchAll(stamp))
 */
export async function probeThenLoad<T extends { stamp: string }>(
  key: QueryKey,
  probe: () => Promise<string>,
  load: (stamp: string) => Promise<T>,
): Promise<T> {
  const cached = queryClient.getQueryData<T>(key) ?? (await persistedData<T>(key));
  if (cached) {
    const stamp = await probe();
    if (stamp === cached.stamp) return cached;
    return load(stamp);
  }
  return load(await probe());
}

export async function persistedData<T>(key: QueryKey): Promise<T | undefined> {
  const stored = await get<PersistedQuery>(`q-${hashKey(key)}`, cacheDb).catch(() => undefined);
  if (!stored || stored.buster !== CACHE_VERSION) return undefined;
  return stored.state.data as T | undefined;
}
