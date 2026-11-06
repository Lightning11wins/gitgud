import { useQuery, type Query } from "@tanstack/react-query";
import { gql, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { probeThenLoad, queryClient } from "@/api/queryClient";
import type { SubjectKind } from "@/api/prefetch";
import { ISSUE_ITEM_TYPES, ISSUE_TIMELINE_QUERY, PULL_ITEM_TYPES, PULL_TIMELINE_QUERY, SUBJECT_STAMP_QUERY } from "./queries";
import type { TimelineData, TimelineItem } from "./types";

/** Cached timelines older than this are refetched from scratch so edits by others show up. */
const FULL_RELOAD_MS = 30 * 60_000;
/** A subject meta query fetched this recently counts as a fresh probe. */
const META_FRESH_MS = 10_000;

/** Timeline items per request; the API maximum. */
const PAGE_SIZE = 100;
/** Concurrent page requests once the item count is known. */
const PARALLEL = 8;

interface Page {
  nodes: TimelineItem[];
  pageInfo: PageInfo;
  /** Matching items after the `after` cursor. */
  filteredCount: number;
}

interface PageResult {
  page: Page;
  /** Matching items in the whole timeline, when requested. */
  total?: number;
}

type TimelineHolder = { timelineItems: Page; total?: { filteredCount: number } | null } | null;

async function fetchPage(kind: SubjectKind, owner: string, repo: string, number: number, after: string | null, skip: number, withTotal: boolean): Promise<PageResult> {
  const vars = { owner, repo, number, after, skip: skip || null, withTotal };
  let holder: TimelineHolder;
  if (kind === "issue") {
    const d = await gql<{ repository: { issue: TimelineHolder } }>(ISSUE_TIMELINE_QUERY, { ...vars, types: ISSUE_ITEM_TYPES });
    holder = d.repository.issue;
  } else {
    const d = await gql<{ repository: { pullRequest: TimelineHolder } }>(PULL_TIMELINE_QUERY, { ...vars, types: PULL_ITEM_TYPES });
    holder = d.repository.pullRequest;
  }
  if (!holder) throw new Error(`Failed to load the timeline: ${owner}/${repo}#${number} is not ${kind === "issue" ? "an issue" : "a pull request"}`);
  return { page: holder.timelineItems, total: holder.total?.filteredCount };
}

interface FetchResult {
  items: TimelineItem[];
  endCursor: string | null;
  complete: boolean;
  /** Matching items in the whole timeline. */
  total: number;
}

/**
 * Fetches every item after `base` (or from the start), merging by id. The first page reveals the
 * count, so the rest are fetched in parallel by offset from its cursor. Progress is reported in order.
 */
async function fetchItems(
  kind: SubjectKind,
  owner: string,
  repo: string,
  number: number,
  base: TimelineData | null,
  maxPages: number,
  onProgress: (items: TimelineItem[], endCursor: string | null) => void,
): Promise<FetchResult> {
  const items = base ? [...base.items] : [];
  const index = new Map(items.map((it, i) => [it.id, i]));
  const add = (page: Page) => {
    for (const node of page.nodes) {
      const i = index.get(node.id);
      if (i === undefined) {
        index.set(node.id, items.length);
        items.push(node);
      } else items[i] = node;
    }
  };

  const first = await fetchPage(kind, owner, repo, number, base?.endCursor ?? null, 0, true);
  let last = first.page;
  let endCursor = last.pageInfo.endCursor ?? base?.endCursor ?? null;
  let pages = 1;
  add(last);
  onProgress(items, endCursor);

  const from = last.pageInfo.endCursor;
  const count = last.pageInfo.hasNextPage ? Math.min(Math.ceil((last.filteredCount - last.nodes.length) / PAGE_SIZE), maxPages - pages) : 0;
  if (count > 0) {
    const results: Page[] = [];
    let next = 0;
    let merged = 0;
    const worker = async () => {
      while (next < count) {
        const i = next++;
        results[i] = (await fetchPage(kind, owner, repo, number, from, i * PAGE_SIZE, false)).page;
        if (merged !== i) continue;
        while (results[merged]) {
          last = results[merged++];
          add(last);
          endCursor = last.pageInfo.endCursor ?? endCursor;
        }
        onProgress(items, endCursor);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));
    pages += count;
  }

  // Items added while loading, or a stale count: continue by cursor.
  while (last.pageInfo.hasNextPage && pages < maxPages) {
    last = (await fetchPage(kind, owner, repo, number, endCursor, 0, false)).page;
    pages++;
    add(last);
    endCursor = last.pageInfo.endCursor ?? endCursor;
    onProgress(items, endCursor);
  }
  return { items, endCursor, complete: !last.pageInfo.hasNextPage, total: first.total ?? items.length };
}

/**
 * Loads the timeline for a new `stamp`. Resumes after the cached end cursor when the cache is recent,
 * and falls back to a full reload when the item count doesn't add up (e.g. deletions).
 */
async function loadTimeline(kind: SubjectKind, owner: string, repo: string, number: number, stamp: string, maxPages: number): Promise<TimelineData> {
  const key = keys.timeline(owner, repo, number);
  const cached = queryClient.getQueryData<TimelineData>(key);
  const startedAt = Date.now();
  const onProgress = (items: TimelineItem[], endCursor: string | null) => {
    const current = queryClient.getQueryData<TimelineData>(key);
    if (current && current.items.length > items.length) return;
    // A refresh of a complete timeline keeps its stamp so no loading line flashes.
    queryClient.setQueryData<TimelineData>(key, { stamp: current?.stamp ?? "", items: [...items], endCursor, fullAt: current?.fullAt ?? startedAt });
  };
  if (cached?.endCursor && startedAt - cached.fullAt < FULL_RELOAD_MS) {
    const r = await fetchItems(kind, owner, repo, number, cached, maxPages, onProgress);
    if (!r.complete) return { stamp: "", items: r.items, endCursor: r.endCursor, fullAt: cached.fullAt };
    if (r.items.length === r.total) return { stamp, items: r.items, endCursor: r.endCursor, fullAt: cached.fullAt };
  }
  const r = await fetchItems(kind, owner, repo, number, null, maxPages, onProgress);
  return { stamp: r.complete ? stamp : "", items: r.items, endCursor: r.endCursor, fullAt: startedAt };
}

function metaKey(kind: SubjectKind, owner: string, repo: string, number: number) {
  return kind === "issue" ? keys.issue(owner, repo, number) : keys.pull(owner, repo, number);
}

function waitForIdle(query: Query): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((e) => {
      if (e.query === query && query.state.fetchStatus !== "fetching") done();
    });
    const timer = setTimeout(done, 15_000);
    if (query.state.fetchStatus !== "fetching") done();
  });
}

/**
 * The subject's `updatedAt`. Reuses the page's own metadata request when it is in flight or just
 * finished, so an unchanged thread costs no extra request; otherwise runs a 1-point probe.
 */
async function subjectStamp(kind: SubjectKind, owner: string, repo: string, number: number): Promise<string> {
  // Let refetches triggered in the same tick (focus, invalidation) start first.
  await new Promise((r) => setTimeout(r, 0));
  const query = queryClient.getQueryCache().find({ queryKey: metaKey(kind, owner, repo, number), exact: true });
  if (query) {
    await waitForIdle(query);
    const { data, dataUpdatedAt } = query.state as { data?: { updatedAt?: string }; dataUpdatedAt: number };
    if (data?.updatedAt && dataUpdatedAt > Date.now() - META_FRESH_MS) return data.updatedAt;
  }
  const d = await gql<{ repository: { issueOrPullRequest: { updatedAt: string } | null } }>(SUBJECT_STAMP_QUERY, { owner, repo, number });
  return d.repository.issueOrPullRequest?.updatedAt ?? "";
}

function timelineQueryFn(kind: SubjectKind, owner: string, repo: string, number: number, maxPages = Infinity) {
  return probeThenLoad(
    keys.timeline(owner, repo, number),
    () => subjectStamp(kind, owner, repo, number),
    (stamp) => loadTimeline(kind, owner, repo, number, stamp, maxPages),
  );
}

export function useTimeline(kind: SubjectKind, owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.timeline(owner, repo, number),
    queryFn: () => timelineQueryFn(kind, owner, repo, number),
  });
}

/** Warms the first page of a timeline; opening the page resumes from there. */
export function prefetchTimeline(kind: SubjectKind, owner: string, repo: string, number: number) {
  return queryClient.prefetchQuery({
    queryKey: keys.timeline(owner, repo, number),
    queryFn: () => timelineQueryFn(kind, owner, repo, number, 1),
    staleTime: 60_000,
  });
}

/** Applies `fn` to the cached timeline, if any. */
export function updateTimeline(owner: string, repo: string, number: number, fn: (items: TimelineItem[]) => TimelineItem[]) {
  queryClient.setQueryData<TimelineData>(keys.timeline(owner, repo, number), (old) => old && { ...old, items: fn(old.items) });
}

export function patchTimelineItem<T extends TimelineItem>(owner: string, repo: string, number: number, id: string, patch: (item: T) => T) {
  updateTimeline(owner, repo, number, (items) => items.map((it) => (it.id === id ? patch(it as T) : it)));
}
