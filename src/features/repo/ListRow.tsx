import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { CheckIcon, CommentIcon, DotFillIcon, GitPullRequestIcon, XIcon } from "@primer/octicons-react";
import { prefetchSubject } from "@/api/prefetch";
import { Avatar } from "@/components/Avatar";
import { IssueLabel } from "@/components/IssueLabel";
import { RelativeTime } from "@/components/RelativeTime";
import { StateIcon } from "@/components/StateBadge";
import { TitleText } from "@/components/TitleText";
import type { CheckSummary, ListItem } from "./searchList";

export const ROW_HEIGHT = 56;
const MAX_LABELS = 4;
const PREFETCH_DELAY_MS = 150;
const byName = new Intl.Collator(undefined, { sensitivity: "base" });

export function itemPath(item: ListItem): string {
  return `/${item.repository.nameWithOwner}/${item.__typename === "PullRequest" ? "pull" : "issues"}/${item.number}`;
}

const REVIEW: Record<string, { text: string; color?: string }> = {
  REVIEW_REQUIRED: { text: "Review required" },
  APPROVED: { text: "Approved", color: "var(--success)" },
  CHANGES_REQUESTED: { text: "Changes requested", color: "var(--danger)" },
};

function checkIcon(state: string) {
  if (state === "SUCCESS") return { Icon: CheckIcon, color: "var(--success)" };
  if (state === "FAILURE" || state === "ERROR") return { Icon: XIcon, color: "var(--danger)" };
  return { Icon: DotFillIcon, color: "var(--attention)" };
}

/** Review decision and checks, as " · Review required · ✓ 6/6". */
function ReviewStatus({ item }: { item: ListItem }) {
  const review = item.reviewDecision ? REVIEW[item.reviewDecision] : undefined;
  if (!review) return null;
  return (
    <>
      {" · "}
      <span style={{ color: review.color }}>{review.text}</span>
    </>
  );
}

/** Ends the meta line, since check counts load after the row and must not push the rest. */
function ChecksStatus({ item, checks }: { item: ListItem; checks?: CheckSummary | null }) {
  const ci = checks?.total ? checkIcon(checks.state) : null;
  return (
    <>
      {checks && ci && (
        <>
          {" · "}
          <Link className="lr-checks" to={`${itemPath(item)}/checks`} title={`${checks.passed} of ${checks.total} checks passed`}>
            <ci.Icon size={12} fill={ci.color} />
            {checks.passed}/{checks.total}
          </Link>
        </>
      )}
    </>
  );
}

/** The color of an issue's linked pull requests: merged, then open, then draft, then closed wins. */
function linkedPrColor(prs: NonNullable<ListItem["linkedPrs"]>["nodes"]): string {
  if (prs.some((p) => p.state === "MERGED")) return "var(--done)";
  if (prs.some((p) => p.state === "OPEN" && !p.isDraft)) return "var(--success)";
  if (prs.some((p) => p.state === "OPEN")) return "var(--fg-muted)";
  return prs.length ? "var(--danger)" : "var(--fg-muted)";
}

export interface ListRowProps {
  item: ListItem;
  /** Undefined until loaded; null when the PR has no checks. */
  checks?: CheckSummary | null;
  showRepo?: boolean;
  active?: boolean;
  /** Show when the item was last updated, for lists sorted by it. */
  showUpdated?: boolean;
  style?: CSSProperties;
}

export const ListRow = memo(function ListRow({ item, checks, showRepo, active, showUpdated, style }: ListRowProps) {
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const isPr = item.__typename === "PullRequest";
  const [owner, repo] = item.repository.nameWithOwner.split("/");
  const labels = useMemo(() => [...item.labels.nodes].sort((a, b) => byName.compare(a.name, b.name)), [item.labels.nodes]);
  const comments = item.totalCommentsCount ?? item.comments.totalCount;

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
          <Link className="lr-link truncate" to={itemPath(item)} title={item.title} data-row-link>
            <TitleText text={item.title} />
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
          {isPr && <ReviewStatus item={item} />}
          {showUpdated && (
            <>
              {" · "}
              <RelativeTime date={item.updatedAt} prefix="updated" />
            </>
          )}
          {isPr && <ChecksStatus item={item} checks={checks} />}
        </div>
      </div>
      <div className="lr-side">
        {!!item.linkedPrs?.totalCount && (
          <span className="lr-prs muted" title={`${item.linkedPrs.totalCount} linked pull request${item.linkedPrs.totalCount === 1 ? "" : "s"}`}>
            <GitPullRequestIcon size={14} fill={linkedPrColor(item.linkedPrs.nodes)} /> {item.linkedPrs.totalCount}
          </span>
        )}
        <span className="lr-assignees">
          {item.assignees.nodes.slice(0, 3).map((a) => (
            <Avatar key={a.login} src={a.avatarUrl} login={a.login} size={20} />
          ))}
        </span>
        <span className="lr-comments muted" title={`${comments} comments`}>
          {comments > 0 && (
            <>
              <CommentIcon size={14} /> {comments}
            </>
          )}
        </span>
      </div>
    </div>
  );
});
