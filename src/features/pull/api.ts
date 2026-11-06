import { useQuery } from "@tanstack/react-query";
import { GitHubError, gql, gqlAll, rest } from "@/api/client";
import { keys } from "@/api/keys";
import { registerPrefetcher } from "@/api/prefetch";
import { queryClient } from "@/api/queryClient";
import { ACTOR_FIELDS, PULL_ONLY_FIELDS, SUBJECT_META_FIELDS, type Actor, type SubjectMeta } from "@/api/types";

export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type MergeStateStatus = "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE";
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
export type RollupState = "ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS";

export interface CheckRunNode {
  __typename: "CheckRun";
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  url: string;
  isRequired: boolean;
  checkSuite: {
    app: { name: string; slug: string; logoUrl: string } | null;
    workflowRun: { event: string; workflow: { name: string } } | null;
  } | null;
}

export interface StatusContextNode {
  __typename: "StatusContext";
  id: string;
  context: string;
  state: RollupState;
  description: string | null;
  targetUrl: string | null;
  createdAt: string;
  isRequired: boolean;
  avatarUrl: string | null;
}

export type CheckContext = CheckRunNode | StatusContextNode;

export interface CheckRollup {
  state: RollupState;
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
  contexts: CheckContext[];
}

export type Reviewer =
  | ({ __typename: "User" | "Bot"; id: string } & Actor)
  | { __typename: "Team"; id: string; name: string; slug: string; combinedSlug: string; url: string; avatarUrl: string | null }
  | { __typename: "Mannequin"; id: string; login: string; avatarUrl: string; url: string };

export interface Review {
  state: ReviewState;
  submittedAt: string | null;
  author: (Actor & { id?: string }) | null;
}

export interface PullMeta extends SubjectMeta {
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  baseRefOid: string;
  isCrossRepository: boolean;
  headRepository: { id: string; name: string; owner: { login: string } } | null;
  headRef: { id: string } | null;
  commits: { totalCount: number };
  totalCommentsCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  mergeable: Mergeable;
  mergeStateStatus: MergeStateStatus;
  reviewDecision: ReviewDecision;
  viewerCanMergeAsAdmin: boolean;
  mergedAt: string | null;
  mergedBy: Actor | null;
  closedAt: string | null;
  autoMergeRequest: { mergeMethod: MergeMethod; enabledAt: string; enabledBy: Actor | null } | null;
  reviewRequests: { nodes: { requestedReviewer: Reviewer | null }[] };
  latestReviews: { nodes: Review[] };
  latestOpinionatedReviews: { nodes: Review[] };
  mergeSettings: {
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    deleteBranchOnMerge: boolean;
    viewerDefaultMergeMethod: MergeMethod;
  };
  /** Checks and statuses of the head commit; null when there are none or the token can't read them. */
  rollup: CheckRollup | null;
  checksForbidden: boolean;
}

export const CHECK_CONTEXT_FIELDS = `
  __typename
  ... on CheckRun {
    id name status conclusion startedAt completedAt detailsUrl url isRequired(pullRequestNumber: $number)
    checkSuite { app { name slug logoUrl } workflowRun { event workflow { name } } }
  }
  ... on StatusContext { id context state description targetUrl createdAt isRequired(pullRequestNumber: $number) avatarUrl }
`;

const ROLLUP_FIELDS = `
  headCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) {
    totalCount pageInfo { hasNextPage endCursor } nodes { ${CHECK_CONTEXT_FIELDS} }
  } } } } }
`;

export const pullQuery = (withChecks: boolean) => `query PullMeta($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge viewerDefaultMergeMethod
    pullRequest(number: $number) {
      ${SUBJECT_META_FIELDS} ${PULL_ONLY_FIELDS}
      baseRefName headRefName headRefOid baseRefOid isCrossRepository
      headRepository { id name owner { login } }
      headRef { id }
      commits { totalCount }
      totalCommentsCount changedFiles additions deletions mergeable mergeStateStatus reviewDecision viewerCanMergeAsAdmin
      mergedAt mergedBy { ${ACTOR_FIELDS} } closedAt
      autoMergeRequest { mergeMethod enabledAt enabledBy { ${ACTOR_FIELDS} } }
      reviewRequests(first: 100) { nodes { requestedReviewer { __typename
        ... on User { id ${ACTOR_FIELDS} }
        ... on Bot { id ${ACTOR_FIELDS} }
        ... on Mannequin { id ${ACTOR_FIELDS} }
        ... on Team { id name slug combinedSlug url avatarUrl }
      } } }
      latestReviews(first: 100) { nodes { state submittedAt author { ${ACTOR_FIELDS} ... on User { id } } } }
      latestOpinionatedReviews(first: 100, writersOnly: true) { nodes { state submittedAt author { ${ACTOR_FIELDS} } } }
      ${withChecks ? ROLLUP_FIELDS : ""}
    }
  }
}`;

interface RawRollup {
  state: RollupState;
  contexts: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (CheckContext | null)[] };
}

type RawPull = Omit<PullMeta, "mergeSettings" | "rollup" | "checksForbidden"> & {
  headCommit?: { nodes: { commit: { statusCheckRollup: RawRollup | null } }[] };
};

interface RawPullResponse {
  repository: (PullMeta["mergeSettings"] & { pullRequest: RawPull | null }) | null;
}

/** Repos where the token can't read check runs, so later loads skip straight to the query without checks. */
const checksForbiddenRepos = new Set<string>();

function isChecksForbidden(e: unknown): boolean {
  if (!(e instanceof GitHubError) || !e.errors?.length) return false;
  return e.errors.every((err) => {
    const { type, path } = err as { type?: string; path?: unknown[] };
    return (type === "FORBIDDEN" || type === "INSUFFICIENT_SCOPES") && Array.isArray(path) && path.includes("headCommit");
  });
}

export function toRollup(raw: RawRollup | null | undefined): CheckRollup | null {
  if (!raw) return null;
  return {
    state: raw.state,
    totalCount: raw.contexts.totalCount,
    hasNextPage: raw.contexts.pageInfo.hasNextPage,
    endCursor: raw.contexts.pageInfo.endCursor,
    contexts: raw.contexts.nodes.filter((n): n is CheckContext => !!n?.__typename && "id" in n),
  };
}

export async function fetchPull(owner: string, repo: string, number: number): Promise<PullMeta> {
  const repoKey = `${owner}/${repo}`.toLowerCase();
  const vars = { owner, repo, number };
  let checksForbidden = checksForbiddenRepos.has(repoKey);
  let data: RawPullResponse;
  try {
    data = await gql<RawPullResponse>(pullQuery(!checksForbidden), vars);
  } catch (e) {
    if (checksForbidden || !isChecksForbidden(e)) throw e;
    checksForbiddenRepos.add(repoKey);
    checksForbidden = true;
    data = await gql<RawPullResponse>(pullQuery(false), vars);
  }
  const r = data.repository;
  const pr = r?.pullRequest;
  if (!r || !pr) throw new GitHubError(`Failed to find pull request ${owner}/${repo}#${number}`, 404);
  const { headCommit, ...rest } = pr;
  return {
    ...rest,
    mergeSettings: {
      mergeCommitAllowed: r.mergeCommitAllowed,
      squashMergeAllowed: r.squashMergeAllowed,
      rebaseMergeAllowed: r.rebaseMergeAllowed,
      deleteBranchOnMerge: r.deleteBranchOnMerge,
      viewerDefaultMergeMethod: r.viewerDefaultMergeMethod,
    },
    rollup: toRollup(headCommit?.nodes[0]?.commit.statusCheckRollup),
    checksForbidden,
  };
}

export function pullQueryOptions(owner: string, repo: string, number: number) {
  return { queryKey: keys.pull(owner, repo, number), queryFn: () => fetchPull(owner, repo, number) };
}

export function usePull(owner: string, repo: string, number: number) {
  return useQuery(pullQueryOptions(owner, repo, number));
}

registerPrefetcher("pull", (owner, repo, number) => {
  queryClient.prefetchQuery({ ...pullQueryOptions(owner, repo, number), staleTime: 30_000 });
});

/** Updates the cached PR in place, e.g. for optimistic edits. */
export function patchPull(owner: string, repo: string, number: number, patch: Partial<PullMeta>) {
  queryClient.setQueryData<PullMeta>(keys.pull(owner, repo, number), (old) => (old ? { ...old, ...patch } : old));
}

/** Refetches the PR and its timeline after a state change. */
export function refreshPull(owner: string, repo: string, number: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.pull(owner, repo, number) }),
    queryClient.invalidateQueries({ queryKey: keys.timeline(owner, repo, number) }),
  ]);
}

/** Every check and status on a commit, for heads with more than the first page of contexts. */
export async function fetchAllChecks(owner: string, repo: string, number: number, oid: string): Promise<CheckContext[]> {
  const query = `query PullChecks($owner: String!, $repo: String!, $number: Int!, $oid: GitObjectID!, $after: String) {
    repository(owner: $owner, name: $repo) { object(oid: $oid) { ... on Commit { statusCheckRollup { state contexts(first: 100, after: $after) {
      totalCount pageInfo { hasNextPage endCursor } nodes { ${CHECK_CONTEXT_FIELDS} }
    } } } } }
  }`;
  return gqlAll(async (after) => {
    const data = await gql<{ repository: { object: { statusCheckRollup: RawRollup | null } | null } }>(query, { owner, repo, number, oid, after });
    const rollup = data.repository.object?.statusCheckRollup;
    if (!rollup) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    return { nodes: toRollup(rollup)!.contexts, pageInfo: rollup.contexts.pageInfo };
  });
}

// Commits

export interface PullCommit {
  oid: string;
  abbreviatedOid: string;
  messageHeadline: string;
  messageBody: string;
  committedDate: string;
  authoredDate: string;
  url: string;
  parents: { nodes: { oid: string; abbreviatedOid: string }[] };
  authors: { nodes: { name: string | null; email: string | null; user: Actor | null }[] };
  statusCheckRollup?: { state: RollupState } | null;
}

export interface PullCommits {
  /** Head oid and rollup state the list was fetched at. */
  stamp: string;
  commits: PullCommit[];
}

export const commitsQuery = (withStatus: boolean) => `query PullCommits($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
    headRefOid
    commits(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { commit {
      oid abbreviatedOid messageHeadline messageBody committedDate authoredDate url
      parents(first: 2) { nodes { oid abbreviatedOid } }
      authors(first: 3) { nodes { name email user { ${ACTOR_FIELDS} } } }
      ${withStatus ? "statusCheckRollup { state }" : ""}
    } } }
  } }
}`;

function commitsStamp(pull: PullMeta | undefined): string | undefined {
  return pull && `${pull.headRefOid}:${pull.rollup?.state ?? ""}`;
}

export async function fetchCommits(owner: string, repo: string, number: number): Promise<PullCommits> {
  const key = keys.commits(owner, repo, number);
  const pullState = queryClient.getQueryState<PullMeta>(keys.pull(owner, repo, number));
  const cached = queryClient.getQueryData<PullCommits>(key);
  const fresh = pullState?.data && Date.now() - pullState.dataUpdatedAt < 60_000 ? commitsStamp(pullState.data) : undefined;
  if (cached && fresh && cached.stamp === fresh) return cached;

  const withStatus = !checksForbiddenRepos.has(`${owner}/${repo}`.toLowerCase());
  type Page = { repository: { pullRequest: { headRefOid: string; commits: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { commit: PullCommit }[] } } } };
  const load = (status: boolean) =>
    gqlAll(async (after) => {
      const data = await gql<Page>(commitsQuery(status), { owner, repo, number, after });
      const c = data.repository.pullRequest.commits;
      return { nodes: c.nodes.map((n) => n.commit), pageInfo: c.pageInfo };
    });
  let commits: PullCommit[];
  try {
    commits = await load(withStatus);
  } catch (e) {
    if (!withStatus || !(e instanceof GitHubError && e.errors?.length)) throw e;
    commits = await load(false);
  }
  return { stamp: fresh ?? "", commits };
}

export function commitsQueryOptions(owner: string, repo: string, number: number) {
  return { queryKey: keys.commits(owner, repo, number), queryFn: () => fetchCommits(owner, repo, number) };
}

export function prefetchCommits(owner: string, repo: string, number: number) {
  queryClient.prefetchQuery({ ...commitsQueryOptions(owner, repo, number), staleTime: 30_000 });
}

// Mutations

export function updateTitle(pullId: string, title: string) {
  return gql(`mutation UpdatePullTitle($id: ID!, $title: String!) { updatePullRequest(input: { pullRequestId: $id, title: $title }) { clientMutationId } }`, {
    id: pullId,
    title,
  });
}

export function setDraft(pullId: string, draft: boolean) {
  return draft
    ? gql(`mutation ConvertToDraft($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }`, { id: pullId })
    : gql(`mutation MarkReady($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`, { id: pullId });
}

export function mergePull(input: { pullRequestId: string; mergeMethod: MergeMethod; commitHeadline?: string; commitBody?: string; expectedHeadOid: string }) {
  return gql(`mutation MergePull($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }`, { input });
}

export interface MergeMessages {
  MERGE: { headline: string; body: string };
  SQUASH: { headline: string; body: string };
}

export async function fetchMergeMessages(owner: string, repo: string, number: number): Promise<MergeMessages> {
  const data = await gql<{ repository: { pullRequest: Record<string, string> } }>(
    `query MergeMessages($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
      mh: viewerMergeHeadlineText(mergeType: MERGE) mb: viewerMergeBodyText(mergeType: MERGE)
      sh: viewerMergeHeadlineText(mergeType: SQUASH) sb: viewerMergeBodyText(mergeType: SQUASH)
    } } }`,
    { owner, repo, number },
  );
  const p = data.repository.pullRequest;
  return { MERGE: { headline: p.mh, body: p.mb }, SQUASH: { headline: p.sh, body: p.sb } };
}

export function deleteBranch(refId: string) {
  return gql(`mutation DeleteRef($id: ID!) { deleteRef(input: { refId: $id }) { clientMutationId } }`, { id: refId });
}

export function restoreBranch(owner: string, repo: string, branch: string, sha: string) {
  return rest(`/repos/${owner}/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } });
}

export function requestReviews(pullId: string, userIds: string[], teamIds: string[]) {
  return gql(
    `mutation RequestReviews($id: ID!, $users: [ID!], $teams: [ID!]) { requestReviews(input: { pullRequestId: $id, userIds: $users, teamIds: $teams, union: true }) { clientMutationId } }`,
    { id: pullId, users: userIds, teams: teamIds },
  );
}

export function removeReviewRequests(owner: string, repo: string, number: number, logins: string[], teamSlugs: string[]) {
  return rest(`/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, {
    method: "DELETE",
    body: { reviewers: logins, team_reviewers: teamSlugs },
  });
}

// Reviewer candidates

export type Candidate =
  | { kind: "user"; id: string; login: string; name: string | null; avatarUrl: string }
  | { kind: "team"; id: string; slug: string; name: string; combinedSlug: string; avatarUrl: string | null };

/** Users who can be assigned in the repo, plus the owner org's teams when the token can see them. */
export async function fetchReviewerCandidates(owner: string, repo: string): Promise<Candidate[]> {
  type Page = {
    repository: {
      assignableUsers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; login: string; name: string | null; avatarUrl: string }[] };
    };
  };
  const users = gqlAll(async (after) => {
    const data = await gql<Page>(
      `query ReviewerUsers($owner: String!, $repo: String!, $after: String) { repository(owner: $owner, name: $repo) {
        assignableUsers(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id login name avatarUrl(size: 40) } }
      } }`,
      { owner, repo, after },
    );
    return data.repository.assignableUsers;
  });
  const teams = gql<{ repository: { owner: { teams?: { nodes: { id: string; name: string; slug: string; combinedSlug: string; avatarUrl: string | null }[] } } } }>(
    `query ReviewerTeams($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) {
      owner { ... on Organization { teams(first: 100) { nodes { id name slug combinedSlug avatarUrl(size: 40) } } } }
    } }`,
    { owner, repo },
  )
    .then((d) => d.repository.owner.teams?.nodes ?? [])
    .catch(() => []);
  const [u, t] = await Promise.all([users, teams]);
  return [...u.map((x) => ({ kind: "user" as const, ...x })), ...t.map((x) => ({ kind: "team" as const, ...x }))];
}

export function reviewerCandidatesKey(owner: string, repo: string) {
  return ["reviewer-candidates", owner, repo] as const;
}
