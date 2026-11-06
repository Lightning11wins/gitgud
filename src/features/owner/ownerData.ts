import { useQuery } from "@tanstack/react-query";
import { GitHubError, gql, gqlAll, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { persistedData, queryClient } from "@/api/queryClient";

export interface OwnerRepo {
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL";
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
  primaryLanguage: { name: string; color: string | null } | null;
}

export interface OwnerInfo {
  __typename: "User" | "Organization";
  login: string;
  name: string | null;
  avatarUrl: string;
  description?: string | null;
  bio?: string | null;
}

export interface OwnerData {
  owner: OwnerInfo;
  repos: OwnerRepo[];
  total: number;
  complete: boolean;
  /** When the last full (non-incremental) load started. */
  fullAt: number;
}

/** A full reload catches renames, deletions, and description edits that don't change `pushedAt`. */
const FULL_RELOAD_MS = 24 * 60 * 60 * 1000;

const OWNER_QUERY = `
query OwnerRepos($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    __typename login avatarUrl(size: 96)
    ... on User { name bio }
    ... on Organization { name description }
    repositories(first: 100, after: $after, ownerAffiliations: [OWNER], orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { name description visibility isArchived isFork pushedAt primaryLanguage { name color } }
    }
  }
}`;

type OwnerResponse = {
  repositoryOwner: (OwnerInfo & { repositories: { totalCount: number; pageInfo: PageInfo; nodes: OwnerRepo[] } }) | null;
};

/**
 * Every repository of a user or organization, most recently pushed first. A refresh fetches pages
 * until it reaches repos older than the cached newest one, so an unchanged owner costs one request.
 */
async function loadOwner(login: string): Promise<OwnerData> {
  const key = keys.owner(login);
  const cached = queryClient.getQueryData<OwnerData>(key) ?? (await persistedData<OwnerData>(key));
  const startedAt = Date.now();
  let owner: OwnerInfo | undefined;
  let total = 0;
  const fetchPage = async (after: string | null, stopAt?: string) => {
    const o = (await gql<OwnerResponse>(OWNER_QUERY, { login, after })).repositoryOwner;
    if (!o) throw new GitHubError(`Failed to load "${login}": no user or organization has that login`, 404);
    const { repositories: r, ...info } = o;
    owner = info;
    total = r.totalCount;
    const last = r.nodes.at(-1)?.pushedAt ?? "";
    const reached = stopAt !== undefined && last <= stopAt;
    return { nodes: r.nodes, pageInfo: { ...r.pageInfo, hasNextPage: r.pageInfo.hasNextPage && !reached } };
  };

  if (cached?.complete && startedAt - cached.fullAt < FULL_RELOAD_MS) {
    const newest = cached.repos[0]?.pushedAt ?? "";
    const fresh = await gqlAll((after) => fetchPage(after, newest));
    const names = new Set(fresh.map((r) => r.name));
    const repos = [...fresh, ...cached.repos.filter((r) => !names.has(r.name))];
    if (repos.length === total) return { owner: owner!, repos, total, complete: true, fullAt: cached.fullAt };
  }

  const repos = await gqlAll(
    (after) => fetchPage(after),
    (nodes) => {
      const current = queryClient.getQueryData<OwnerData>(key);
      if (current?.complete) return;
      queryClient.setQueryData<OwnerData>(key, { owner: owner!, repos: [...nodes], total, complete: false, fullAt: startedAt });
    },
  );
  return { owner: owner!, repos, total, complete: true, fullAt: startedAt };
}

export function useOwner(login: string) {
  return useQuery({ queryKey: keys.owner(login), queryFn: () => loadOwner(login) });
}
