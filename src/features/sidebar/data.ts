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
  issueFieldValues: { nodes: IssueFieldValue[] };
  viewerCanSetFields: boolean | null;
}

export type IssueFieldDataType = "TEXT" | "SINGLE_SELECT" | "MULTI_SELECT" | "DATE" | "NUMBER";

export interface IssueFieldOption {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

/** An organization's issue field, like Priority or Target date. */
export interface IssueField {
  id: string;
  name: string;
  dataType: IssueFieldDataType;
  description: string | null;
  /** Select fields only. */
  options?: IssueFieldOption[];
}

/** An issue's value for one field: `value` for text, number, and date fields, `optionId` or `options` for selects. */
export interface IssueFieldValue {
  __typename: string;
  field: { id: string } | null;
  value?: string | number | null;
  optionId?: string | null;
  name?: string;
  color?: string;
  options?: IssueFieldOption[];
}

const ISSUE_REF_FIELDS = `id number title url state stateReason repository { nameWithOwner }`;

export const ISSUE_EXTRA_FIELDS = `
  comments { totalCount }
  subIssues(first: 100) { totalCount nodes { ${ISSUE_REF_FIELDS} } }
  subIssuesSummary { total completed percentCompleted }
  parent { ${ISSUE_REF_FIELDS} }
  closedByPullRequestsReferences(first: 10) { totalCount nodes { id number title url state isDraft repository { nameWithOwner } } }
  participants(first: 10) { totalCount nodes { id ${ACTOR_FIELDS} name } }
  viewerCanSetFields
  issueFieldValues(first: 50) {
    nodes {
      __typename
      ... on IssueFieldTextValue { field { ... on Node { id } } value }
      ... on IssueFieldNumberValue { field { ... on Node { id } } value }
      ... on IssueFieldDateValue { field { ... on Node { id } } value }
      ... on IssueFieldSingleSelectValue { field { ... on Node { id } } optionId name color }
      ... on IssueFieldMultiSelectValue { field { ... on Node { id } } options { id name color } }
    }
  }
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

/** The repo's issue fields, and the fields pinned to each issue type (`""` for issues without a type), in pin order. */
export interface RepoIssueFields {
  fields: IssueField[];
  pinned: Record<string, string[]>;
}

const FIELD_ID = `... on Node { id }`;

export function useIssueFields(owner: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ["issue-fields", owner, repo],
    enabled,
    staleTime: LONG,
    queryFn: async (): Promise<RepoIssueFields> => {
      type Pins = { id: string }[];
      const d = await gql<{
        repository: {
          issueFields: { nodes: IssueField[] } | null;
          issueTypes: { nodes: { id: string; pinnedFields: Pins | null }[] } | null;
          owner: { pinnedIssueFields?: { nodes: Pins } };
        };
      }>(
        `query RepoIssueFields($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            issueFields(first: 50) {
              nodes {
                ... on IssueFieldCommon { name dataType description }
                ${FIELD_ID}
                ... on IssueFieldSingleSelect { options { id name color description } }
                ... on IssueFieldMultiSelect { options { id name color description } }
              }
            }
            issueTypes(first: 50) { nodes { id pinnedFields { ${FIELD_ID} } } }
            owner { ... on Organization { pinnedIssueFields(first: 50) { nodes { ${FIELD_ID} } } } }
          }
        }`,
        { owner, repo },
      );
      const ids = (pins: Pins | null | undefined) => (pins ?? []).map((f) => f.id);
      const pinned: Record<string, string[]> = { "": ids(d.repository.owner.pinnedIssueFields?.nodes) };
      for (const t of d.repository.issueTypes?.nodes ?? []) pinned[t.id] = ids(t.pinnedFields);
      return { fields: d.repository.issueFields?.nodes ?? [], pinned };
    },
  });
}

/**
 * The fields GitHub shows for an issue: those pinned to its type, then any others with a value.
 * When the token can't see any pins, every field.
 */
export function shownFields({ fields, pinned }: RepoIssueFields, typeId: string | undefined, values: IssueFieldValue[]): IssueField[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const ids = Object.values(pinned).some((p) => p.length > 0) ? (pinned[typeId ?? ""] ?? []) : fields.map((f) => f.id);
  const valued = values.flatMap((v) => (v.field && !ids.includes(v.field.id) ? [v.field.id] : []));
  return [...ids, ...valued].flatMap((id) => byId.get(id) ?? []);
}

/** One field's new value; `delete` clears it. */
export interface IssueFieldInput {
  fieldId: string;
  textValue?: string;
  numberValue?: number;
  dateValue?: string;
  singleSelectOptionId?: string;
  multiSelectOptionIds?: string[];
  delete?: boolean;
}

export async function setIssueFieldValue(issueId: string, input: IssueFieldInput) {
  await gql(`mutation SetIssueFieldValue($input: SetIssueFieldValueInput!) { setIssueFieldValue(input: $input) { issue { id } } }`, {
    input: { issueId, issueFields: [input] },
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
