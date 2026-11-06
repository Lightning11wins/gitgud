import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { gql } from "@/api/client";

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
  checks?: CheckSummary | null;
}

/** Head commit checks: the rollup state and how many of `total` passed. */
export interface CheckSummary {
  state: string;
  passed: number;
  total: number;
}

/** A check run or a commit status, as the list query selects them. */
type RawContext = { name: string; conclusion: string | null; databaseId: number } | { context: string; state: string; createdAt: string };

type RawItem = ListItem & {
  statusCheckRollup?: { state: string; contexts: { nodes: (RawContext | null)[] } } | null;
};

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Counts each check name once, by its newest run, as github.com does for re-runs and duplicate workflow runs. */
export function summarizeChecks(rollup: RawItem["statusCheckRollup"]): CheckSummary | null {
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

function toItem({ statusCheckRollup, ...item }: RawItem): ListItem {
  return statusCheckRollup === undefined ? item : { ...item, checks: summarizeChecks(statusCheckRollup) };
}

export interface ListData {
  items: ListItem[];
  total: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

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
      ... on Issue { ${COMMON} stateReason }
      ... on PullRequest {
        ${COMMON} isDraft reviewDecision totalCommentsCount
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

async function fetchPage(search: string, after: string | null): Promise<ListData> {
  const data = await gql<{
    search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RawItem | null)[] };
  }>(LIST_QUERY, { q: search, first: after ? NEXT_PAGE : FIRST_PAGE, after });
  const { search: s } = data;
  return {
    items: s.nodes.filter((n): n is RawItem => !!n && !!n.id).map(toItem),
    total: s.issueCount,
    hasNextPage: s.pageInfo.hasNextPage,
    endCursor: s.pageInfo.endCursor,
  };
}

function appendUnique(base: ListItem[], more: ListItem[]): ListItem[] {
  const seen = new Set(base.map((i) => i.id));
  return [...base, ...more.filter((i) => !seen.has(i.id))];
}

/** Fetches pages until at least `count` items (or every result) are loaded. */
export async function fetchAtLeast(fetch: (after: string | null) => Promise<ListData>, count: number): Promise<ListData> {
  let data = await fetch(null);
  while (data.hasNextPage && data.items.length < count) {
    const page = await fetch(data.endCursor);
    data = { ...page, items: appendUnique(data.items, page.items) };
  }
  return data;
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

/**
 * Pages of a GitHub search as one cached list. Revalidation refetches as many items as were
 * loaded, so stale rows (e.g. closed issues in an is:open list) drop out; `loadMore` appends the next page.
 * `placeholder` supplies data to show until the first fetch lands.
 */
export function useSearchList(queryKey: QueryKey, search: string, placeholder?: () => ListData | undefined) {
  const qc = useQueryClient();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const inFlight = useRef(false);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAtLeast((after) => fetchPage(search, after), qc.getQueryData<ListData>(queryKey)?.items.length ?? 0),
    placeholderData: placeholder,
  });

  useEffect(() => setMoreError(null), [search]);

  const loadMore = useCallback(async () => {
    const key = keyRef.current;
    const data = qc.getQueryData<ListData>(key);
    if (!data || !data.hasNextPage || inFlight.current) return;
    inFlight.current = true;
    setLoadingMore(true);
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
  }, [qc, search]);

  return { ...query, loadMore, loadingMore, moreError };
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
const STATE_TOKEN = "is:(?:open|closed)";
const SORT_TOKEN = "sort:\\S+";

export function getState(q: string): StateFilter | null {
  const m = /(?:^|\s)is:(open|closed)(?=\s|$)/i.exec(q);
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
