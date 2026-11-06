import { CheckIcon, EyeIcon, FileDiffIcon, XIcon } from "@primer/octicons-react";
import { memo } from "react";
import type { ReviewThread } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { RelativeTime } from "@/components/RelativeTime";
import { ReviewThreadView } from "@/features/review/ReviewThread";
import { CommentCard } from "./CommentCard";
import type { TimelineActions } from "./TimelineRow";
import type { ReviewItem as Review } from "./types";

const STATE: Record<Review["state"], { verb: string; tone: string; Icon: typeof CheckIcon }> = {
  APPROVED: { verb: "approved these changes", tone: "success-solid", Icon: CheckIcon },
  CHANGES_REQUESTED: { verb: "requested changes", tone: "danger-solid", Icon: FileDiffIcon },
  COMMENTED: { verb: "reviewed", tone: "", Icon: EyeIcon },
  DISMISSED: { verb: "left a review that was dismissed", tone: "", Icon: XIcon },
  PENDING: { verb: "started a review", tone: "", Icon: EyeIcon },
};

/** A submitted review: state line, optional body, then the threads it started. */
export const ReviewItemView = memo(function ReviewItemView({ review, threads, actions }: { review: Review; threads: ReviewThread[] | undefined; actions: TimelineActions }) {
  const { owner, repo, number } = actions;
  const s = STATE[review.state] ?? STATE.COMMENTED;
  const login = review.author?.login ?? "ghost";
  const hasBody = review.body.trim().length > 0;
  return (
    <div className="tl-review">
      <div className="tl-event">
        <span className={`tl-badge ${s.tone}`}>
          <s.Icon size={14} />
        </span>
        <div className="tl-event-body">
          <div className="tl-event-line">
            <Avatar src={review.author?.avatarUrl} size={16} login={login} />{" "}
            <a className="event-actor" href={review.author?.url} target="_blank" rel="noopener noreferrer">
              {login}
            </a>{" "}
            {s.verb}{" "}
            <a className="muted" href={review.url} target="_blank" rel="noopener noreferrer">
              <RelativeTime date={review.submittedAt ?? review.createdAt} />
            </a>
          </div>
        </div>
      </div>
      {(hasBody || (threads && threads.length > 0)) && (
        <div className="tl-review-content">
          {hasBody && (
            <CommentCard
              comment={review}
              owner={owner}
              repo={repo}
              draftKey={`${owner}/${repo}#${number}:edit:${review.id}`}
              githubUrl={actions.githubUrl}
              anchor={`pullrequestreview-${review.url.split("pullrequestreview-")[1] ?? review.id}`}
              isSubjectAuthor={review.author?.login === actions.subjectAuthor}
              onSave={(body) => actions.saveReview(review.id, body)}
              onReact={(content, add) => actions.react(review.id, content, add)}
              onQuote={actions.quote}
            />
          )}
          {threads?.map((t) => (
            <div key={t.id} className="tl-review-thread">
              <ReviewThreadView thread={t} owner={owner} repo={repo} number={number} showHunk />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
