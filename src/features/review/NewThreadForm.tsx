import { Composer } from "@/features/composer/Composer";
import { addReviewComment, addSingleComment, usePendingReview, type DiffSide, type NewThreadInput } from "./pending";
import "./review.css";

export interface NewThreadFormProps {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
  path: string;
  subjectType: "LINE" | "FILE";
  line?: number;
  side?: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
  /** Original code of the selected lines, for the suggestion button. */
  suggestionSource?: string;
  onClose: () => void;
}

/**
 * Comment form for a new review thread. Offers "Add single comment" and "Start a review",
 * or only "Add review comment" while the viewer has a pending review (GitHub rejects
 * single comments then).
 */
export function NewThreadForm(props: NewThreadFormProps) {
  const { owner, repo, number, pullId, path, subjectType, line, side, startLine, startSide, suggestionSource, onClose } = props;
  const pending = usePendingReview(owner, repo, number);
  const hasPending = !!pending.data;
  const input = (body: string): NewThreadInput => ({ owner, repo, number, pullId, path, body, subjectType, line, side, startLine, startSide });
  const draftKey = `${owner}/${repo}#${number}:new:${path}:${side ?? ""}:${startLine ?? ""}-${line ?? "file"}`;

  const review = async (body: string) => {
    await addReviewComment(input(body));
    onClose();
  };
  const single = async (body: string) => {
    await addSingleComment(input(body));
    onClose();
  };

  return (
    <div className="new-thread">
      <Composer
        draftKey={draftKey}
        owner={owner}
        repo={repo}
        placeholder="Leave a comment"
        githubUrl={`https://github.com/${owner}/${repo}/pull/${number}`}
        autoFocus
        minRows={3}
        suggestionSource={suggestionSource}
        submitLabel={hasPending ? "Add review comment" : "Start a review"}
        onSubmit={review}
        onCancel={onClose}
        actions={
          hasPending || pending.isLoading
            ? undefined
            : ({ run, submitting, value }) => (
                <button className="btn" disabled={submitting || !value.trim()} onClick={() => run(single)}>
                  Add single comment
                </button>
              )
        }
      />
    </div>
  );
}
