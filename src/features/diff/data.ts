import { useMutation, useQuery } from "@tanstack/react-query";
import { gql, gqlAll, gqlPartial, isNotFound, mapLimit, rest, restAll, restRaw, type PageInfo } from "@/api/client";
import { gqlMutation, gqlQuery } from "@/api/operation";
import { keys } from "@/api/keys";
import { registerPathPrefetcher, speculate } from "@/api/prefetch";
import { persistQueryData, probeThenLoad, queryClient } from "@/api/queryClient";
import { splitLines, trimFile, type DiffFile } from "./model";

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

const HEAD_QUERY = gqlQuery("PullDiffHead", "$owner: String!, $repo: String!, $number: Int!", `
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id headRefOid baseRefOid baseRefName } }
  `);

type HeadData = { repository: { pullRequest: { id: string; headRefOid: string; baseRefOid: string; baseRefName: string } } };

/** Every file of a PR. A 1-point probe of the head SHA and base branch reuses the cached diff until either changes. */
export function usePullFiles(owner: string, repo: string, number: number) {
  return useQuery(pullFilesQueryOptions(owner, repo, number));
}

/** Files of PRs this large aren't prefetched; they take several requests. */
const PREFETCH_MAX_FILES = 300;

/** Warms a PR's files, unless the cached PR is known to be large. */
export function prefetchPullFiles(owner: string, repo: string, number: number, lane?: "background") {
  const changed = queryClient.getQueryData<{ changedFiles?: number }>(keys.pull(owner, repo, number))?.changedFiles;
  if (changed !== undefined && changed > PREFETCH_MAX_FILES) return;
  speculate(`files:${owner}/${repo}#${number}`.toLowerCase(), () => queryClient.prefetchQuery({ ...pullFilesQueryOptions(owner, repo, number), staleTime: 60_000 }), {
    resource: "core",
    lane,
  });
}

/** Starts loading a PR's files whatever their count, e.g. alongside its metadata when the page opens on Files changed. */
export function loadPullFiles(owner: string, repo: string, number: number) {
  void queryClient.prefetchQuery(pullFilesQueryOptions(owner, repo, number));
}

registerPathPrefetcher(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files$/, ([, owner, repo, number]) => prefetchPullFiles(owner, repo, Number(number)));

function pullFilesQueryOptions(owner: string, repo: string, number: number) {
  const key = keys.pullFiles(owner, repo, number);
  return {
    queryKey: key,
    queryFn: () => {
      let head: HeadData["repository"]["pullRequest"] | undefined;
      return probeThenLoad<PullFiles>(
        key,
        async () => {
          head = (await gql<HeadData>(HEAD_QUERY, { owner, repo, number })).repository.pullRequest;
          return `${head.headRefOid}:${head.baseRefName}`;
        },
        async (stampP) => {
          const [stamp, files] = await Promise.all([stampP, restAll<DiffFile>(`/repos/${owner}/${repo}/pulls/${number}/files`, { maxPages: 30 })]);
          return { stamp, pullId: head!.id, head: head!.headRefOid, baseRefOid: head!.baseRefOid, files: files.map(trimFile) };
        },
      );
    },
  };
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
  /** Commit SHA that `head` pointed to. */
  head: string;
  files: DiffFile[];
}

/** Files changed between two refs (GitHub returns at most 300). `head` resolves to a SHA so cached file contents match the diff. */
export function useCompareFiles(owner: string, repo: string, base: string, head: string) {
  return useQuery({
    queryKey: ["compare-diff", owner, repo, base, head],
    queryFn: async (): Promise<CompareData> => {
      const sha = (await rest<string>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(head)}`, { accept: "application/vnd.github.sha", text: true })).trim();
      const d = await rest<CompareResponse>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${sha}?per_page=1`);
      return { mergeBase: d.merge_base_commit.sha, head: sha, files: (d.files ?? []).map(trimFile) };
    },
  });
}

/** The merge base of two commits. Immutable for a pair of SHAs. */
export function fetchMergeBase(owner: string, repo: string, base: string, head: string): Promise<string> {
  return queryClient.fetchQuery({
    queryKey: ["merge-base", owner, repo, base, head],
    staleTime: Infinity,
    queryFn: async () => (await rest<CompareResponse>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`)).merge_base_commit.sha,
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

/** Both sides of a file as lines, for highlighting; null where a side is absent or unavailable. */
export interface FullTexts {
  base: string[] | null;
  head: string[] | null;
}

/** Query options for a file's full texts. Fetching them also starts on the files `ahead` returns, so they share the request. */
export function fullTextsOptions(source: DiffSource, file: DiffFile, ahead: () => readonly DiffFile[] = () => []) {
  return {
    queryKey: ["full-texts", source.id, file.filename],
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5,
    persister: undefined,
    queryFn: async (): Promise<FullTexts> => {
      for (const f of ahead()) void queryClient.prefetchQuery(fullTextsOptions(source, f));
      const oldPath = file.previous_filename ?? file.filename;
      // Resolved first, so both sides join the same batched request.
      const baseRef = file.status === "added" ? null : await source.base();
      const [base, head] = await Promise.all([
        baseRef === null ? null : fetchFileText(source.owner, source.repo, oldPath, baseRef),
        file.status === "removed" ? null : fetchFileText(source.owner, source.repo, file.filename, source.head),
      ]);
      return { base: base === null ? null : splitLines(base), head: head === null ? null : splitLines(head) };
    },
  };
}

/** Most file texts fetched in one request. */
const TEXT_BATCH_SIZE = 20;

type TextWaiter = { owner: string; repo: string; expression: string; resolve: (t: string | null) => void; reject: (e: unknown) => void };
let textQueue: TextWaiter[] = [];

/**
 * A file's text at `ref`, fetched once and cached, or null when it's missing, binary, or
 * truncated by GitHub. Calls made in the same task share one request.
 */
export function fetchFileText(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  return queryClient.fetchQuery({
    queryKey: ["file-text", owner, repo, ref, path],
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    // The persister restores each query in its own task, which would split the batch.
    persister: undefined,
    queryFn: () =>
      new Promise<string | null>((resolve, reject) => {
        textQueue.push({ owner, repo, expression: `${ref}:${path}`, resolve, reject });
        if (textQueue.length === 1) setTimeout(flushTexts);
      }),
  });
}

function flushTexts() {
  const waiters = textQueue;
  textQueue = [];
  for (let i = 0; i < waiters.length; i += TEXT_BATCH_SIZE) fetchTextBatch(waiters.slice(i, i + TEXT_BATCH_SIZE));
}

type BlobData = { object: { text: string | null; isTruncated: boolean } | null } | null;

async function fetchTextBatch(waiters: TextWaiter[]) {
  const params = waiters.map((_, i) => `$o${i}: String!, $r${i}: String!, $e${i}: String!`).join(", ");
  const parts = waiters.map((_, i) => `f${i}: repository(owner: $o${i}, name: $r${i}) { object(expression: $e${i}) { ... on Blob { text isTruncated } } }`);
  const vars = Object.fromEntries(waiters.flatMap((w, i) => [[`o${i}`, w.owner], [`r${i}`, w.repo], [`e${i}`, w.expression]]));
  try {
    const { data } = await gqlPartial<Record<string, BlobData>>(gqlQuery("FileTexts", params, parts.join("\n")), vars);
    waiters.forEach(({ resolve }, i) => {
      const blob = data[`f${i}`]?.object;
      resolve(blob && !blob.isTruncated ? (blob.text ?? null) : null);
    });
  } catch (e) {
    for (const { reject } of waiters) reject(e);
  }
}

/** The text of the repo's root `.editorconfig` on its default branch, or null when it has none. */
export function useEditorConfig(owner: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ["editorconfig", owner, repo],
    enabled,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      try {
        return await rest<string>(`/repos/${owner}/${repo}/contents/.editorconfig`, { accept: "application/vnd.github.raw", text: true });
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
  });
}

export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";
export type ViewedMap = Record<string, ViewedState>;

const VIEWED_QUERY = gqlQuery("PullViewedFiles", "$owner: String!, $repo: String!, $number: Int!, $after: String", `
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
      }
    }
  `);

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

const MARK_VIEWED = gqlMutation("MarkFileViewed", "$pullId: ID!, $path: String!", "markFileAsViewed(input: { pullRequestId: $pullId, path: $path }) { clientMutationId }");
const UNMARK_VIEWED = gqlMutation("UnmarkFileViewed", "$pullId: ID!, $path: String!", "unmarkFileAsViewed(input: { pullRequestId: $pullId, path: $path }) { clientMutationId }");

/** Marks files viewed or unviewed on GitHub, updating the cache first. */
export function useSetViewed(owner: string, repo: string, number: number, pullId: string | undefined) {
  const key = viewedKey(owner, repo, number);
  return useMutation({
    mutationFn: async ({ paths, viewed }: { paths: string[]; viewed: boolean }) => {
      if (!pullId) throw new Error(`Failed to mark files viewed: PR ${owner}/${repo}#${number} has no id yet`);
      await mapLimit(paths, 4, (path) =>
        gql(viewed ? MARK_VIEWED : UNMARK_VIEWED, { pullId, path }).catch((e) => {
          throw new Error(`Failed to mark ${path} as ${viewed ? "viewed" : "not viewed"}: ${e instanceof Error ? e.message : String(e)}`);
        }),
      );
    },
    onMutate: async ({ paths, viewed }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ViewedMap>(key);
      const next = { ...prev };
      for (const p of paths) next[p] = viewed ? "VIEWED" : "UNVIEWED";
      queryClient.setQueryData(key, next);
      return { prev: Object.fromEntries(paths.map((p) => [p, prev?.[p] ?? "UNVIEWED"])) as ViewedMap };
    },
    onSuccess: () => persistQueryData(key),
    // Restores only this mutation's paths, then refetches since some paths may have been saved.
    onError: (_e, _v, ctx) => {
      if (ctx) queryClient.setQueryData<ViewedMap>(key, (m) => ({ ...m, ...ctx.prev }));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
