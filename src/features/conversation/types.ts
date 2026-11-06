import type { Actor, IssueStateReason, ReactionGroup } from "@/api/types";

/** Every timeline node has these; event-specific fields live on the interfaces below. */
export interface ItemBase {
  __typename: string;
  id: string;
  actor?: Actor | null;
  createdAt?: string;
}

export interface SubjectRef {
  __typename: "Issue" | "PullRequest";
  number: number;
  title: string;
  url: string;
  state: string;
  stateReason?: IssueStateReason;
  isDraft?: boolean;
  repository: { nameWithOwner: string };
}

/** Fields a comment card needs; shared by issue comments, reviews, and the subject body. */
export interface CommentLike {
  id: string;
  author: Actor | null;
  authorAssociation?: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  lastEditedAt?: string | null;
  url: string;
  isMinimized?: boolean;
  minimizedReason?: string | null;
  viewerCanUpdate: boolean;
  viewerCanDelete?: boolean;
  viewerCanReact?: boolean;
  reactionGroups: ReactionGroup[];
}

export interface IssueCommentItem extends ItemBase, CommentLike {
  __typename: "IssueComment";
  createdAt: string;
  databaseId: number;
  viewerCanMinimize?: boolean;
  viewerDidAuthor?: boolean;
}

export interface ReviewItem extends ItemBase, CommentLike {
  __typename: "PullRequestReview";
  createdAt: string;
  state: "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
  submittedAt: string | null;
}

export interface CommitItem extends ItemBase {
  __typename: "PullRequestCommit";
  url: string;
  commit: {
    oid: string;
    abbreviatedOid: string;
    messageHeadline: string;
    url: string;
    authoredDate: string;
    committedDate: string;
    author: { name: string | null; avatarUrl: string; user: { login: string } | null } | null;
  };
}

/** Event fields, all optional; each event type fills the ones it has. */
export interface EventItem extends ItemBase {
  label?: { name: string; color: string; description?: string | null };
  assignee?: Actor | null;
  milestoneTitle?: string;
  previousTitle?: string;
  currentTitle?: string;
  stateReason?: IssueStateReason;
  closer?: { __typename: string; abbreviatedOid?: string; url?: string; number?: number; title?: string } | null;
  duplicateOf?: SubjectRef | null;
  willCloseTarget?: boolean;
  isCrossRepository?: boolean;
  source?: SubjectRef | null;
  subject?: SubjectRef | null;
  commit?: { abbreviatedOid: string; messageHeadline?: string; url: string } | null;
  commitRepository?: { nameWithOwner: string };
  canonical?: SubjectRef | null;
  duplicate?: SubjectRef | null;
  subIssue?: SubjectRef | null;
  parent?: SubjectRef | null;
  issueType?: { name: string; color: string } | null;
  prevIssueType?: { name: string; color: string } | null;
  lockReason?: string | null;
  fromRepository?: { nameWithOwner: string } | null;
  deletedCommentAuthor?: { login: string } | null;
  beforeCommit?: { abbreviatedOid: string; url: string } | null;
  afterCommit?: { abbreviatedOid: string; url: string } | null;
  ref?: { name: string } | null;
  requestedReviewer?: { __typename: string; login?: string; avatarUrl?: string; url?: string; name?: string } | null;
  mergeRefName?: string;
  headRefName?: string;
  baseRefName?: string;
  previousRefName?: string;
  currentRefName?: string;
  enabler?: Actor | null;
  disabler?: Actor | null;
  reason?: string | null;
  dismissalMessage?: string | null;
  review?: { author: { login: string } | null } | null;
  path?: string | null;
  comments?: { totalCount: number };
}

export type TimelineItem = IssueCommentItem | ReviewItem | CommitItem | EventItem;

export interface TimelineData {
  /** Subject `updatedAt` when loaded; empty while incomplete. */
  stamp: string;
  items: TimelineItem[];
  endCursor: string | null;
  /** When every item was last fetched from scratch (ms). */
  fullAt: number;
}
