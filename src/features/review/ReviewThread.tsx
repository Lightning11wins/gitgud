import { ChevronDownIcon, ChevronRightIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { memo, useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { gql } from "@/api/client";
import { ACTOR_FIELDS, REVIEW_COMMENT_FIELDS, type ReactionGroup, type ReviewComment, type ReviewThread } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Markdown } from "@/components/Markdown";
import { Popover } from "@/components/Popover";
import { RelativeTime } from "@/components/RelativeTime";
import { Composer } from "@/features/composer/Composer";
import { patchComment, patchThread } from "./cache";
import { DiffHunk } from "./DiffHunk";
import { ensurePendingReview, invalidateReview, usePendingReview } from "./pending";
import { ReactionPickerButton, ReactionPills, useReactions } from "./Reactions";
import "./review.css";

export interface ReviewThreadViewProps {
  thread: ReviewThread;
  owner: string;
  repo: string;
  number: number;
  /** Show the path and diff hunk above the comments (conversation tab). The Files tab already shows code. */
  showHunk?: boolean;
  /** Enables "Start a review" on replies when the viewer has no pending review. */
  pullId?: string;
}

const REPLY = `
  mutation ReplyToThread($threadId: ID!, $body: String!, $reviewId: ID) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, pullRequestReviewId: $reviewId, body: $body }) {
      comment { ${REVIEW_COMMENT_FIELDS} }
    }
  }`;

const UPDATE = `
  mutation UpdateReviewComment($id: ID!, $body: String!) {
    updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
      pullRequestReviewComment { body bodyHTML lastEditedAt }
    }
  }`;

const DELETE = `mutation DeleteReviewComment($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }`;

const RESOLVE_FIELDS = `thread { isResolved viewerCanResolve viewerCanUnresolve resolvedBy { ${ACTOR_FIELDS} } }`;
const RESOLVE = `mutation ResolveThread($id: ID!) { resolveReviewThread(input: { threadId: $id }) { ${RESOLVE_FIELDS} } }`;
const UNRESOLVE = `mutation UnresolveThread($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { ${RESOLVE_FIELDS} } }`;

type ResolveFields = Pick<ReviewThread, "isResolved" | "viewerCanResolve" | "viewerCanUnresolve" | "resolvedBy">;
type ResolveData = { resolveReviewThread?: { thread: ResolveFields }; unresolveReviewThread?: { thread: ResolveFields } };

const ASSOCIATION: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
};

/** One review thread: optional hunk, comments, reply box, and resolve toggle. */
export const ReviewThreadView = memo(function ReviewThreadView({ thread, owner, repo, number, showHunk, pullId }: ReviewThreadViewProps) {
  // Null follows the resolved state; a click pins it open or closed.
  const [open, setOpen] = useState<boolean | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const expanded = open ?? !thread.isResolved;
  const first = thread.comments.nodes[0];
  if (!first) return null;
  const pr = { owner, repo, number };

  const toggleResolved = async () => {
    setResolving(true);
    setError(null);
    try {
      const d = await gql<ResolveData>(thread.isResolved ? UNRESOLVE : RESOLVE, { id: thread.id });
      const next = (d.resolveReviewThread ?? d.unresolveReviewThread)!.thread;
      setOpen(null);
      patchThread(pr, thread.id, (t) => ({ ...t, ...next }));
      invalidateReview(owner, repo, number, ["timeline"]);
    } catch (e) {
      setError(e);
    } finally {
      setResolving(false);
    }
  };

  const resolveButton = (thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve) && (
    <button className="btn sm" onClick={toggleResolved} disabled={resolving}>
      {thread.isResolved ? "Unresolve conversation" : "Resolve conversation"}
    </button>
  );

  const showHeader = showHunk || thread.isResolved || thread.isOutdated;
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div className={`rt${thread.isResolved ? " resolved" : ""}`} data-thread-id={thread.id}>
      {showHeader && (
        <div className="rt-header" onClick={thread.isResolved ? () => setOpen(!expanded) : undefined}>
          {thread.isResolved && (
            <button className="btn invisible xs icon" aria-label={expanded ? "Collapse thread" : "Expand thread"} aria-expanded={expanded}>
              <Chevron size={14} />
            </button>
          )}
          {showHunk && (
            <Link className="rt-path truncate" to={`/${owner}/${repo}/pull/${number}/files`} onClick={(e) => e.stopPropagation()} title={thread.path}>
              {thread.path}
            </Link>
          )}
          {thread.isOutdated && <span className="label rt-outdated">Outdated</span>}
          <span className="grow" />
          {thread.isResolved && (
            <span className="rt-resolved-by muted">
              {thread.resolvedBy ? (
                <>
                  <strong>{thread.resolvedBy.login}</strong> marked this conversation as resolved.
                </>
              ) : (
                "Resolved"
              )}
            </span>
          )}
        </div>
      )}
      {expanded && (
        <>
          {showHunk && thread.subjectType === "LINE" && first.diffHunk && (
            <DiffHunk hunk={first.diffHunk} startLine={thread.originalStartLine} startSide={thread.startDiffSide} />
          )}
          {thread.comments.nodes.map((c) => (
            <ThreadComment key={c.id} comment={c} threadId={thread.id} owner={owner} repo={repo} number={number} />
          ))}
          {error != null && <ErrorBanner error={error} />}
          {thread.viewerCanReply ? (
            <ReplyBox thread={thread} owner={owner} repo={repo} number={number} pullId={pullId} resolveButton={resolveButton} />
          ) : (
            resolveButton && <div className="rt-footer row">{resolveButton}</div>
          )}
        </>
      )}
    </div>
  );
});

interface ReplyBoxProps {
  thread: ReviewThread;
  owner: string;
  repo: string;
  number: number;
  pullId?: string;
  resolveButton: ReactNode;
}

function ReplyBox({ thread, owner, repo, number, pullId, resolveButton }: ReplyBoxProps) {
  const [replying, setReplying] = useState(false);
  const pending = usePendingReview(owner, repo, number, replying);
  const pr = { owner, repo, number };

  const reply = async (body: string, reviewId?: string) => {
    // Without a review id GitHub joins the viewer's pending review if any, else posts at once.
    const d = await gql<{ addPullRequestReviewThreadReply: { comment: ReviewComment } }>(REPLY, { threadId: thread.id, body, reviewId });
    const comment = d.addPullRequestReviewThreadReply.comment;
    patchThread(pr, thread.id, (t) => ({ ...t, comments: { totalCount: t.comments.totalCount + 1, nodes: [...t.comments.nodes, comment] } }));
    setReplying(false);
    invalidateReview(owner, repo, number, comment.state === "PENDING" ? ["pendingReview", "timeline"] : ["timeline"]);
  };

  if (!replying) {
    return (
      <div className="rt-footer row">
        <button className="rt-reply-fake input sm grow" onClick={() => setReplying(true)}>
          Reply...
        </button>
        {resolveButton}
      </div>
    );
  }
  const hasPending = !!pending.data;
  return (
    <div className="rt-footer">
      <Composer
        draftKey={`${owner}/${repo}#${number}:reply:${thread.id}`}
        owner={owner}
        repo={repo}
        placeholder="Reply..."
        githubUrl={`https://github.com/${owner}/${repo}/pull/${number}`}
        submitLabel={hasPending ? "Add review comment" : "Reply"}
        autoFocus
        minRows={3}
        onSubmit={(body) => reply(body)}
        onCancel={() => setReplying(false)}
        actions={
          !hasPending && pullId && !pending.isLoading
            ? ({ run, submitting, value }) => (
                <button
                  className="btn"
                  disabled={submitting || !value.trim()}
                  onClick={() => run(async (body) => reply(body, await ensurePendingReview(owner, repo, number, pullId)))}
                >
                  Start a review
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}

interface ThreadCommentProps {
  comment: ReviewComment;
  threadId: string;
  owner: string;
  repo: string;
  number: number;
}

const ThreadComment = memo(function ThreadComment({ comment, threadId, owner, repo, number }: ThreadCommentProps) {
  const [editing, setEditing] = useState(false);
  const [showMinimized, setShowMinimized] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const onReactions = useCallback(
    (reactionGroups: ReactionGroup[]) => patchComment({ owner, repo, number }, threadId, comment.id, (c) => ({ ...c, reactionGroups })),
    [owner, repo, number, threadId, comment.id],
  );
  const reactions = useReactions(comment.id, comment.reactionGroups, onReactions);

  const save = async (body: string) => {
    const d = await gql<{ updatePullRequestReviewComment: { pullRequestReviewComment: Pick<ReviewComment, "body" | "bodyHTML" | "lastEditedAt"> } }>(UPDATE, {
      id: comment.id,
      body,
    });
    patchComment({ owner, repo, number }, threadId, comment.id, (c) => ({ ...c, ...d.updatePullRequestReviewComment.pullRequestReviewComment }));
    setEditing(false);
    invalidateReview(owner, repo, number, ["timeline"]);
  };

  const remove = async () => {
    setMenu(null);
    if (!confirm("Are you sure you want to delete this comment?")) return;
    setDeleting(true);
    setError(null);
    try {
      await gql(DELETE, { id: comment.id });
      patchThread({ owner, repo, number }, threadId, (t) => {
        const nodes = t.comments.nodes.filter((c) => c.id !== comment.id);
        return nodes.length ? { ...t, comments: { totalCount: t.comments.totalCount - 1, nodes } } : null;
      });
      invalidateReview(owner, repo, number, comment.state === "PENDING" ? ["pendingReview", "timeline"] : ["timeline"]);
    } catch (e) {
      setError(e);
      setDeleting(false);
    }
  };

  const hidden = comment.isMinimized && !showMinimized;
  const association = ASSOCIATION[comment.authorAssociation];
  const login = comment.author?.login ?? "ghost";

  return (
    <div className={`rt-comment${deleting ? " deleting" : ""}`} id={`r${comment.databaseId}`}>
      <div className="rt-comment-head">
        <Avatar src={comment.author?.avatarUrl} login={login} size={20} />
        <a className="rt-author" href={comment.author?.url ?? undefined} target="_blank" rel="noopener noreferrer">
          {login}
        </a>
        <a className="rt-time" href={comment.url} target="_blank" rel="noopener noreferrer">
          <RelativeTime date={comment.createdAt} />
        </a>
        {comment.lastEditedAt && (
          <span className="rt-edited" title={`Edited ${new Date(comment.lastEditedAt).toLocaleString()}`}>
            edited
          </span>
        )}
        {comment.state === "PENDING" && <span className="label rt-pending">Pending</span>}
        <span className="grow" />
        {association && <span className="label rt-assoc">{association}</span>}
        {comment.viewerCanReact && !hidden && <ReactionPickerButton groups={reactions.groups} onToggle={reactions.toggle} />}
        {(comment.viewerCanUpdate || comment.viewerCanDelete) && (
          <button className="btn invisible xs icon" aria-label="Comment actions" onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
            <KebabHorizontalIcon size={14} />
          </button>
        )}
        {menu && (
          <Popover anchor={menu} onClose={() => setMenu(null)} align="end" width={180}>
            <div className="select-menu-list">
              <button className="select-menu-item" onClick={() => {
                  setMenu(null);
                  navigator.clipboard?.writeText(comment.url).catch(() => {});
                }}>
                Copy link
              </button>
              {comment.viewerCanUpdate && (
                <button
                  className="select-menu-item"
                  onClick={() => {
                    setMenu(null);
                    setEditing(true);
                    setShowMinimized(true);
                  }}
                >
                  Edit
                </button>
              )}
              {comment.viewerCanDelete && (
                <button className="select-menu-item rt-danger" onClick={remove}>
                  Delete
                </button>
              )}
            </div>
          </Popover>
        )}
      </div>
      {error != null && <ErrorBanner error={error} />}
      {editing ? (
        <div className="rt-edit">
          <Composer
            draftKey={`${owner}/${repo}#${number}:edit:${comment.id}`}
            owner={owner}
            repo={repo}
            initialValue={comment.body}
            githubUrl={`https://github.com/${owner}/${repo}/pull/${number}`}
            submitLabel="Update comment"
            autoFocus
            minRows={3}
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : hidden ? (
        <div className="rt-minimized muted">
          This comment was marked as {(comment.minimizedReason ?? "hidden").toLowerCase().replace(/_/g, " ")}.{" "}
          <button className="btn-link" onClick={() => setShowMinimized(true)}>
            Show comment
          </button>
        </div>
      ) : (
        <>
          <Markdown html={comment.bodyHTML} className="rt-body" />
          <ReactionPills groups={reactions.groups} canReact={comment.viewerCanReact} onToggle={reactions.toggle} error={reactions.error} />
        </>
      )}
    </div>
  );
});
