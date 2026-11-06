/** Shared GraphQL shapes used across features. Feature-specific shapes live with each feature. */

export interface Actor {
  /** "User", "Bot", "Mannequin", or "Organization". */
  __typename?: string;
  login: string;
  avatarUrl: string;
  url: string;
}

export interface User extends Actor {
  id: string;
  name?: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

export interface Milestone {
  id: string;
  number: number;
  title: string;
  dueOn?: string | null;
  state?: "OPEN" | "CLOSED";
}

export interface IssueType {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

export type ReactionContent =
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "LAUGH"
  | "HOORAY"
  | "CONFUSED"
  | "HEART"
  | "ROCKET"
  | "EYES";

export interface ReactionGroup {
  content: ReactionContent;
  viewerHasReacted: boolean;
  reactors: { totalCount: number };
}

export type IssueState = "OPEN" | "CLOSED";
export type IssueStateReason = "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED" | null;
export type PullState = "OPEN" | "CLOSED" | "MERGED";

/** Fields shared by issues and PRs: everything the header and metadata sidebar need. */
export interface SubjectMeta {
  __typename: "Issue" | "PullRequest";
  id: string;
  number: number;
  title: string;
  url: string;
  state: IssueState | PullState;
  createdAt: string;
  updatedAt: string;
  author: Actor | null;
  authorAssociation: string;
  body: string;
  bodyHTML: string;
  lastEditedAt: string | null;
  viewerCanUpdate: boolean;
  viewerDidAuthor: boolean;
  locked: boolean;
  labels: { nodes: Label[] };
  assignees: { nodes: User[] };
  milestone: Milestone | null;
  reactionGroups: ReactionGroup[];
  repository: { id: string; nameWithOwner: string; viewerPermission: RepoPermission | null };
  /** Issues only. */
  stateReason?: IssueStateReason;
  issueType?: IssueType | null;
  /** PRs only. */
  isDraft?: boolean;
  merged?: boolean;
}

export type RepoPermission = "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE" | "READ";

export const ACTOR_FIELDS = `__typename login avatarUrl(size: 80) url`;

export const isBot = (a: { __typename?: string } | null | undefined) => a?.__typename === "Bot";

/** Selection set valid on both Issue and PullRequest, producing {@link SubjectMeta}. */
export const SUBJECT_META_FIELDS = `
  __typename id number title url state createdAt updatedAt body bodyHTML lastEditedAt
  viewerCanUpdate viewerDidAuthor locked
  author { ${ACTOR_FIELDS} } authorAssociation
  labels(first: 100) { nodes { id name color description } }
  assignees(first: 50) { nodes { id ${ACTOR_FIELDS} name } }
  milestone { id number title dueOn state }
  reactionGroups { content viewerHasReacted reactors { totalCount } }
  repository { id nameWithOwner viewerPermission }
`;

export const ISSUE_ONLY_FIELDS = `stateReason issueType { id name color description }`;
export const PULL_ONLY_FIELDS = `isDraft merged`;

export function canWrite(perm: RepoPermission | null | undefined): boolean {
  return perm === "ADMIN" || perm === "MAINTAIN" || perm === "WRITE";
}

export function canTriage(perm: RepoPermission | null | undefined): boolean {
  return canWrite(perm) || perm === "TRIAGE";
}

/**
 * A review thread on a PR diff, shared by the conversation timeline and the Files tab.
 * Query with {@link REVIEW_THREAD_FIELDS}.
 */
export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  startDiffSide: "LEFT" | "RIGHT" | null;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  subjectType: "LINE" | "FILE";
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  viewerCanReply: boolean;
  resolvedBy: Actor | null;
  comments: { totalCount: number; nodes: ReviewComment[] };
}

export interface ReviewComment {
  id: string;
  databaseId: number;
  author: Actor | null;
  authorAssociation: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  lastEditedAt: string | null;
  url: string;
  diffHunk: string;
  state: "PENDING" | "SUBMITTED";
  isMinimized: boolean;
  minimizedReason: string | null;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  viewerCanReact: boolean;
  reactionGroups: ReactionGroup[];
  pullRequestReview: { id: string; state: string } | null;
  replyTo: { id: string } | null;
}

export const REVIEW_COMMENT_FIELDS = `
  id databaseId author { ${ACTOR_FIELDS} } authorAssociation body bodyHTML createdAt lastEditedAt url
  diffHunk state isMinimized minimizedReason viewerCanUpdate viewerCanDelete viewerCanReact
  reactionGroups { content viewerHasReacted reactors { totalCount } }
  pullRequestReview { id state }
  replyTo { id }
`;

export const REVIEW_THREAD_FIELDS = `
  id path line originalLine startLine originalStartLine diffSide startDiffSide
  isResolved isOutdated isCollapsed subjectType viewerCanResolve viewerCanUnresolve viewerCanReply
  resolvedBy { ${ACTOR_FIELDS} }
  comments(first: 100) { totalCount nodes { ${REVIEW_COMMENT_FIELDS} } }
`;
