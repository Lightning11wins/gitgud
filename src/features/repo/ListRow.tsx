import { memo, useEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { CheckCircleIcon, CheckIcon, CommentIcon, DotFillIcon, FileDiffIcon, XIcon } from "@primer/octicons-react";
import { prefetchSubject } from "@/api/prefetch";
import { Avatar } from "@/components/Avatar";
import { IssueLabel } from "@/components/IssueLabel";
import { RelativeTime } from "@/components/RelativeTime";
import { StateIcon } from "@/components/StateBadge";
import type { ListItem } from "./searchList";

export const ROW_HEIGHT = 56;
const MAX_LABELS = 4;
const PREFETCH_DELAY_MS = 150;

export function itemPath(item: ListItem): string {
  return `/${item.repository.nameWithOwner}/${item.__typename === "PullRequest" ? "pull" : "issues"}/${item.number}`;
}

/** Review outcomes worth flagging. Most open PRs await review, so that state has no icon. */
const REVIEW: Partial<Record<string, { Icon: typeof CheckIcon; color: string; text: string }>> = {
  APPROVED: { Icon: CheckCircleIcon, color: "var(--success)", text: "Approved" },
  CHANGES_REQUESTED: { Icon: FileDiffIcon, color: "var(--danger)", text: "Changes requested" },
};

function checkStatus(state: string | undefined) {
  if (state === "SUCCESS") return { Icon: CheckIcon, color: "var(--success)", text: "Checks passed" };
  if (state === "FAILURE" || state === "ERROR") return { Icon: XIcon, color: "var(--danger)", text: "Checks failed" };
  if (state === "PENDING" || state === "EXPECTED") return { Icon: DotFillIcon, color: "var(--attention)", text: "Checks running" };
  return null;
}

function Status({ item }: { item: ListItem }) {
  if (item.__typename !== "PullRequest" || item.state !== "OPEN") return null;
  const review = !item.isDraft && item.reviewDecision ? REVIEW[item.reviewDecision] : undefined;
  const ci = checkStatus(item.commits?.nodes[0]?.commit.statusCheckRollup?.state);
  return (
    <>
      {ci && (
        <span className="lr-slot" style={{ color: ci.color }} title={ci.text}>
          <ci.Icon size={16} />
        </span>
      )}
      {review && (
        <span className="lr-slot" style={{ color: review.color }} title={review.text}>
          <review.Icon size={16} />
        </span>
      )}
    </>
  );
}

export interface ListRowProps {
  item: ListItem;
  showRepo?: boolean;
  active?: boolean;
  style?: CSSProperties;
}

export const ListRow = memo(function ListRow({ item, showRepo, active, style }: ListRowProps) {
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const isPr = item.__typename === "PullRequest";
  const [owner, repo] = item.repository.nameWithOwner.split("/");
  const labels = item.labels.nodes;

  return (
    <div
      className="list-row"
      data-active={active}
      style={style}
      onMouseEnter={() => {
        timer.current = window.setTimeout(() => prefetchSubject(isPr ? "pull" : "issue", owner, repo, item.number), PREFETCH_DELAY_MS);
      }}
      onMouseLeave={() => window.clearTimeout(timer.current)}
    >
      <span className="lr-icon">
        <StateIcon kind={isPr ? "pull" : "issue"} state={item.state} stateReason={item.stateReason} isDraft={item.isDraft} />
      </span>
      <div className="lr-main">
        <div className="lr-title">
          {showRepo && <span className="muted lr-repo">{item.repository.nameWithOwner}</span>}
          <Link className="lr-link truncate" to={itemPath(item)} data-row-link>
            {item.title}
          </Link>
          {labels.length > 0 && (
            <span className="lr-labels">
              {labels.slice(0, MAX_LABELS).map((l) => (
                <IssueLabel key={l.name} label={l} />
              ))}
              {labels.length > MAX_LABELS && <span className="muted">+{labels.length - MAX_LABELS}</span>}
            </span>
          )}
        </div>
        <div className="lr-meta muted truncate">
          #{item.number} <RelativeTime date={item.createdAt} prefix="opened" />
          {item.author && ` by ${item.author.login}`}
          {item.isDraft && " · Draft"}
        </div>
      </div>
      <div className="lr-side">
        <Status item={item} />
        <span className="lr-comments muted" title={`${item.comments.totalCount} comments`}>
          {item.comments.totalCount > 0 && (
            <>
              <CommentIcon size={14} /> {item.comments.totalCount}
            </>
          )}
        </span>
        <span className="lr-assignees">
          {item.assignees.nodes.slice(0, 3).map((a) => (
            <Avatar key={a.login} src={a.avatarUrl} login={a.login} size={20} />
          ))}
        </span>
        <span className="lr-updated muted">
          <RelativeTime date={item.updatedAt} />
        </span>
      </div>
    </div>
  );
});
