import { useEffect, useMemo } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { useReviewThreads } from "@/features/review/threads";
import { fetchMergeBase, useCommitFiles, useCompareFiles, usePullFiles, useSetViewed, useViewedFiles, type DiffSource } from "./data";
import { DiffView } from "./DiffView";

function Loading({ error, retry }: { error: unknown; retry: () => void }) {
  if (error) return <ErrorBanner error={error} action={<button className="btn sm" onClick={retry}>Retry</button>} />;
  return (
    <div className="blankslate">
      <Spinner size={24} />
    </div>
  );
}

export function FilesChanged({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const files = usePullFiles(owner, repo, number);
  const threads = useReviewThreads(owner, repo, number);
  const viewed = useViewedFiles(owner, repo, number);
  const data = files.data;
  const setViewed = useSetViewed(owner, repo, number, data?.pullId);
  const source = useMemo<DiffSource | undefined>(
    () =>
      data && {
        owner,
        repo,
        id: `pr:${owner}/${repo}#${number}@${data.stamp}`,
        head: data.head,
        base: () => fetchMergeBase(owner, repo, data.baseRefOid, data.head),
      },
    [owner, repo, number, data],
  );
  const pull = useMemo(() => data && { owner, repo, number, pullId: data.pullId, head: data.head }, [owner, repo, number, data]);
  const mutate = setViewed.mutate;
  const onSetViewed = useMemo(() => (paths: string[], v: boolean) => mutate({ paths, viewed: v }), [mutate]);
  const { error: viewedError, reset: resetViewed } = setViewed;
  useEffect(() => {
    if (!viewedError) return;
    const t = setTimeout(resetViewed, 8000);
    return () => clearTimeout(t);
  }, [viewedError, resetViewed]);
  if (!data || !source || !pull) return <Loading error={files.error} retry={() => files.refetch()} />;
  return (
    <DiffView
      files={data.files}
      source={source}
      pull={pull}
      threads={threads.data}
      viewed={viewed.data}
      onSetViewed={onSetViewed}
      viewedError={viewedError}
      onDismissViewedError={resetViewed}
      fetching={files.isFetching || threads.isFetching}
      notice={data.files.length >= 3000 ? "GitHub returns at most 3,000 files for a pull request; some files are not shown." : undefined}
    />
  );
}

export function CommitFiles({ owner, repo, sha }: { owner: string; repo: string; sha: string }) {
  const q = useCommitFiles(owner, repo, sha);
  const data = q.data;
  const source = useMemo<DiffSource | undefined>(
    () =>
      data && {
        owner,
        repo,
        id: `commit:${owner}/${repo}@${data.sha}`,
        head: data.sha,
        base: async () => {
          if (!data.parent) throw new Error(`Failed to load the parent of commit ${data.sha}: it has none`);
          return data.parent;
        },
      },
    [owner, repo, data],
  );
  if (!data || !source) return <Loading error={q.error} retry={() => q.refetch()} />;
  return <DiffView files={data.files} source={source} fetching={q.isFetching} />;
}

/** Diff between two refs, for the compare / new PR page. */
export function CompareFiles({ owner, repo, base, head }: { owner: string; repo: string; base: string; head: string }) {
  const q = useCompareFiles(owner, repo, base, head);
  const data = q.data;
  const source = useMemo<DiffSource | undefined>(
    () => data && { owner, repo, id: `compare:${owner}/${repo}@${base}...${head}`, head, base: async () => data.mergeBase },
    [owner, repo, base, head, data],
  );
  if (!data || !source) return <Loading error={q.error} retry={() => q.refetch()} />;
  return (
    <DiffView
      files={data.files}
      source={source}
      fetching={q.isFetching}
      notice={data.files.length >= 300 ? "GitHub compares at most 300 files; some files are not shown." : undefined}
    />
  );
}
