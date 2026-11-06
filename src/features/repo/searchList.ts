import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { GitHubError, gql, gqlPartial } from "@/api/client";
import { keys } from "@/api/keys";
import { persistedData, queryClient } from "@/api/queryClient";
import { warmRows } from "./warmRows";

export interface ListItem {
  __typename: "Issue" | "PullRequest";
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateReason?: "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED" | null;
  isDraft?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string } | null;
  repository: { nameWithOwner: string };
  labels: { nodes: { name: string; color: string; description?: string | null }[] };
  assignees: { nodes: { login: string; avatarUrl: string }[] };
  comments: { totalCount: number };
  /** Pull requests only: comments including review comments. */
  totalCommentsCount?: number;
  /** Issues only: pull requests that close the issue, open or not. */
  linkedPrs?: { totalCount: number; nodes: { state: string; isDraft: boolean }[] };
}

/** Head commit checks: the rollup state and how many of `total` passed. */
export interface CheckSummary {
  state: string;
  passed: number;
  total: number;
}

/** A check run or a commit status, as `CHECKS_QUERY` selects them. */
type RawContext = { name: string; conclusion: string | null; databaseId: number } | { context: string; state: string; createdAt: string };

type RawRollup = { state: string; contexts: { nodes: (RawContext | null)[] } } | null;

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Counts each check name once, by its newest run, as github.com does for re-runs and duplicate workflow runs. */
export function summarizeChecks(rollup: RawRollup | undefined): CheckSummary | null {
  if (!rollup) return null;
  // Check run ids and status times both grow with each new run.
  const newest = new Map<string, { order: number | string; result: string | null }>();
  for (const c of rollup.contexts.nodes) {
    if (!c) continue;
    const run = "context" in c ? { key: `status:${c.context}`, order: c.createdAt, result: c.state } : { key: `run:${c.name}`, order: c.databaseId, result: c.conclusion };
    const seen = newest.get(run.key);
    if (!seen || run.order > seen.order) newest.set(run.key, run);
  }
  let passed = 0;
  for (const { result } of newest.values()) if (result && PASSED.has(result)) passed++;
  return { state: rollup.state, passed, total: newest.size };
}

interface Page<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ListData extends Page<ListItem> {
  total: number;
}

/** Check summaries of a list's pull requests, keyed by node id. `null` means the PR has no checks. */
export type ListChecks = Record<string, CheckSummary | null>;

const COMMON = `
  id number title url state createdAt updatedAt
  author { login avatarUrl(size: 40) }
  repository { nameWithOwner }
  labels(first: 10) { nodes { name color description } }
  assignees(first: 5) { nodes { login avatarUrl(size: 40) } }
  comments { totalCount }
`;

export const LIST_QUERY = `
query SearchList($q: String!, $first: Int!, $after: String) {
  search(type: ISSUE_ADVANCED, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue {
        ${COMMON} stateReason
        linkedPrs: closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { totalCount nodes { state isDraft } }
      }
      ... on PullRequest {
        ${COMMON} isDraft reviewDecision totalCommentsCount
      }
    }
  }
}`;

/** The same search as `LIST_QUERY`, selecting only check runs. It runs alongside it with the same cursor. */
export const CHECKS_QUERY = `
query SearchChecks($q: String!, $first: Int!, $after: String) {
  search(type: ISSUE_ADVANCED, query: $q, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue { id }
      ... on PullRequest {
        id
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes { ... on CheckRun { name conclusion databaseId } ... on StatusContext { context state createdAt } }
          }
        }
      }
    }
  }
}`;

const FIRST_PAGE = 50;
const NEXT_PAGE = 100;
const ISSUE_TOKEN = /(^|\s)(is|type):issue(?=\s|$)/i;
const PR_TOKEN = /(is|type):(pr|pull-request)\b/i;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function fetchPage(search: string, after: string | null): Promise<ListData> {
  const data = await gql<{ search: { issueCount: number; pageInfo: PageInfo; nodes: (ListItem | null)[] } }>(LIST_QUERY, {
    q: search,
    first: after ? NEXT_PAGE : FIRST_PAGE,
    after,
  });
  const { search: s } = data;
  return {
    items: s.nodes.filter((n): n is ListItem => !!n && !!n.id),
    total: s.issueCount,
    hasNextPage: s.pageInfo.hasNextPage,
    endCursor: s.pageInfo.endCursor,
  };
}

/** A search result's checks: undefined for issues and for PRs whose check runs the token can't read. */
type ChecksItem = { id: string; checks?: CheckSummary | null };

async function fetchChecksPage(search: string, after: string | null): Promise<Page<ChecksItem>> {
  const { data, errors } = await gqlPartial<{ search: { pageInfo: PageInfo; nodes: ({ id?: string; statusCheckRollup?: RawRollup } | null)[] } }>(
    CHECKS_QUERY,
    { q: search, first: after ? NEXT_PAGE : FIRST_PAGE, after },
  );
  // Fine-grained tokens can't read check runs in repos outside their grant.
  const hidden = new Set<unknown>();
  for (const e of errors) {
    if (e.path?.[0] !== "search" || e.path[1] !== "nodes") throw new GitHubError(`Failed to run GraphQL SearchChecks: ${e.message}`, 200, errors);
    hidden.add(e.path[2]);
  }
  const { search: s } = data;
  return {
    items: s.nodes.flatMap((n, i) =>
      n?.id ? [{ id: n.id, checks: hidden.has(i) || n.statusCheckRollup === undefined ? undefined : summarizeChecks(n.statusCheckRollup) }] : [],
    ),
    hasNextPage: s.pageInfo.hasNextPage,
    endCursor: s.pageInfo.endCursor,
  };
}

function toChecks(items: ChecksItem[]): ListChecks {
  return Object.fromEntries(items.flatMap((i) => (i.checks === undefined ? [] : [[i.id, i.checks]])));
}

function appendUnique<T extends { id: string }>(base: T[], more: T[]): T[] {
  const seen = new Set(base.map((i) => i.id));
  return [...base, ...more.filter((i) => !seen.has(i.id))];
}

/** Fetches pages until at least `count` items (or every result) are loaded. */
export async function fetchAtLeast<P extends Page<{ id: string }>>(fetch: (after: string | null) => Promise<P>, count: number): Promise<P> {
  let data = await fetch(null);
  while (data.hasNextPage && data.items.length < count) {
    const page = await fetch(data.endCursor);
    data = { ...page, items: appendUnique(data.items, page.items) };
  }
  return data;
}

/** Whether a search can include pull requests, so `CHECKS_QUERY` runs alongside it. */
function hasPulls(search: string): boolean {
  return !ISSUE_TOKEN.test(search) || PR_TOKEN.test(search);
}

/** Refetches as many items as the list at `queryKey` holds. */
function listQueryFn(queryKey: QueryKey, search: string) {
  return () => fetchAtLeast((after) => fetchPage(search, after), queryClient.getQueryData<ListData>(queryKey)?.items.length ?? 0);
}

function checksQueryFn(queryKey: QueryKey, search: string) {
  return async () => {
    const checksKey = keys.listChecks(queryKey);
    const list = queryClient.getQueryData<ListData>(queryKey) ?? (await persistedData<ListData>(queryKey));
    const pages = await fetchAtLeast((after) => fetchChecksPage(search, after), list?.items.length ?? 0);
    const fetched = toChecks(pages.items);
    // Keep summaries that `loadMore` added meanwhile for rows still listed.
    const listed = new Set(queryClient.getQueryData<ListData>(queryKey)?.items.map((i) => i.id));
    for (const [id, c] of Object.entries(queryClient.getQueryData<ListChecks>(checksKey) ?? {})) {
      if (!(id in fetched) && listed.has(id)) fetched[id] = c;
    }
    return fetched;
  };
}

/** Warms a search list and its check summaries, as `useSearchList` loads them. */
export function prefetchSearchList(queryKey: QueryKey, search: string) {
  return Promise.all([
    queryClient.prefetchQuery({ queryKey, queryFn: listQueryFn(queryKey, search), staleTime: 60_000 }),
    hasPulls(search) && queryClient.prefetchQuery({ queryKey: keys.listChecks(queryKey), queryFn: checksQueryFn(queryKey, search), staleTime: 60_000 }),
  ]);
}

/**
 * The issues or pull requests in a mixed list. With the same filters and sort, they are the top of
 * the kind-specific list, so they can stand in while it loads.
 */
export function kindSubset(data: ListData | undefined, kind: "issue" | "pr"): ListData | undefined {
  if (!data) return undefined;
  const typename = kind === "issue" ? "Issue" : "PullRequest";
  const items = data.items.filter((i) => i.__typename === typename);
  if (!items.length && data.hasNextPage) return undefined;
  return { items, total: items.length, hasNextPage: data.hasNextPage, endCursor: null };
}

/** List order as ascending numbers, for the sorts rows carry enough to reproduce: created and updated. */
export function sortKey(sort: string | null): ((i: ListItem) => number) | undefined {
  const m = /^(created|updated)(?:-(asc|desc))?$/.exec(sort ?? "");
  if (!m) return undefined;
  const field = m[1] === "created" ? "createdAt" : "updatedAt";
  const sign = m[2] === "asc" ? 1 : -1;
  return (i) => sign * Date.parse(i[field]);
}

/**
 * A mixed list built from its issue and PR lists, through the last row both cover. With the same
 * filters and sort, that is the top of the mixed list.
 */
export function mergeKinds(issues: ListData, pulls: ListData, key: (i: ListItem) => number): ListData | undefined {
  const ends = [issues, pulls].filter((d) => d.hasNextPage).map((d) => (d.items.length ? key(d.items[d.items.length - 1]) : -Infinity));
  const bound = Math.min(Infinity, ...ends);
  const items = [...issues.items, ...pulls.items].filter((i) => key(i) <= bound).sort((a, b) => key(a) - key(b));
  const hasNextPage = issues.hasNextPage || pulls.hasNextPage;
  if (!items.length && hasNextPage) return undefined;
  return { items, total: issues.total + pulls.total, hasNextPage, endCursor: null };
}

/**
 * A cached list with a fresher stand-in over its top: the stand-in's rows, then the cached rows past
 * them. Without a known sort, the cached list.
 */
export function overlay(fresh: ListData, cached: ListData, key: ((i: ListItem) => number) | undefined): ListData {
  if (!fresh.hasNextPage) return fresh;
  if (!key || !fresh.items.length) return cached;
  const bound = key(fresh.items[fresh.items.length - 1]);
  const ids = new Set(fresh.items.map((i) => i.id));
  return { ...cached, items: [...fresh.items, ...cached.items.filter((i) => !ids.has(i.id) && key(i) > bound)] };
}

/** Lists whose rows can show while a list loads: the mixed list for a kind list, or both kind lists for a mixed one. */
export type StandIn = { kind: "issue" | "pr"; all: QueryKey } | { issues: QueryKey; pulls: QueryKey };

function resolveStandIn(qc: QueryClient, s: StandIn, key: ((i: ListItem) => number) | undefined) {
  if ("all" in s) {
    const all = qc.getQueryState<ListData>(s.all);
    const data = kindSubset(all?.data, s.kind);
    return data && { data, updatedAt: all!.dataUpdatedAt, checks: qc.getQueryData<ListChecks>(keys.listChecks(s.all)) };
  }
  const issues = qc.getQueryState<ListData>(s.issues);
  const pulls = qc.getQueryState<ListData>(s.pulls);
  if (!key || !issues?.data || !pulls?.data) return undefined;
  const data = mergeKinds(issues.data, pulls.data, key);
  const checks = { ...qc.getQueryData<ListChecks>(keys.listChecks(s.issues)), ...qc.getQueryData<ListChecks>(keys.listChecks(s.pulls)) };
  return data && { data, updatedAt: Math.min(issues.dataUpdatedAt, pulls.dataUpdatedAt), checks };
}

/**
 * Pages of a GitHub search as one cached list. Revalidation refetches as many items as were
 * loaded, so stale rows (e.g. closed issues in an is:open list) drop out; `loadMore` appends the next page.
 * `checks` holds the pull requests' check summaries, fetched in parallel by `CHECKS_QUERY`.
 * `standIn` names lists whose rows show until the first fetch lands, and over older cached rows while it runs.
 */
export function useSearchList(queryKey: QueryKey, search: string, standIn?: StandIn) {
  const qc = useQueryClient();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const withChecks = hasPulls(search);
  const order = sortKey(getSort(search));
  const borrow = () => (standIn ? resolveStandIn(qc, standIn, order) : undefined);

  const query = useQuery({
    queryKey,
    queryFn: listQueryFn(queryKey, search),
    placeholderData: standIn && (() => borrow()?.data),
  });

  const checksKey = keys.listChecks(queryKey);
  const checks = useQuery({
    queryKey: checksKey,
    queryFn: checksQueryFn(queryKey, search),
    enabled: withChecks,
    placeholderData: standIn && (() => borrow()?.checks),
  });

  useEffect(() => setMoreError(null), [search]);

  const loadMore = useCallback(async () => {
    const key = keyRef.current;
    const data = qc.getQueryData<ListData>(key);
    if (!data || !data.hasNextPage || inFlight.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    if (withChecks) {
      fetchChecksPage(search, data.endCursor).then(
        (page) => qc.setQueryData<ListChecks>(keys.listChecks(key), (cur) => ({ ...cur, ...toChecks(page.items) })),
        () => {},
      );
    }
    try {
      const page = await fetchPage(search, data.endCursor);
      qc.setQueryData<ListData>(key, (cur) =>
        cur ? { ...page, items: appendUnique(cur.items, page.items) } : cur,
      );
      setMoreError(null);
    } catch (e) {
      setMoreError(e);
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, [qc, search, withChecks]);

  const fetchedAt = query.isFetchedAfterMount && !query.isFetching && !query.isPlaceholderData ? query.dataUpdatedAt : 0;
  useEffect(() => {
    const items = qc.getQueryData<ListData>(keyRef.current)?.items;
    if (fetchedAt && items) warmRows(items);
  }, [qc, fetchedAt]);

  let data = query.data;
  if (data && query.isFetching && !query.isPlaceholderData) {
    const fresher = borrow();
    if (fresher && fresher.updatedAt > query.dataUpdatedAt) data = overlay(fresher.data, data, order);
  }

  return { ...query, data, checks: checks.data, loadMore, loadingMore, moreError };
}

const KIND_TOKEN = /(^|\s)(is:(issue|pr|pull-request)|type:(issue|pr))(?=\s|$)/i;

export interface SearchScope {
  repo?: string;
  kind?: "issue" | "pr";
  defaultSort: string;
}

/** The search string sent to GitHub: scope, issue/PR kind and default sort added to the user's text. */
export function buildSearch(q: string, { repo, kind, defaultSort }: SearchScope): string {
  const parts = [repo ? `repo:${repo}` : "", q.trim()];
  if (kind) parts.push(`is:${kind}`);
  else if (!KIND_TOKEN.test(q)) parts.push("(is:issue OR is:pr)");
  if (!/(^|\s)sort:/i.test(q)) parts.push(`sort:${defaultSort}`);
  return parts.filter(Boolean).join(" ");
}

/** Removes every whitespace-delimited token of `q` matching the regex source `pattern`. */
export function stripToken(q: string, pattern: string): string {
  return q.replace(new RegExp(`(^|\\s)(?:${pattern})(?=\\s|$)`, "gi"), " ").replace(/\s+/g, " ").trim();
}

export type StateFilter = "open" | "closed";
/** `is:open` or GitHub's `state:open`, and the same for closed; `is:merged` narrows closed. */
const STATE_TOKEN = "(?:is|state):(?:open|closed)|is:merged";
const SORT_TOKEN = "sort:\\S+";

export function getState(q: string): StateFilter | null {
  const m = /(?:^|\s)(?:is|state):(open|closed)(?=\s|$)/i.exec(q);
  return m ? (m[1].toLowerCase() as StateFilter) : null;
}

export function setState(q: string, state: StateFilter): string {
  return `is:${state} ${stripToken(q, STATE_TOKEN)}`.trim();
}

export function getSort(q: string): string | null {
  return /(?:^|\s)sort:(\S+)/i.exec(q)?.[1]?.toLowerCase() ?? null;
}

export function setSort(q: string, sort: string | null): string {
  return `${stripToken(q, SORT_TOKEN)} ${sort ? `sort:${sort}` : ""}`.trim();
}

/** `q` without state, kind and sort tokens, for counting across states and kinds. */
export function baseQuery(q: string): string {
  return stripToken(q, `${STATE_TOKEN}|is:(?:issue|pr|pull-request)|type:(?:issue|pr)|${SORT_TOKEN}`);
}

/** A qualifier's value: a quoted string or one word. `type:issue` and `type:pr` select a kind, not an issue type. */
function valuePattern(name: string): string {
  return `${name === "type" ? "(?!(?:issue|pr)(?:\\s|$))" : ""}(?:"[^"]*"|\\S+)`;
}

/** Values of the `name:` qualifiers in `q`, unquoted. Negated qualifiers (`-name:`) are skipped. */
export function getQualifier(q: string, name: string): string[] {
  const re = new RegExp(`(?:^|\\s)${name}:(${valuePattern(name)})(?=\\s|$)`, "gi");
  return [...q.matchAll(re)].map((m) => m[1].replace(/^"(.*)"$/, "$1"));
}

/** `q` with its `name:` qualifiers replaced by one per value. */
export function setQualifier(q: string, name: string, values: string[]): string {
  const rest = stripToken(q, `${name}:${valuePattern(name)}`);
  const added = values.map((v) => `${name}:${/[\s,"]/.test(v) ? `"${v}"` : v}`);
  return [rest, ...added].filter(Boolean).join(" ");
}
