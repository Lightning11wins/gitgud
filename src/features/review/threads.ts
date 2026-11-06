import { useQuery } from "@tanstack/react-query";
import { gql, gqlAll, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { queryClient } from "@/api/queryClient";
import { REVIEW_COMMENT_FIELDS, REVIEW_THREAD_FIELDS, type ReviewComment, type ReviewThread } from "@/api/types";

const THREADS_QUERY = `
  query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${REVIEW_THREAD_FIELDS} }
        }
      }
    }
  }`;

const THREAD_COMMENTS_QUERY = `
  query ReviewThreadComments($id: ID!, $after: String) {
    node(id: $id) {
      ... on PullRequestReviewThread {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${REVIEW_COMMENT_FIELDS} }
        }
      }
    }
  }`;

type ThreadsData = {
  repository: { pullRequest: { reviewThreads: { pageInfo: PageInfo; nodes: ReviewThread[] } } };
};
type CommentsData = { node: { comments: { pageInfo: PageInfo; nodes: ReviewComment[] } } };

/** Every review thread on a PR, with every comment in each thread. */
export async function fetchReviewThreads(owner: string, repo: string, number: number): Promise<ReviewThread[]> {
  const threads = await gqlAll(async (after) => {
    const d = await gql<ThreadsData>(THREADS_QUERY, { owner, repo, number, after });
    return d.repository.pullRequest.reviewThreads;
  });
  await Promise.all(
    threads
      .filter((t) => t.comments.totalCount > t.comments.nodes.length)
      .map(async (t) => {
        t.comments.nodes = await gqlAll(async (after) => {
          const d = await gql<CommentsData>(THREAD_COMMENTS_QUERY, { id: t.id, after });
          return d.node.comments;
        });
      }),
  );
  return threads;
}

export function prefetchReviewThreads(owner: string, repo: string, number: number) {
  return queryClient.prefetchQuery({ queryKey: keys.reviewThreads(owner, repo, number), queryFn: () => fetchReviewThreads(owner, repo, number), staleTime: 60_000 });
}

export function useReviewThreads(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.reviewThreads(owner, repo, number),
    queryFn: () => fetchReviewThreads(owner, repo, number),
  });
}
