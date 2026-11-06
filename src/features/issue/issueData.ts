import { useQuery } from "@tanstack/react-query";
import { gql } from "@/api/client";
import { keys } from "@/api/keys";
import { registerPrefetcher } from "@/api/prefetch";
import { queryClient } from "@/api/queryClient";
import { ISSUE_ONLY_FIELDS, SUBJECT_META_FIELDS, type SubjectMeta } from "@/api/types";
import { prefetchTimeline } from "@/features/conversation/timeline";
import { ISSUE_EXTRA_FIELDS, type IssueExtras } from "@/features/sidebar/data";

export type IssueMeta = SubjectMeta & IssueExtras;

/** What `keys.issue` holds: the issue, or a marker when the number belongs to a PR. */
export type IssueResult = IssueMeta | { __typename: "PullRequest"; number: number };

const ISSUE_META_QUERY = `
  query IssueMeta($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issueOrPullRequest(number: $number) {
        __typename
        ... on Issue { ${SUBJECT_META_FIELDS} ${ISSUE_ONLY_FIELDS} ${ISSUE_EXTRA_FIELDS} }
        ... on PullRequest { number }
      }
    }
  }`;

export async function fetchIssueMeta(owner: string, repo: string, number: number): Promise<IssueResult> {
  const d = await gql<{ repository: { issueOrPullRequest: IssueResult | null } | null }>(ISSUE_META_QUERY, { owner, repo, number });
  if (!d.repository) throw new Error(`Failed to find repository ${owner}/${repo}`);
  if (!d.repository.issueOrPullRequest) throw new Error(`Failed to find issue ${owner}/${repo}#${number}`);
  return d.repository.issueOrPullRequest;
}

export function useIssueMeta(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.issue(owner, repo, number),
    queryFn: () => fetchIssueMeta(owner, repo, number),
  });
}

registerPrefetcher("issue", (owner, repo, number) => {
  queryClient.prefetchQuery({ queryKey: keys.issue(owner, repo, number), queryFn: () => fetchIssueMeta(owner, repo, number), staleTime: 60_000 });
  prefetchTimeline("issue", owner, repo, number);
});
