import { memo } from "react";
import type { SubjectKind } from "@/api/prefetch";
import type { ReactionContent, ReviewThread } from "@/api/types";
import { CommentCard } from "./CommentCard";
import { CommitGroup, EventRow } from "./Events";
import type { MinimizeReason } from "./mutations";
import { ReviewItemView } from "./ReviewItem";
import type { CommitItem, EventItem, IssueCommentItem, ReviewItem, TimelineItem } from "./types";

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

export type Row = { key: string; type: "item"; item: TimelineItem } | { key: string; type: "commits"; commits: CommitItem[] };

/** Groups consecutive commits and drops items that render nothing. */
export function buildRows(items: TimelineItem[], prev: Row[] = []): Row[] {
  const prevRows = new Map(prev.map((r) => [r.key, r]));
  const rows: Row[] = [];
  for (const item of items) {
    if (item.__typename === "PullRequestCommit") {
      const last = rows[rows.length - 1];
      if (last?.type === "commits") last.commits.push(item as CommitItem);
      else rows.push({ key: item.id, type: "commits", commits: [item as CommitItem] });
      continue;
    }
    if (item.__typename === "PullRequestReview" && (item as ReviewItem).state === "PENDING") continue;
    rows.push({ key: item.id, type: "item", item });
  }
  // Keep unchanged rows identical so their memoized components skip rendering.
  return rows.map((r) => {
    const old = prevRows.get(r.key);
    if (r.type === "item") return old?.type === "item" && old.item === r.item ? old : r;
    return old?.type === "commits" && old.commits.length === r.commits.length && old.commits.every((c, i) => c === r.commits[i]) ? old : r;
  });
}

export const TimelineRow = memo(function TimelineRow({ row, actions, threads }: { row: Row; actions: TimelineActions; threads?: ReviewThread[] }) {
  if (row.type === "commits") {
    return (
      <div className="tl-item event">
        <CommitGroup commits={row.commits} pullPath={`/${actions.owner}/${actions.repo}/pull/${actions.number}`} />
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
      <EventRow item={item as EventItem} repo={`${actions.owner}/${actions.repo}`} />
    </div>
  );
});
