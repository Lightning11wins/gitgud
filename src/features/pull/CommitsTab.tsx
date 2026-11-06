import { EllipsisIcon, GitCommitIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { memo, useState } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RelativeTime } from "@/components/RelativeTime";
import { Spinner } from "@/components/Spinner";
import { commitsQueryOptions, type PullCommit, type PullMeta } from "./api";
import { OutcomeIcon, rollupOutcome } from "./checks";
import { CopyButton, groupByDay } from "./util";

/** Commit authors' avatars and a "x and y committed" line. */
export function CommitAuthors({ commit }: { commit: Pick<PullCommit, "authors"> }) {
  const authors = commit.authors.nodes;
  const names = authors.map((a) => a.user?.login ?? a.name ?? "unknown");
  return (
    <>
      <span className="commit-avatars">
        {authors.slice(0, 3).map((a, i) => (
          <Avatar key={i} src={a.user?.avatarUrl} size={16} login={names[i]} />
        ))}
      </span>
      <strong className="commit-author">{names.length > 2 ? `${names[0]} and ${names.length - 1} others` : names.join(" and ")}</strong>
    </>
  );
}

/** GitHub's Verified or Unverified label; nothing for unsigned commits. */
export function SignatureLabel({ signature }: { signature: PullCommit["signature"] }) {
  if (!signature) return null;
  return signature.isValid ? (
    <span className="label signature-label verified" title="This commit has a verified signature">Verified</span>
  ) : (
    <span className="label signature-label unverified" title="This commit's signature could not be verified">Unverified</span>
  );
}

export const CommitRow = memo(function CommitRow({ commit, to }: { commit: PullCommit; to?: string }) {
  const [open, setOpen] = useState(false);
  const outcome = rollupOutcome(commit.statusCheckRollup?.state);
  return (
    <div className="box-row commit-row">
      <div className="row">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row commit-headline">
            {to ? (
              <Link to={to} className="truncate commit-title">
                {commit.messageHeadline}
              </Link>
            ) : (
              <a href={commit.url} target="_blank" rel="noopener noreferrer" className="truncate commit-title">
                {commit.messageHeadline}
              </a>
            )}
            {commit.messageBody && (
              <button className="btn xs icon commit-expand" aria-expanded={open} aria-label="Show commit message body" onClick={() => setOpen(!open)}>
                <EllipsisIcon size={12} />
              </button>
            )}
          </div>
          <div className="row muted commit-meta">
            <CommitAuthors commit={commit} />
            <span>
              committed <RelativeTime date={commit.committedDate} />
            </span>
            {outcome && <OutcomeIcon outcome={outcome} size={14} />}
          </div>
        </div>
        <SignatureLabel signature={commit.signature} />
        <span className="commit-sha">
          <CopyButton text={commit.oid} label="Copy full SHA" />
          {to ? (
            <Link to={to} className="mono">
              {commit.abbreviatedOid}
            </Link>
          ) : (
            <a href={commit.url} target="_blank" rel="noopener noreferrer" className="mono">
              {commit.abbreviatedOid}
            </a>
          )}
        </span>
      </div>
      {open && <pre className="commit-body">{commit.messageBody}</pre>}
    </div>
  );
});

/** Commits grouped by day under date headings, oldest first like GitHub. */
export function CommitList({ commits, linkFor }: { commits: PullCommit[]; linkFor?: (c: PullCommit) => string }) {
  return (
    <div className="commit-list">
      {groupByDay(commits, (c) => c.committedDate).map((g) => (
        <section key={g.day} className="commit-group">
          <h3 className="commit-day row muted">
            <GitCommitIcon /> Commits on {g.day}
          </h3>
          <div className="box">
            {g.items.map((c) => (
              <CommitRow key={c.oid} commit={c} to={linkFor?.(c)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function CommitsTab({ pull, owner, repo }: { pull: PullMeta; owner: string; repo: string }) {
  const q = useQuery(commitsQueryOptions(owner, repo, pull.number));
  if (!q.data) {
    if (q.error) return <ErrorBanner error={q.error} />;
    return (
      <div className="blankslate">
        <Spinner label="Loading commits" />
      </div>
    );
  }
  const base = `/${owner}/${repo}/pull/${pull.number}/commits/`;
  return (
    <>
      {q.error != null && <ErrorBanner error={q.error} />}
      <CommitList commits={q.data.commits} linkFor={(c) => base + c.oid} />
    </>
  );
}
