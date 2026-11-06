export function FilesChanged(_props: { owner: string; repo: string; number: number }) {
  return <div className="blankslate">FilesChanged is not built yet.</div>;
}

export function CommitFiles(_props: { owner: string; repo: string; sha: string }) {
  return <div className="blankslate">CommitFiles is not built yet.</div>;
}

/** Diff between two refs, for the compare / new PR page. */
export function CompareFiles(_props: { owner: string; repo: string; base: string; head: string }) {
  return <div className="blankslate">CompareFiles is not built yet.</div>;
}
