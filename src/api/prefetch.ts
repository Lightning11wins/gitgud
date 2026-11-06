/**
 * Lets list views warm the cache for items the user is likely to open (e.g. on hover)
 * without depending on the page modules. Pages register a prefetcher for their data.
 */
export type SubjectKind = "issue" | "pull";
type Prefetcher = (owner: string, repo: string, number: number) => void;

const prefetchers: Record<SubjectKind, Prefetcher[]> = { issue: [], pull: [] };
const recent = new Map<string, number>();

export function registerPrefetcher(kind: SubjectKind, fn: Prefetcher) {
  prefetchers[kind].push(fn);
}

/** Warms the cache for one issue/PR. Repeated calls within a minute are ignored. */
export function prefetchSubject(kind: SubjectKind, owner: string, repo: string, number: number) {
  const key = `${kind}:${owner}/${repo}#${number}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 60_000) return;
  recent.set(key, now);
  for (const fn of prefetchers[kind]) fn(owner, repo, number);
}
