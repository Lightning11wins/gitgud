import { queryClient } from "@/api/queryClient";
import { findListRow } from "@/api/subjects";
import { RelativeTime } from "@/components/RelativeTime";
import { Spinner } from "@/components/Spinner";
import { StateBadge } from "@/components/StateBadge";
import { TitleText } from "@/components/TitleText";
import type { ListItem } from "@/features/repo/searchList";

interface Props {
  kind: "issue" | "pull";
  owner: string;
  repo: string;
  number: number;
}

/**
 * An issue or PR page header drawn from a cached list row, shown while the page's own data loads.
 * Renders a plain spinner when no list holds the item.
 */
export function SubjectSeed({ kind, owner, repo, number }: Props) {
  const row = findListRow(queryClient, owner, repo, number) as ListItem | undefined;
  const label = kind === "issue" ? "Loading issue" : "Loading pull request";
  if (!row || (row.__typename === "PullRequest") !== (kind === "pull")) {
    return (
      <div className="blankslate">
        <Spinner size={20} label={label} />
      </div>
    );
  }
  const badge = <StateBadge kind={kind} state={row.state} stateReason={row.stateReason} isDraft={row.isDraft} />;
  const author = row.author?.login ?? "ghost";
  const loading = (
    <div className="blankslate">
      <Spinner size={20} label={label} />
    </div>
  );

  if (kind === "issue") {
    const comments = row.comments.totalCount;
    return (
      <div className="issue-page">
        <div className="issue-header">
          <div className="row issue-title-row">
            <h1 className="issue-title grow">
              <bdi><TitleText text={row.title} /></bdi> <span className="muted">#{row.number}</span>
            </h1>
          </div>
          <div className="row issue-subtitle">
            {badge}
            <span className="muted">
              <span className="issue-author">{author}</span> opened this issue <RelativeTime date={row.createdAt} /> · {comments} comment
              {comments === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {loading}
      </div>
    );
  }
  return (
    <div className="pull-page">
      <header className="pull-header">
        <div className="pull-title-row">
          <h1 className="pull-title">
            <span className="pull-title-text"><TitleText text={row.title} /></span> <span className="muted pull-number">#{row.number}</span>
          </h1>
        </div>
        <div className="pull-subtitle">
          {badge}
          <span>
            <strong>{author}</strong> opened this pull request <RelativeTime date={row.createdAt} />
          </span>
        </div>
      </header>
      {loading}
    </div>
  );
}
