import { TriangleDownIcon } from "@primer/octicons-react";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Popover } from "@/components/Popover";
import { Composer } from "@/features/composer/Composer";
import { discardPendingReview, submitReview, usePendingState, type ReviewEvent } from "./pending";
import "./review.css";

export interface ReviewSubmitButtonProps {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
}

/** "Review changes" button, or "Finish your review" with a count while a pending review exists. */
export function ReviewSubmitButton({ owner, repo, number, pullId }: ReviewSubmitButtonProps) {
  const { data: state } = usePendingState(owner, repo, number);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const review = state?.review ?? null;
  const count = review?.comments.totalCount ?? 0;

  return (
    <>
      <button
        className={`btn sm review-submit-btn${review ? " primary" : ""}`}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {review ? "Finish your review" : "Review changes"}
        {review && <span className="counter">{count}</span>}
        <TriangleDownIcon size={14} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" width={400}>
          <ReviewForm
            owner={owner}
            repo={repo}
            number={number}
            pullId={pullId}
            pendingId={review?.id ?? null}
            pendingBody={review?.body ?? ""}
            count={count}
            viewerDidAuthor={state?.viewerDidAuthor ?? false}
            onDone={() => setAnchor(null)}
          />
        </Popover>
      )}
    </>
  );
}

interface ReviewFormProps {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
  pendingId: string | null;
  pendingBody: string;
  count: number;
  viewerDidAuthor: boolean;
  onDone: () => void;
}

const OPTIONS: { event: ReviewEvent; title: string; hint: string }[] = [
  { event: "COMMENT", title: "Comment", hint: "Submit general feedback without explicit approval." },
  { event: "APPROVE", title: "Approve", hint: "Give your approval to merge these changes." },
  { event: "REQUEST_CHANGES", title: "Request changes", hint: "Submit feedback that must be addressed before merging." },
];

function ReviewForm({ owner, repo, number, pullId, pendingId, pendingBody, count, viewerDidAuthor, onDone }: ReviewFormProps) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (body: string) => {
    await submitReview({ owner, repo, number, pullId, event, body, pendingId });
    onDone();
  };

  const discard = async () => {
    if (!pendingId || !confirm(`Discard your pending review${count ? ` and its ${count} comment${count === 1 ? "" : "s"}` : ""}?`)) return;
    setDiscarding(true);
    setError(null);
    try {
      await discardPendingReview(owner, repo, number, pendingId);
      onDone();
    } catch (e) {
      setError(e);
      setDiscarding(false);
    }
  };

  return (
    <div className="review-submit">
      <h3>Finish your review</h3>
      <div className="review-submit-options">
        {OPTIONS.map((o) => {
          const disabled = viewerDidAuthor && o.event !== "COMMENT";
          return (
            <label key={o.event} className={`review-submit-option${disabled ? " disabled" : ""}`}>
              <input type="radio" name="review-event" checked={event === o.event} disabled={disabled} onChange={() => setEvent(o.event)} />
              <span>
                <strong>{o.title}</strong>
                <small>{disabled ? `Pull request authors can't ${o.event === "APPROVE" ? "approve" : "request changes on"} their own pull request.` : o.hint}</small>
              </span>
            </label>
          );
        })}
      </div>
      <Composer
        draftKey={`${owner}/${repo}#${number}:review`}
        owner={owner}
        repo={repo}
        initialValue={pendingBody}
        placeholder="Leave a comment"
        submitLabel="Submit review"
        autoFocus
        minRows={4}
        allowEmpty={event === "APPROVE" || count > 0}
        githubUrl={`https://github.com/${owner}/${repo}/pull/${number}`}
        onSubmit={submit}
      />
      {error != null && <ErrorBanner error={error} />}
      {pendingId && (
        <div className="review-submit-pending">
          <span className="muted grow">
            {count} pending comment{count === 1 ? "" : "s"}
          </span>
          <button className="btn sm danger" onClick={discard} disabled={discarding}>
            Discard pending review
          </button>
        </div>
      )}
    </div>
  );
}
