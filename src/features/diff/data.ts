import { useMutation, useQuery } from "@tanstack/react-query";
import { gql, gqlAll, mapLimit, rest, restAll, restRaw, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { probeThenLoad, queryClient } from "@/api/queryClient";
import { trimFile, type DiffFile } from "./model";

/** Where a diff comes from: refs for fetching file contents on demand. */
export interface DiffSource {
  owner: string;
  repo: string;
  /** Unique per diff version; part of cache keys. */
  id: string;
  /** Ref of the new side. */
  head: string;
  /** Resolves the ref of the old side (the merge base for PRs). */
  base: () => Promise<string>;
}

export interface PullFiles {
  stamp: string;
  pullId: string;
  head: string;
  baseRefOid: string;
  files: DiffFile[];
}

const HEAD_QUERY = `
  query PullDiffHead($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id headRefOid baseRefOid } }
  }`;

type HeadData = { repository: { pullRequest: { id: string; headRefOid: string; baseRefOid: string } } };

/** Every file of a PR. A 1-point probe of the head SHA reuses the cached diff until the head moves. */
export function usePullFiles(owner: string, repo: string, number: number) {
  const key = keys.pullFiles(owner, repo, number);
  return useQuery({
    queryKey: key,
    queryFn: () => {
      let head: HeadData["repository"]["pullRequest"] | undefined;
      return probeThenLoad<PullFiles>(
        key,
        async () => {
          head = (await gql<HeadData>(HEAD_QUERY, { owner, repo, number })).repository.pullRequest;
          return head.headRefOid;
        },
        async (stamp) => {
          const files = await restAll<DiffFile>(`/repos/${owner}/${repo}/pulls/${number}/files`, { maxPages: 30 });
          return { stamp, pullId: head!.id, head: stamp, baseRefOid: head!.baseRefOid, files: files.map(trimFile) };
        },
      );
    },
  });
}

function lastPage(link: string | null): number {
  const m = link && /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : 1;
}

interface CommitResponse {
  sha: string;
  parents: { sha: string }[];
  files?: DiffFile[];
}

export interface CommitFilesData {
  sha: string;
  parent: string | null;
  files: DiffFile[];
}

/** A commit's files. Commits are immutable, so the result never goes stale. */
export function useCommitFiles(owner: string, repo: string, sha: string) {
  return useQuery({
    queryKey: ["commit-files", owner, repo, sha],
    staleTime: Infinity,
    queryFn: async (): Promise<CommitFilesData> => {
      const path = `/repos/${owner}/${repo}/commits/${sha}`;
      const first = await restRaw<CommitResponse>(`${path}?per_page=100&page=1`);
      const last = Math.min(lastPage(first.headers.get("link")), 30);
      const more = await mapLimit(
        Array.from({ length: last - 1 }, (_, i) => i + 2),
        6,
        (p) => rest<CommitResponse>(`${path}?per_page=100&page=${p}`).then((r) => r.files ?? []),
      );
      const files = [...(first.data.files ?? []), ...more.flat()].map(trimFile);
      return { sha: first.data.sha, parent: first.data.parents[0]?.sha ?? null, files };
    },
  });
}

interface CompareResponse {
  merge_base_commit: { sha: string };
  commits: { sha: string }[];
  total_commits: number;
  files?: DiffFile[];
}

export interface CompareData {
  mergeBase: string;
  files: DiffFile[];
}

/** Files changed between two refs (GitHub returns at most 300). */
export function useCompareFiles(owner: string, repo: string, base: string, head: string) {
  return useQuery({
    queryKey: ["compare-files", owner, repo, base, head],
    queryFn: async (): Promise<CompareData> => {
      const d = await rest<CompareResponse>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`);
      return { mergeBase: d.merge_base_commit.sha, files: (d.files ?? []).map(trimFile) };
    },
  });
}

/** The merge base of two commits. Immutable for a pair of SHAs. */
export function fetchMergeBase(owner: string, repo: string, base: string, head: string): Promise<string> {
  return queryClient.fetchQuery({
    queryKey: ["merge-base", owner, repo, base, head],
    staleTime: Infinity,
    queryFn: async () => (await rest<CompareResponse>(`/repos/${owner}/${repo}/compare/${base}...${head}?per_page=1`)).merge_base_commit.sha,
  });
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Raw file contents at `ref`, fetched once and cached. */
export function fetchContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
  return queryClient.fetchQuery({
    queryKey: ["file-content", owner, repo, ref, path],
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    queryFn: () => rest<string>(`/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { accept: "application/vnd.github.raw", text: true }),
  });
}

export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";
export type ViewedMap = Record<string, ViewedState>;

const VIEWED_QUERY = `
  query PullViewedFiles($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
      }
    }
  }`;

type ViewedData = { repository: { pullRequest: { files: { pageInfo: PageInfo; nodes: { path: string; viewerViewedState: ViewedState }[] } } } };

export const viewedKey = (owner: string, repo: string, number: number) => [...keys.pullFiles(owner, repo, number), "viewed"] as const;

export function useViewedFiles(owner: string, repo: string, number: number, enabled = true) {
  return useQuery({
    queryKey: viewedKey(owner, repo, number),
    enabled,
    queryFn: async () => {
      const nodes = await gqlAll(async (after) => (await gql<ViewedData>(VIEWED_QUERY, { owner, repo, number, after })).repository.pullRequest.files);
      return Object.fromEntries(nodes.map((n) => [n.path, n.viewerViewedState])) as ViewedMap;
    },
  });
}

const MARK_VIEWED = `mutation MarkFileViewed($pullId: ID!, $path: String!) { markFileAsViewed(input: { pullRequestId: $pullId, path: $path }) { clientMutationId } }`;
const UNMARK_VIEWED = `mutation UnmarkFileViewed($pullId: ID!, $path: String!) { unmarkFileAsViewed(input: { pullRequestId: $pullId, path: $path }) { clientMutationId } }`;

/** Marks files viewed or unviewed on GitHub, updating the cache first. */
export function useSetViewed(owner: string, repo: string, number: number, pullId: string | undefined) {
  const key = viewedKey(owner, repo, number);
  return useMutation({
    mutationFn: async ({ paths, viewed }: { paths: string[]; viewed: boolean }) => {
      if (!pullId) throw new Error(`Failed to mark files viewed: PR ${owner}/${repo}#${number} has no id yet`);
      await mapLimit(paths, 4, (path) => gql(viewed ? MARK_VIEWED : UNMARK_VIEWED, { pullId, path }));
    },
    onMutate: async ({ paths, viewed }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ViewedMap>(key);
      const next = { ...prev };
      for (const p of paths) next[p] = viewed ? "VIEWED" : "UNVIEWED";
      queryClient.setQueryData(key, next);
      return { prev: Object.fromEntries(paths.map((p) => [p, prev?.[p] ?? "UNVIEWED"])) as ViewedMap };
    },
    // Restores only this mutation's paths, then refetches since some paths may have been saved.
    onError: (_e, _v, ctx) => {
      if (ctx) queryClient.setQueryData<ViewedMap>(key, (m) => ({ ...m, ...ctx.prev }));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
