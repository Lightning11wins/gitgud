import { keys } from "@/api/keys";
import { queryClient } from "@/api/queryClient";
import type { ReviewComment, ReviewThread } from "@/api/types";

interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Replaces one thread in the cached thread list; return null from `fn` to remove it. */
export async function patchThread({ owner, repo, number }: PrRef, threadId: string, fn: (t: ReviewThread) => ReviewThread | null) {
  // A fetch already in flight would overwrite this edit with pre-mutation data.
  await queryClient.cancelQueries({ queryKey: keys.reviewThreads(owner, repo, number) });
  queryClient.setQueryData<ReviewThread[]>(keys.reviewThreads(owner, repo, number), (list) => {
    if (!list) return list;
    const out: ReviewThread[] = [];
    for (const t of list) {
      if (t.id !== threadId) out.push(t);
      else {
        const next = fn(t);
        if (next) out.push(next);
      }
    }
    return out;
  });
}

/** Replaces one comment in the cached thread list. */
export function patchComment(pr: PrRef, threadId: string, commentId: string, fn: (c: ReviewComment) => ReviewComment) {
  return patchThread(pr, threadId, (t) => ({
    ...t,
    comments: { ...t.comments, nodes: t.comments.nodes.map((c) => (c.id === commentId ? fn(c) : c)) },
  }));
}
