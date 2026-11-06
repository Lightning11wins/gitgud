import type { ReviewThread } from "@/api/types";

export interface ReviewThreadViewProps {
  thread: ReviewThread;
  owner: string;
  repo: string;
  number: number;
  /** Show the diff hunk above the comments (conversation tab). The Files tab already shows code. */
  showHunk?: boolean;
}

export function ReviewThreadView(_props: ReviewThreadViewProps) {
  return <div className="blankslate">ReviewThreadView is not built yet.</div>;
}
