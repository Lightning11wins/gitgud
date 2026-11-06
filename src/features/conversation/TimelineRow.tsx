import { memo } from "react";
import type { SubjectKind } from "@/api/prefetch";
import type { ReactionContent, ReviewThread } from "@/api/types";
import { CommentCard } from "./CommentCard";
import { CommitGroup, EventGroupRow, EventRow, ReferenceGroup } from "./Events";
import type { MinimizeReason } from "./mutations";
import { ReviewItemView } from "./ReviewItem";
import type { Row } from "./rows";
import type { EventItem, IssueCommentItem, ReviewItem } from "./types";

/** Stable callbacks and context shared by every row, so rows can be memoized. */
export interface TimelineActions {
  kind: SubjectKind;
  owner: string;
  repo: string;
  number: number;
  subjectAuthor: string | undefined;
  githubUrl: string;
  quote: (text: string) => void;
  saveComment: (id: string, body: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  minimize: (id: string, minimize: boolean, reason?: MinimizeReason) => Promise<void>;
  react: (id: string, content: ReactionContent, add: boolean) => void;
  saveReview: (id: string, body: string) => Promise<void>;
}

export const TimelineRow = memo(function TimelineRow({ row, actions, threads }: { row: Row; actions: TimelineActions; threads?: ReviewThread[] }) {
  if (row.type === "commits") {
    return (
      <div className="tl-item event">
        <CommitGroup commits={row.commits} pullPath={`/${actions.owner}/${actions.repo}/pull/${actions.number}`} />
      </div>
    );
  }
  if (row.type === "refs") {
    return (
      <div className="tl-item event">
        <ReferenceGroup events={row.refs} />
      </div>
    );
  }
  if (row.type === "events") {
    return (
      <div className="tl-item event">
        <EventGroupRow events={row.events} />
      </div>
    );
  }
  const item = row.item;
  if (item.__typename === "IssueComment") {
    const c = item as IssueCommentItem;
    const { owner, repo, number } = actions;
    return (
      <div className="tl-item comment">
        <CommentCard
          comment={c}
          owner={owner}
          repo={repo}
          draftKey={`${owner}/${repo}#${number}:edit:${c.id}`}
          githubUrl={actions.githubUrl}
          anchor={c.databaseId ? `issuecomment-${c.databaseId}` : undefined}
          isSubjectAuthor={!!c.author && c.author.login === actions.subjectAuthor}
          className={c.id.startsWith("optimistic-") ? "pending" : undefined}
          onSave={(body) => actions.saveComment(c.id, body)}
          onDelete={() => actions.deleteComment(c.id)}
          onReact={(content, add) => actions.react(c.id, content, add)}
          onQuote={actions.quote}
          onMinimize={(m, reason) => actions.minimize(c.id, m, reason)}
          canMinimize={c.viewerCanMinimize}
        />
      </div>
    );
  }
  if (item.__typename === "PullRequestReview") {
    const r = item as ReviewItem;
    if (r.state === "COMMENTED" && !r.body.trim() && !threads?.length) return null;
    return (
      <div className="tl-item review">
        <ReviewItemView review={r} threads={threads} actions={actions} />
      </div>
    );
  }
  return (
    <div className="tl-item event">
      <EventRow item={item as EventItem} repo={`${actions.owner}/${actions.repo}`} pull={actions.kind === "pull"} />
    </div>
  );
});
