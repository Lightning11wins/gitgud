import { useQuery } from "@tanstack/react-query";
import { gql, gqlAll, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import type { SubjectKind } from "@/api/prefetch";
import { ACTOR_FIELDS, type IssueState, type IssueStateReason, type IssueType, type Label, type Milestone, type User } from "@/api/types";

/** A sub-issue or parent issue as shown in the sidebar. */
export interface IssueRef {
  id: string;
  number: number;
  title: string;
  url: string;
  state: IssueState;
  stateReason: IssueStateReason;
  repository: { nameWithOwner: string };
}

/** A pull request linked to an issue, as shown in the sidebar. */
export interface PullRef {
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  repository: { nameWithOwner: string };
}

/** Issue-only sidebar data, fetched with the issue page's metadata. */
export interface IssueExtras {
  comments: { totalCount: number };
  subIssues: { totalCount: number; nodes: IssueRef[] };
  subIssuesSummary: { total: number; completed: number; percentCompleted: number };
  parent: IssueRef | null;
  closedByPullRequestsReferences: { totalCount: number; nodes: PullRef[] };
  participants: { totalCount: number; nodes: User[] };
}

const ISSUE_REF_FIELDS = `id number title url state stateReason repository { nameWithOwner }`;

export const ISSUE_EXTRA_FIELDS = `
  comments { totalCount }
  subIssues(first: 100) { totalCount nodes { ${ISSUE_REF_FIELDS} } }
  subIssuesSummary { total completed percentCompleted }
  parent { ${ISSUE_REF_FIELDS} }
  closedByPullRequestsReferences(first: 10) { totalCount nodes { id number title url state isDraft repository { nameWithOwner } } }
  participants(first: 10) { totalCount nodes { id ${ACTOR_FIELDS} name } }
`;

const LONG = 10 * 60_000;

export function useRepoLabels(owner: string, repo: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.labels(owner, repo),
    enabled,
    staleTime: LONG,
    queryFn: () =>
      gqlAll(async (after) => {
        const d = await gql<{ repository: { labels: { nodes: Label[]; pageInfo: PageInfo } } }>(
          `query RepoLabels($owner: String!, $repo: String!, $after: String) {
            repository(owner: $owner, name: $repo) { labels(first: 100, after: $after, orderBy: { field: NAME, direction: ASC }) { pageInfo { hasNextPage endCursor } nodes { id name color description } } }
          }`,
          { owner, repo, after },
        );
        return d.repository.labels;
      }),
  });
}

export function useAssignableUsers(owner: string, repo: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.assignable(owner, repo),
    enabled,
    staleTime: LONG,
    queryFn: () =>
      gqlAll(async (after) => {
        const d = await gql<{ repository: { assignableUsers: { nodes: User[]; pageInfo: PageInfo } } }>(
          `query AssignableUsers($owner: String!, $repo: String!, $after: String) {
            repository(owner: $owner, name: $repo) { assignableUsers(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id ${ACTOR_FIELDS} name } } }
          }`,
          { owner, repo, after },
        );
        return d.repository.assignableUsers;
      }),
  });
}

export function useMilestones(owner: string, repo: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.milestones(owner, repo),
    enabled,
    staleTime: LONG,
    queryFn: () =>
      gqlAll(async (after) => {
        const d = await gql<{ repository: { milestones: { nodes: Milestone[]; pageInfo: PageInfo } } }>(
          `query RepoMilestones($owner: String!, $repo: String!, $after: String) {
            repository(owner: $owner, name: $repo) {
              milestones(first: 100, after: $after, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { pageInfo { hasNextPage endCursor } nodes { id number title dueOn state } }
            }
          }`,
          { owner, repo, after },
        );
        return d.repository.milestones;
      }),
  });
}

/** Issue types enabled for the repo's organization; empty for user-owned repos. */
export function useIssueTypes(owner: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ["issue-types", owner, repo],
    enabled,
    staleTime: LONG,
    queryFn: async () => {
      const d = await gql<{ repository: { issueTypes: { nodes: IssueType[] } | null } }>(
        `query RepoIssueTypes($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) { issueTypes(first: 50) { nodes { id name color description } } }
        }`,
        { owner, repo },
      );
      return d.repository.issueTypes?.nodes ?? [];
    },
  });
}

export interface SubjectUpdate {
  assigneeIds?: string[];
  labelIds?: string[];
  milestoneId?: string | null;
  issueTypeId?: string | null;
}

export async function updateSubject(kind: SubjectKind, id: string, input: SubjectUpdate) {
  if (kind === "issue") {
    await gql(`mutation UpdateIssueMeta($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }`, { input: { id, ...input } });
  } else {
    await gql(`mutation UpdatePullMeta($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) { pullRequest { id } } }`, {
      input: { pullRequestId: id, ...input },
    });
  }
}

export async function setLocked(id: string, lock: boolean, reason?: string) {
  if (lock)
    await gql(`mutation LockLockable($id: ID!, $reason: LockReason) { lockLockable(input: { lockableId: $id, lockReason: $reason }) { clientMutationId } }`, {
      id,
      reason: reason ?? null,
    });
  else await gql(`mutation UnlockLockable($id: ID!) { unlockLockable(input: { lockableId: $id }) { clientMutationId } }`, { id });
}

/** Resolves `#12`, `12`, `owner/repo#12`, or an issue URL to an issue in or near `owner/repo`. */
export async function findIssue(owner: string, repo: string, text: string): Promise<IssueRef> {
  const t = text.trim();
  const m = /^(?:https:\/\/github\.com\/)?(?:([\w.-]+)\/([\w.-]+)(?:#|\/issues\/))?#?(\d+)$/.exec(t);
  if (!m) throw new Error(`Failed to parse "${t}": use an issue number, owner/repo#123, or an issue URL`);
  const [o, r, n] = [m[1] ?? owner, m[2] ?? repo, Number(m[3])];
  const d = await gql<{ repository: { issue: IssueRef | null } | null }>(
    `query FindIssue($owner: String!, $repo: String!, $n: Int!) { repository(owner: $owner, name: $repo) { issue(number: $n) { ${ISSUE_REF_FIELDS} } } }`,
    { owner: o, repo: r, n },
  );
  if (!d.repository?.issue) throw new Error(`Failed to find issue ${o}/${r}#${n}`);
  return d.repository.issue;
}

export async function addSubIssue(issueId: string, subIssueId: string) {
  await gql(`mutation AddSubIssue($id: ID!, $sub: ID!) { addSubIssue(input: { issueId: $id, subIssueId: $sub }) { issue { id } } }`, { id: issueId, sub: subIssueId });
}

export async function removeSubIssue(issueId: string, subIssueId: string) {
  await gql(`mutation RemoveSubIssue($id: ID!, $sub: ID!) { removeSubIssue(input: { issueId: $id, subIssueId: $sub }) { issue { id } } }`, {
    id: issueId,
    sub: subIssueId,
  });
}
