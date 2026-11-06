import { useQuery } from "@tanstack/react-query";
import { gql, rest } from "@/api/client";
import { keys } from "@/api/keys";
import { queryClient } from "@/api/queryClient";
import type { ReviewComment, ReviewThread } from "@/api/types";

/** The viewer's unsubmitted review on a PR, visible and submittable on github.com too. */
export interface PendingReview {
  id: string;
  body: string;
  comments: { totalCount: number };
}

/** Everything the review UI needs about the viewer's relationship to a PR, fetched in one request. */
export interface PendingState {
  pullId: string;
  headRefOid: string;
  /** The viewer authored the PR, so GitHub rejects Approve and Request changes. */
  viewerDidAuthor: boolean;
  review: PendingReview | null;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
export type DiffSide = "LEFT" | "RIGHT";

const PENDING_QUERY = `
  query PendingReview($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id headRefOid viewerDidAuthor
        reviews(states: PENDING, first: 20) { nodes { id body viewerDidAuthor comments { totalCount } } }
      }
    }
  }`;

type PendingData = {
  repository: {
    pullRequest: {
      id: string;
      headRefOid: string;
      viewerDidAuthor: boolean;
      reviews: { nodes: (PendingReview & { viewerDidAuthor: boolean })[] };
    };
  };
};

export async function fetchPendingState(owner: string, repo: string, number: number): Promise<PendingState> {
  const pr = (await gql<PendingData>(PENDING_QUERY, { owner, repo, number })).repository.pullRequest;
  const mine = pr.reviews.nodes.find((r) => r.viewerDidAuthor);
  return {
    pullId: pr.id,
    headRefOid: pr.headRefOid,
    viewerDidAuthor: pr.viewerDidAuthor,
    review: mine ? { id: mine.id, body: mine.body, comments: mine.comments } : null,
  };
}

// Several components observe this query and mount at different times; a short staleTime
// keeps each mount from refetching. Mutations here invalidate it explicitly.
const PENDING_STALE_MS = 10_000;

export function usePendingState(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.pendingReview(owner, repo, number),
    queryFn: () => fetchPendingState(owner, repo, number),
    staleTime: PENDING_STALE_MS,
  });
}

/** The viewer's pending review, or null when there is none. */
export function usePendingReview(owner: string, repo: string, number: number, enabled = true) {
  return useQuery({
    queryKey: keys.pendingReview(owner, repo, number),
    queryFn: () => fetchPendingState(owner, repo, number),
    select: selectReview,
    staleTime: PENDING_STALE_MS,
    enabled,
  });
}

const selectReview = (s: PendingState) => s.review;

/** Pending state from the cache when under `staleTime` ms old, else fetched. */
function pendingState(owner: string, repo: string, number: number, staleTime = 30_000): Promise<PendingState> {
  return queryClient.fetchQuery({
    queryKey: keys.pendingReview(owner, repo, number),
    queryFn: () => fetchPendingState(owner, repo, number),
    staleTime,
  });
}

type ReviewKey = "reviewThreads" | "pendingReview" | "timeline" | "pull";

/** Invalidates the given per-PR queries (all of them by default). */
export function invalidateReview(owner: string, repo: string, number: number, which: ReviewKey[] = ["reviewThreads", "pendingReview", "timeline", "pull"]) {
  return Promise.all(which.map((k) => queryClient.invalidateQueries({ queryKey: keys[k](owner, repo, number) })));
}

export interface NewThreadInput {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
  /** Commit the line numbers refer to; defaults to the PR head. */
  commitId?: string;
  path: string;
  body: string;
  subjectType: "LINE" | "FILE";
  line?: number;
  side?: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
}

/**
 * Posts a new thread immediately. GitHub rejects this while the viewer has a pending
 * review on the PR ("one pending review per pull request"), so callers offer only
 * {@link addReviewComment} then.
 */
export async function addSingleComment(input: NewThreadInput): Promise<void> {
  const { owner, repo, number } = input;
  const { headRefOid, review } = await pendingState(owner, repo, number);
  if (review) throw new Error(`Failed to add a single comment to ${owner}/${repo}#${number}: you have a pending review, so add it to the review`);
  const multi = input.subjectType === "LINE" && input.startLine != null && input.startLine !== input.line;
  await rest(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
    method: "POST",
    body: {
      body: input.body,
      commit_id: input.commitId ?? headRefOid,
      path: input.path,
      // REST rejects subject_type alongside line.
      ...(input.subjectType === "FILE" ? { subject_type: "file" } : { line: input.line, side: input.side ?? "RIGHT" }),
      ...(multi && { start_line: input.startLine, start_side: input.startSide ?? input.side ?? "RIGHT" }),
    },
  });
  await invalidateReview(owner, repo, number, ["reviewThreads", "timeline"]);
}

const ADD_REVIEW = `
  mutation AddPendingReview($pullId: ID!, $commitOID: GitObjectID) {
    addPullRequestReview(input: { pullRequestId: $pullId, commitOID: $commitOID }) { pullRequestReview { id body comments { totalCount } } }
  }`;

const ADD_THREAD = `
  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {
    addPullRequestReviewThread(input: $input) { thread { id } }
  }`;

// Pending review creations in flight, so concurrent comments share one review.
const creating = new Map<string, Promise<string>>();

/** Returns the viewer's pending review id, creating an empty pending review (at `commitId`, default head) when none exists. */
export function ensurePendingReview(owner: string, repo: string, number: number, pullId: string, commitId?: string): Promise<string> {
  const key = `${owner}/${repo}#${number}`;
  let p = creating.get(key);
  if (!p) {
    p = startPendingReview(owner, repo, number, pullId, commitId).finally(() => creating.delete(key));
    creating.set(key, p);
  }
  return p;
}

async function startPendingReview(owner: string, repo: string, number: number, pullId: string, commitId?: string): Promise<string> {
  let state = await pendingState(owner, repo, number);
  // Recheck before creating: a review started on github.com may not be cached yet.
  if (!state.review) state = await pendingState(owner, repo, number, 0);
  if (state.review) return state.review.id;
  const d = await gql<{ addPullRequestReview: { pullRequestReview: PendingReview } }>(ADD_REVIEW, { pullId, commitOID: commitId ?? null });
  const review = d.addPullRequestReview.pullRequestReview;
  queryClient.setQueryData<PendingState>(keys.pendingReview(owner, repo, number), (s) => (s ? { ...s, review } : s));
  return review.id;
}

/** Adds a thread to the viewer's pending review, starting one if needed. */
export async function addReviewComment(input: NewThreadInput): Promise<void> {
  const { owner, repo, number } = input;
  const reviewId = await ensurePendingReview(owner, repo, number, input.pullId, input.commitId);
  const multi = input.subjectType === "LINE" && input.startLine != null && input.startLine !== input.line;
  await gql(ADD_THREAD, {
    input: {
      pullRequestReviewId: reviewId,
      path: input.path,
      body: input.body,
      subjectType: input.subjectType,
      ...(input.subjectType === "LINE" && { line: input.line, side: input.side ?? "RIGHT" }),
      ...(multi && { startLine: input.startLine, startSide: input.startSide ?? input.side ?? "RIGHT" }),
    },
  });
  await invalidateReview(owner, repo, number, ["reviewThreads", "pendingReview", "timeline"]);
}

export interface SubmitReviewInput {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
  event: ReviewEvent;
  body: string;
  /** The pending review to submit; without it a new review is created and submitted at once. */
  pendingId?: string | null;
}

const SUBMIT_PENDING = `
  mutation SubmitReview($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
    submitPullRequestReview(input: { pullRequestReviewId: $id, event: $event, body: $body }) { pullRequestReview { id } }
  }`;

const ADD_SUBMITTED = `
  mutation AddReview($pullId: ID!, $event: PullRequestReviewEvent!, $body: String) {
    addPullRequestReview(input: { pullRequestId: $pullId, event: $event, body: $body }) { pullRequestReview { id } }
  }`;

export async function submitReview({ owner, repo, number, pullId, event, body, pendingId }: SubmitReviewInput): Promise<void> {
  if (pendingId) await gql(SUBMIT_PENDING, { id: pendingId, event, body });
  else await gql(ADD_SUBMITTED, { pullId, event, body });
  await settlePending(owner, repo, number, (c) => ({ ...c, state: "SUBMITTED" }));
}

const DELETE_REVIEW = `
  mutation DiscardReview($id: ID!) { deletePullRequestReview(input: { pullRequestReviewId: $id }) { clientMutationId } }`;

/** Deletes the pending review and every comment in it. */
export async function discardPendingReview(owner: string, repo: string, number: number, reviewId: string): Promise<void> {
  await gql(DELETE_REVIEW, { id: reviewId });
  await settlePending(owner, repo, number, () => null);
}

/**
 * Applies a submit or discard to the cached pending comments, then refetches later:
 * GitHub's reads lag these mutations by a moment and would bring back stale pending threads.
 */
async function settlePending(owner: string, repo: string, number: number, fn: (c: ReviewComment) => ReviewComment | null) {
  // A fetch already in flight would overwrite these edits with pre-mutation data.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: keys.pendingReview(owner, repo, number) }),
    queryClient.cancelQueries({ queryKey: keys.reviewThreads(owner, repo, number) }),
  ]);
  queryClient.setQueryData<PendingState>(keys.pendingReview(owner, repo, number), (s) => (s ? { ...s, review: null } : s));
  queryClient.setQueryData<ReviewThread[]>(keys.reviewThreads(owner, repo, number), (list) =>
    list
      ?.map((t) => {
        if (!t.comments.nodes.some((c) => c.state === "PENDING")) return t;
        const nodes = t.comments.nodes.flatMap((c) => (c.state === "PENDING" ? (fn(c) ?? []) : [c]));
        return { ...t, comments: { totalCount: t.comments.totalCount - (t.comments.nodes.length - nodes.length), nodes } };
      })
      .filter((t) => t.comments.nodes.length > 0),
  );
  setTimeout(() => invalidateReview(owner, repo, number), SETTLE_MS);
}

const SETTLE_MS = 1500;
