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
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
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

const LIST_QUERY = `
query SearchList($q: String!, $first: Int!, $after: String) {
  search(type: ISSUE_ADVANCED, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue { ${COMMON} stateReason }
      ... on PullRequest {
        ${COMMON} isDraft reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

const FIRST_PAGE = 50;
const NEXT_PAGE = 100;

async function fetchPage(search: string, after: string | null): Promise<ListData> {
  const data = await gql<{
    search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (ListItem | null)[] };
  }>(LIST_QUERY, { q: search, first: after ? NEXT_PAGE : FIRST_PAGE, after });
  const { search: s } = data;
  return {
    items: s.nodes.filter((n): n is ListItem => !!n && !!n.id),
    total: s.issueCount,
    hasNextPage: s.pageInfo.hasNextPage,
    endCursor: s.pageInfo.endCursor,
  };
}

function appendUnique(base: ListItem[], more: ListItem[]): ListItem[] {
  const seen = new Set(base.map((i) => i.id));
  return [...base, ...more.filter((i) => !seen.has(i.id))];
}

/**
 * Pages of a GitHub search as one cached list. Revalidation refetches only the first page and
 * keeps any later pages already loaded; `loadMore` appends the next page.
 */
export function useSearchList(queryKey: QueryKey, search: string) {
  const qc = useQueryClient();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const inFlight = useRef(false);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ListData> => {
      const fresh = await fetchPage(search, null);
      const prev = qc.getQueryData<ListData>(queryKey);
      if (!prev || prev.items.length <= fresh.items.length || !fresh.hasNextPage) return fresh;
      const tail = prev.items.slice(fresh.items.length);
      return { ...fresh, items: appendUnique(fresh.items, tail), endCursor: prev.endCursor, hasNextPage: prev.hasNextPage };
    },
    placeholderData: undefined,
  });

  useEffect(() => setMoreError(null), [search]);

  const loadMore = useCallback(async () => {
    const data = qc.getQueryData<ListData>(keyRef.current);
    if (!data || !data.hasNextPage || inFlight.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(search, data.endCursor);
      qc.setQueryData<ListData>(keyRef.current, (cur) =>
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
