import { hashKey, useQuery, type Query } from "@tanstack/react-query";
import { GitHubError, gql, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { persistQueryData, probeThenLoad, queryClient } from "@/api/queryClient";
import type { SubjectKind } from "@/api/prefetch";
import * as q from "./queries";
import { countsTrusted, createMerger, FULL_RELOAD_MS, recheckDue, reloadDue, resumed, type TimelineCounts } from "./timelineMerge";
import type { TimelineData, TimelineItem } from "./types";
/** A subject meta query fetched this recently counts as a fresh probe. */
const META_FRESH_MS = 10_000;

/** Timeline items per request; the API maximum. */
const PAGE_SIZE = 100;
/** Concurrent page requests once the item count is known. */
const PARALLEL = 8;

/** Local edits per timeline key, so loads that started before an edit stop writing. */
const editGen = new Map<string, number>();

interface Page {
  nodes: TimelineItem[];
  pageInfo: PageInfo;
  /** Matching items after the `after` cursor. */
  filteredCount: number;
}

interface PageResult {
  page: Page;
  /** Matching items in the whole timeline, when requested. */
  counts?: TimelineCounts;
}

type Count = { filteredCount: number } | null;
type TimelineHolder = { timelineItems: Page; total?: Count; movable?: Count } | null;

interface Subject {
  kind: SubjectKind;
  owner: string;
  repo: string;
  number: number;
  signal?: AbortSignal;
}

/** False once GitHub refuses project events for lacking the read:project scope (classic tokens). */
let projectsReadable = true;

function isProjectScopeError(e: unknown): boolean {
  return e instanceof GitHubError && e.message.includes("read:project");
}

async function fetchPage(subject: Subject, after: string | null, skip: number, withTotal: boolean): Promise<PageResult> {
  try {
    return await fetchPageWith(subject, after, skip, withTotal, projectsReadable);
  } catch (e) {
    if (!projectsReadable || !isProjectScopeError(e)) throw e;
    projectsReadable = false;
    return fetchPageWith(subject, after, skip, withTotal, false);
  }
}

async function fetchPageWith(
  { kind, owner, repo, number, signal }: Subject,
  after: string | null,
  skip: number,
  withTotal: boolean,
  projects: boolean,
): Promise<PageResult> {
  signal?.throwIfAborted();
  const vars = { owner, repo, number, after, skip: skip || null, withTotal };
  let holder: TimelineHolder;
  if (kind === "issue") {
    const query = projects ? q.ISSUE_TIMELINE_QUERY : q.ISSUE_TIMELINE_QUERY_NO_PROJECTS;
    const types = projects ? q.ISSUE_ITEM_TYPES : q.ISSUE_ITEM_TYPES_NO_PROJECTS;
    const d = await gql<{ repository: { issue: TimelineHolder } }>(query, { ...vars, types }, { signal });
    holder = d.repository.issue;
  } else {
    const query = projects ? q.PULL_TIMELINE_QUERY : q.PULL_TIMELINE_QUERY_NO_PROJECTS;
    const types = projects ? q.PULL_ITEM_TYPES : q.PULL_ITEM_TYPES_NO_PROJECTS;
    const d = await gql<{ repository: { pullRequest: TimelineHolder } }>(query, { ...vars, types }, { signal });
    holder = d.repository.pullRequest;
  }
  if (!holder) throw new Error(`Failed to load the timeline: ${owner}/${repo}#${number} is not ${kind === "issue" ? "an issue" : "a pull request"}`);
  const counts = holder.total && holder.movable ? { total: holder.total.filteredCount, movable: holder.movable.filteredCount } : undefined;
  return { page: holder.timelineItems, counts };
}

interface FetchResult {
  items: TimelineItem[];
  /** Items whose ids weren't in `base`. */
  added: TimelineItem[];
  endCursor: string | null;
  complete: boolean;
  counts: TimelineCounts;
}

/**
 * Fetches every item after `base` (or from the start), merging by id. The first page reveals the
 * count, so the rest are fetched in parallel by offset from its cursor. Progress is reported in order.
 */
async function fetchItems(
  subject: Subject,
  base: TimelineData | null,
  maxPages: number,
  onProgress: (items: TimelineItem[], endCursor: string | null) => void,
): Promise<FetchResult> {
  const { items, added, add: merge } = createMerger(base?.items ?? []);
  const add = (page: Page) => merge(page.nodes);

  const first = await fetchPage(subject, base?.endCursor ?? null, 0, true);
  const trusted = !!base || countsTrusted(first.counts, first.page.filteredCount);
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
        results[i] = (await fetchPage(subject, from, i * PAGE_SIZE, false)).page;
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

  // Items added while loading, or a stale count: continue by cursor. Untrusted counts continue until an empty page.
  while ((last.pageInfo.hasNextPage || (!trusted && last.nodes.length > 0)) && pages < maxPages) {
    last = (await fetchPage(subject, endCursor, 0, false)).page;
    pages++;
    add(last);
    endCursor = last.pageInfo.endCursor ?? endCursor;
    onProgress(items, endCursor);
  }
  const counts = first.counts ?? { total: items.length, movable: 0 };
  return { items, added, endCursor, complete: !last.pageInfo.hasNextPage && (trusted || !last.nodes.length), counts };
}

/**
 * Loads the timeline for a new `stamp`, or for a `recheck` of an unchanged one. Resumes after the cached
 * end cursor when the cache is recent or rechecked, and falls back to a full reload when the item counts
 * don't add up (e.g. deletions).
 */
async function loadTimeline(subject: Subject, stamp: string, maxPages: number, recheck = false): Promise<TimelineData> {
  const key = keys.timeline(subject.owner, subject.repo, subject.number);
  const cached = queryClient.getQueryData<TimelineData>(key);
  const startedAt = Date.now();
  const gen = editGen.get(hashKey(key));
  const onProgress = (items: TimelineItem[], endCursor: string | null) => {
    // A local edit cancelled this load; its pages would overwrite the edit.
    if (editGen.get(hashKey(key)) !== gen) return;
    const current = queryClient.getQueryData<TimelineData>(key);
    if (current && current.items.length > items.length) return;
    // A refresh of a complete timeline keeps its stamp so no loading line flashes.
    queryClient.setQueryData<TimelineData>(key, {
      stamp: current?.stamp ?? "",
      items: [...items],
      endCursor,
      fullAt: current?.fullAt ?? startedAt,
      checkedAt: current?.checkedAt,
      edited: current?.edited,
    });
  };
  if (cached?.endCursor && (recheck || startedAt - cached.fullAt < FULL_RELOAD_MS)) {
    const next = resumed(cached, await fetchItems(subject, cached, maxPages, onProgress), stamp);
    if (next) return { ...next, checkedAt: startedAt };
    // Progress may have moved the cursor past the change, so a failed reload must not resume.
    queryClient.setQueryData<TimelineData>(key, (d) => d && { ...d, fullAt: 0 });
  }
  const r = await fetchItems(subject, null, maxPages, onProgress);
  return { stamp: r.complete ? stamp : "", items: r.items, endCursor: r.endCursor, fullAt: startedAt, checkedAt: startedAt };
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
async function subjectStamp({ kind, owner, repo, number, signal }: Subject): Promise<string> {
  // Let refetches triggered in the same tick (focus, invalidation) start first.
  await new Promise((r) => setTimeout(r, 0));
  const query = queryClient.getQueryCache().find({ queryKey: metaKey(kind, owner, repo, number), exact: true });
  if (query) {
    await waitForIdle(query);
    const { data, dataUpdatedAt } = query.state as { data?: { updatedAt?: string }; dataUpdatedAt: number };
    if (data?.updatedAt && dataUpdatedAt > Date.now() - META_FRESH_MS) return data.updatedAt;
  }
  const d = await gql<{ repository: { issueOrPullRequest: { updatedAt: string } | null } }>(q.SUBJECT_STAMP_QUERY, { owner, repo, number }, { signal });
  return d.repository.issueOrPullRequest?.updatedAt ?? "";
}

function timelineQueryFn(subject: Subject, maxPages = Infinity) {
  const key = keys.timeline(subject.owner, subject.repo, subject.number);
  const probe = () => subjectStamp(subject);
  const load = (stamp: string) => loadTimeline(subject, stamp, maxPages);
  const cached = queryClient.getQueryData<TimelineData>(key);
  if (reloadDue(cached, Date.now())) return probe().then(load);
  if (recheckDue(cached, Date.now())) return probe().then((stamp) => loadTimeline(subject, stamp, maxPages, stamp === cached!.stamp));
  return probeThenLoad(key, probe, (stamp) => stamp.then(load));
}

export function useTimeline(kind: SubjectKind, owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.timeline(owner, repo, number),
    queryFn: ({ signal }) => timelineQueryFn({ kind, owner, repo, number, signal }),
  });
}

/** Warms the first page of a timeline; opening the page resumes from there. */
export function prefetchTimeline(kind: SubjectKind, owner: string, repo: string, number: number) {
  return queryClient.prefetchQuery({
    queryKey: keys.timeline(owner, repo, number),
    queryFn: ({ signal }) => timelineQueryFn({ kind, owner, repo, number, signal }, 1),
    staleTime: 60_000,
  });
}

/** Applies `fn` to the cached timeline, if any, cancelling an in-flight load that would overwrite it. */
export function updateTimeline(owner: string, repo: string, number: number, fn: (items: TimelineItem[]) => TimelineItem[]) {
  const key = keys.timeline(owner, repo, number);
  if (!queryClient.getQueryData(key)) return;
  editGen.set(hashKey(key), (editGen.get(hashKey(key)) ?? 0) + 1);
  void queryClient.cancelQueries({ queryKey: key, exact: true });
  queryClient.setQueryData<TimelineData>(key, (old) => old && { ...old, items: fn(old.items) });
  // The probe skips reloads while the stamp is unchanged, so the stored copy must include local edits.
  persistQueryData(key);
}

export function patchTimelineItem<T extends TimelineItem>(owner: string, repo: string, number: number, id: string, patch: (item: T) => T) {
  updateTimeline(owner, repo, number, (items) => items.map((it) => (it.id === id ? patch(it as T) : it)));
}
