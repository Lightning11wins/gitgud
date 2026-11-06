import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { RelativeTime } from "@/components/RelativeTime";
import { CommitFiles } from "@/features/diff/FilesChanged";
import { commitsQueryOptions, type PullMeta } from "./api";
import { OutcomeIcon, rollupOutcome } from "./checks";
import { CommitAuthors } from "./CommitsTab";
import { CopyButton } from "./util";

/** `/pull/:n/commits/:sha`: the commit's message, author, parents, prev/next navigation, and its diff. */
export function CommitView({ pull, owner, repo, sha }: { pull: PullMeta; owner: string; repo: string; sha: string }) {
  const q = useQuery(commitsQueryOptions(owner, repo, pull.number));
  const commits = q.data?.commits ?? [];
  const index = commits.findIndex((c) => c.oid.startsWith(sha));
  const commit = index >= 0 ? commits[index] : undefined;
  const prev = index > 0 ? commits[index - 1] : undefined;
  const next = index >= 0 ? commits[index + 1] : undefined;
  const base = `/${owner}/${repo}/pull/${pull.number}/commits/`;
  const fullSha = commit?.oid ?? sha;
  const outcome = rollupOutcome(commit?.statusCheckRollup?.state);

  return (
    <div className="commit-view">
      <div className="box commit-view-header">
        <div className="box-header row">
          <span className="grow muted">
            {commits.length > 0 && index >= 0 ? `Commit ${index + 1} of ${commits.length}` : "Commit"}
          </span>
          <div className="btn-group">
            <NavButton to={prev && base + prev.oid} label="Prev" icon={<ChevronLeftIcon />} />
            <NavButton to={next && base + next.oid} label="Next" icon={<ChevronRightIcon />} after />
          </div>
        </div>
        <div className="commit-view-body">
          {commit ? (
            <>
              <h2 className="commit-view-title">
                {commit.messageHeadline} {outcome && <OutcomeIcon outcome={outcome} />}
              </h2>
              {commit.messageBody && <pre className="commit-body">{commit.messageBody}</pre>}
            </>
          ) : (
            <h2 className="commit-view-title">{q.isPending ? "Loading commit..." : "This commit isn't part of the pull request's current commits."}</h2>
          )}
        </div>
        <div className="row commit-view-meta">
          {commit && (
            <span className="row grow muted" style={{ gap: 6 }}>
              <CommitAuthors commit={commit} /> committed <RelativeTime date={commit.committedDate} />
            </span>
          )}
          {!commit && <span className="grow" />}
          {commit?.parents.nodes.map((p) => (
            <span key={p.oid} className="muted">
              parent{" "}
              {commits.some((c) => c.oid === p.oid) ? (
                <Link className="mono" to={base + p.oid}>
                  {p.abbreviatedOid}
                </Link>
              ) : (
                <a className="mono" href={`https://github.com/${owner}/${repo}/commit/${p.oid}`} target="_blank" rel="noopener noreferrer">
                  {p.abbreviatedOid}
                </a>
              )}
            </span>
          ))}
          <span className="muted">
            commit <code className="mono">{fullSha}</code>
          </span>
          <CopyButton text={fullSha} label="Copy full SHA" />
        </div>
      </div>
      <CommitFiles owner={owner} repo={repo} sha={sha} />
    </div>
  );
}

function NavButton({ to, label, icon, after }: { to?: string; label: string; icon: ReactNode; after?: boolean }) {
  const content = after ? (
    <>
      {label} {icon}
    </>
  ) : (
    <>
      {icon} {label}
    </>
  );
  return to ? (
    <Link className="btn sm" to={to}>
      {content}
    </Link>
  ) : (
    <button className="btn sm" disabled>
      {content}
    </button>
  );
}
