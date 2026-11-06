import { QueryClient, hashKey, type QueryKey } from "@tanstack/react-query";
import { experimental_createQueryPersister, type PersistedQuery } from "@tanstack/query-persist-client-core";
import { clear, createStore, del, entries, get, set } from "idb-keyval";
import { getToken } from "@/auth/token";
import { AuthError, GitHubError } from "./client";

const cacheDb = createStore("gitgud-cache", "queries");

/** Bump to discard every persisted query after a breaking change to cached data shapes. */
const CACHE_VERSION = "1";

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
  maxAge: 1000 * 60 * 60 * 24 * 30,
  prefix: "q",
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      persister: persister.persisterFn,
      staleTime: 0,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (count, err) => !(err instanceof AuthError) && !(err instanceof GitHubError && err.status < 500) && count < 2,
    },
  },
});

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
