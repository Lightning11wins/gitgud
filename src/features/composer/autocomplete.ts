import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { gql } from "@/api/client";

export interface MentionCandidate {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface RefCandidate {
  __typename: "Issue" | "PullRequest";
  number: number;
  title: string;
  state: string;
  stateReason?: "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED" | null;
  isDraft?: boolean;
}

const HOUR = 60 * 60_000;
const LIMIT = 8;

const USER_FIELDS = `login name avatarUrl(size: 40)`;
const REF_FIELDS = `
  __typename
  ... on Issue { number title state stateReason }
  ... on PullRequest { number title state isDraft }`;

async function fetchMentionable(owner: string, repo: string, query: string): Promise<MentionCandidate[]> {
  const d = await gql<{ repository: { mentionableUsers: { nodes: MentionCandidate[] } } }>(
    `query MentionableUsers($owner: String!, $repo: String!, $q: String, $n: Int!) {
      repository(owner: $owner, name: $repo) { mentionableUsers(first: $n, query: $q) { nodes { ${USER_FIELDS} } } }
    }`,
    { owner, repo, q: query || null, n: query ? LIMIT : 100 },
  );
  return d.repository.mentionableUsers.nodes;
}

async function searchRefs(owner: string, repo: string, query: string): Promise<RefCandidate[]> {
  const d = await gql<{ search: { nodes: RefCandidate[] } }>(
    `query RefCandidates($q: String!, $n: Int!) { search(query: $q, type: ISSUE, first: $n) { nodes { ${REF_FIELDS} } } }`,
    { q: `repo:${owner}/${repo} ${query || "sort:updated-desc"}`, n: query ? LIMIT * 2 : 50 },
  );
  return d.search.nodes.filter((n) => n && "number" in n);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function rank<T>(items: T[], query: string, fields: (t: T) => string[]): T[] {
  const q = query.toLowerCase();
  if (!q) return items.slice(0, LIMIT);
  const scored = items
    .map((t) => {
      const fs = fields(t).map((f) => f.toLowerCase());
      const score = fs.some((f) => f.startsWith(q)) ? 0 : fs.some((f) => f.includes(q)) ? 1 : 2;
      return { t, score };
    })
    .filter((x) => x.score < 2)
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, LIMIT).map((x) => x.t);
}

function mergeBy<T>(a: T[], b: T[], key: (t: T) => string | number): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((t) => !seen.has(key(t)))];
}

/** @mention suggestions: the repo's first 100 mentionable users (cached), then a server search as the query grows. */
export function useMentionSuggestions(owner: string, repo: string, query: string | null): MentionCandidate[] | undefined {
  const active = query !== null;
  const base = useQuery({
    queryKey: ["mentionable", owner, repo],
    queryFn: () => fetchMentionable(owner, repo, ""),
    enabled: active,
    staleTime: HOUR,
  });
  const local = base.data ? rank(base.data, query ?? "", (u) => [u.login, u.name ?? ""]) : undefined;
  const q = useDebounced(query ?? "", 200);
  const remote = useQuery({
    queryKey: ["mentionable", owner, repo, q],
    queryFn: () => fetchMentionable(owner, repo, q),
    enabled: active && !!q && !!base.data && base.data.length >= 100 && (local?.length ?? 0) < LIMIT,
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
  if (!local) return undefined;
  return remote.data && q === query ? mergeBy(local, remote.data, (u) => u.login).slice(0, LIMIT) : local;
}

/** #ref suggestions: recently updated issues and PRs (cached), then a search as the user types. */
export function useRefSuggestions(owner: string, repo: string, query: string | null): RefCandidate[] | undefined {
  const active = query !== null;
  const base = useQuery({
    queryKey: ["ref-candidates", owner, repo],
    queryFn: () => searchRefs(owner, repo, ""),
    enabled: active,
    staleTime: 5 * 60_000,
  });
  const local = base.data ? rank(base.data, query ?? "", (r) => [String(r.number), r.title]) : undefined;
  const q = useDebounced(query ?? "", 250);
  const remote = useQuery({
    queryKey: ["ref-candidates", owner, repo, q],
    queryFn: () => searchRefs(owner, repo, q),
    enabled: active && !!q && (local?.length ?? 0) < LIMIT,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  if (!local) return undefined;
  const merged = remote.data && q === query ? mergeBy(local, remote.data, (r) => r.number) : local;
  return merged.slice(0, LIMIT);
}
