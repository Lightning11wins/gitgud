import { useQuery } from "@tanstack/react-query";
import { GitHubError, gql, gqlPartial } from "@/api/client";
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
  if (!d.repository) throw new GitHubError(`Failed to find repository ${owner}/${repo}`, 404);
  if (!d.repository.issueOrPullRequest) throw new GitHubError(`Failed to find issue ${owner}/${repo}#${number}`, 404);
  return d.repository.issueOrPullRequest;
}

/** Loads several issues' metadata in one request, for warming the cache. Issues that fail to load are left out. */
export async function fetchIssuesBatch(refs: { owner: string; repo: string; number: number }[]): Promise<{ ref: (typeof refs)[number]; issue: IssueResult }[]> {
  if (!refs.length) return [];
  const params = refs.map((_, i) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`).join(", ");
  const parts = refs.map(
    (_, i) => `i${i}: repository(owner: $o${i}, name: $r${i}) { issueOrPullRequest(number: $n${i}) {
      __typename
      ... on Issue { ${SUBJECT_META_FIELDS} ${ISSUE_ONLY_FIELDS} ${ISSUE_EXTRA_FIELDS} }
      ... on PullRequest { number }
    } }`,
  );
  const vars = Object.fromEntries(refs.flatMap((r, i) => [[`o${i}`, r.owner], [`r${i}`, r.repo], [`n${i}`, r.number]]));
  const { data, errors } = await gqlPartial<Record<string, { issueOrPullRequest: IssueResult | null } | null>>(
    `query IssueMetaBatch(${params}) {\n${parts.join("\n")}\n}`,
    vars,
  );
  const failed = new Set(errors.map((e) => e.path?.[0]));
  return refs.flatMap((ref, i) => {
    const issue = data[`i${i}`]?.issueOrPullRequest;
    return issue && !failed.has(`i${i}`) ? [{ ref, issue }] : [];
  });
}

export function useIssueMeta(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: keys.issue(owner, repo, number),
    queryFn: () => fetchIssueMeta(owner, repo, number),
  });
}

registerPrefetcher("issue", (owner, repo, number) =>
  Promise.all([
    queryClient.prefetchQuery({ queryKey: keys.issue(owner, repo, number), queryFn: () => fetchIssueMeta(owner, repo, number), staleTime: 60_000 }),
    prefetchTimeline("issue", owner, repo, number),
  ]),
);
