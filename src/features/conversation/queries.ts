// GraphQL documents for the conversation timeline. Relative `.ts` imports let scripts/check-conversation-queries.ts load this file in Node.
import { ACTOR_FIELDS } from "../../api/types.ts";

export const REACTION_FIELDS = `reactionGroups { content viewerHasReacted reactors { totalCount } }`;

const ISSUE_REF = `__typename number title url state stateReason repository { nameWithOwner }`;

const SUBJECT_REF = `
  __typename
  ... on Issue { ${ISSUE_REF} }
  ... on PullRequest { number title url state isDraft repository { nameWithOwner } }`;

export const ISSUE_COMMENT_FIELDS = `
  id databaseId author { ${ACTOR_FIELDS} } authorAssociation body bodyHTML createdAt lastEditedAt url
  isMinimized minimizedReason viewerCanUpdate viewerCanDelete viewerCanReact viewerCanMinimize viewerDidAuthor
  ${REACTION_FIELDS}`;

const ACTOR = `actor { ${ACTOR_FIELDS} } createdAt`;

/** Events that only need who and when. */
const SIMPLE_EVENTS = [
  "ReopenedEvent",
  "UnlockedEvent",
  "PinnedEvent",
  "UnpinnedEvent",
  "ConvertedToDiscussionEvent",
  "ConvertedNoteToIssueEvent",
  "IssueCommentPinnedEvent",
  "IssueCommentUnpinnedEvent",
  "BlockedByAddedEvent",
  "BlockedByRemovedEvent",
  "BlockingAddedEvent",
  "BlockingRemovedEvent",
  "UserBlockedEvent",
];

/** Project events. Classic tokens need the read:project scope to query them. */
const PROJECT_EVENTS = ["AddedToProjectV2Event", "RemovedFromProjectV2Event", "ProjectV2ItemStatusChangedEvent"];
const PROJECT_ITEM_TYPES = ["ADDED_TO_PROJECT_V2_EVENT", "REMOVED_FROM_PROJECT_V2_EVENT", "PROJECT_V2_ITEM_STATUS_CHANGED_EVENT"];

const SIMPLE_PULL_EVENTS = [
  "ReadyForReviewEvent",
  "ConvertToDraftEvent",
  "HeadRefRestoredEvent",
  "BaseRefForcePushedEvent",
  "AutomaticBaseChangeFailedEvent",
  "AutomaticBaseChangeSucceededEvent",
  "AddedToMergeQueueEvent",
  "RemovedFromMergeQueueEvent",
  "DeployedEvent",
  "DeploymentEnvironmentChangedEvent",
];

const COMMON_ITEMS = `
  __typename
  ... on Node { id }
  ... on IssueComment { ${ISSUE_COMMENT_FIELDS} }
  ... on LabeledEvent { ${ACTOR} label { name color description } }
  ... on UnlabeledEvent { ${ACTOR} label { name color description } }
  ... on AssignedEvent { ${ACTOR} assignee { ... on Actor { ${ACTOR_FIELDS} } } }
  ... on UnassignedEvent { ${ACTOR} assignee { ... on Actor { ${ACTOR_FIELDS} } } }
  ... on MilestonedEvent { ${ACTOR} milestoneTitle }
  ... on DemilestonedEvent { ${ACTOR} milestoneTitle }
  ... on RenamedTitleEvent { ${ACTOR} previousTitle currentTitle }
  ... on ClosedEvent {
    ${ACTOR} stateReason
    closer { __typename ... on Commit { abbreviatedOid url } ... on PullRequest { number title url } }
    duplicateOf { ${SUBJECT_REF} }
  }
  ... on CrossReferencedEvent { ${ACTOR} willCloseTarget isCrossRepository source { ${SUBJECT_REF} } }
  ... on ReferencedEvent { ${ACTOR} isCrossRepository commit { abbreviatedOid messageHeadline url } commitRepository { nameWithOwner } }
  ... on ConnectedEvent { ${ACTOR} source { ${SUBJECT_REF} } subject { ${SUBJECT_REF} } }
  ... on DisconnectedEvent { ${ACTOR} source { ${SUBJECT_REF} } subject { ${SUBJECT_REF} } }
  ... on MarkedAsDuplicateEvent { ${ACTOR} canonical { ${SUBJECT_REF} } duplicate { ${SUBJECT_REF} } }
  ... on UnmarkedAsDuplicateEvent { ${ACTOR} canonical { ${SUBJECT_REF} } duplicate { ${SUBJECT_REF} } }
  ... on SubIssueAddedEvent { ${ACTOR} subIssue { ${ISSUE_REF} } }
  ... on SubIssueRemovedEvent { ${ACTOR} subIssue { ${ISSUE_REF} } }
  ... on ParentIssueAddedEvent { ${ACTOR} parent { ${ISSUE_REF} } }
  ... on ParentIssueRemovedEvent { ${ACTOR} parent { ${ISSUE_REF} } }
  ... on IssueTypeAddedEvent { ${ACTOR} issueType { name color } }
  ... on IssueTypeRemovedEvent { ${ACTOR} issueType { name color } }
  ... on IssueTypeChangedEvent { ${ACTOR} issueType { name color } prevIssueType { name color } }
  ... on LockedEvent { ${ACTOR} lockReason }
  ... on TransferredEvent { ${ACTOR} fromRepository { nameWithOwner } }
  ... on CommentDeletedEvent { ${ACTOR} deletedCommentAuthor { login } }
  ${SIMPLE_EVENTS.map((t) => `... on ${t} { ${ACTOR} }`).join("\n  ")}`;
const PROJECT_ITEMS = PROJECT_EVENTS.map((t) => `... on ${t} { ${ACTOR} }`).join("\n  ");

const PULL_ITEMS = `
  ... on PullRequestReview {
    author { ${ACTOR_FIELDS} } authorAssociation state body bodyHTML createdAt submittedAt lastEditedAt url
    isMinimized minimizedReason viewerCanUpdate viewerCanDelete viewerCanReact
    ${REACTION_FIELDS}
  }
  ... on PullRequestCommit {
    url
    commit { oid abbreviatedOid messageHeadline url authoredDate committedDate author { name avatarUrl(size: 40) user { login } } }
  }
  ... on HeadRefForcePushedEvent { ${ACTOR} beforeCommit { abbreviatedOid url } afterCommit { abbreviatedOid url } ref { name } }
  ... on ReviewRequestedEvent { ${ACTOR} requestedReviewer { __typename ... on Actor { ${ACTOR_FIELDS} } ... on Team { name url } } }
  ... on ReviewRequestRemovedEvent { ${ACTOR} requestedReviewer { __typename ... on Actor { ${ACTOR_FIELDS} } ... on Team { name url } } }
  ... on MergedEvent { ${ACTOR} mergeRefName commit { abbreviatedOid url } }
  ... on HeadRefDeletedEvent { ${ACTOR} headRefName }
  ... on BaseRefDeletedEvent { ${ACTOR} baseRefName }
  ... on BaseRefChangedEvent { ${ACTOR} previousRefName currentRefName }
  ... on AutoMergeEnabledEvent { ${ACTOR} enabler { ${ACTOR_FIELDS} } }
  ... on AutoMergeDisabledEvent { ${ACTOR} disabler { ${ACTOR_FIELDS} } reason }
  ... on AutoSquashEnabledEvent { ${ACTOR} enabler { ${ACTOR_FIELDS} } }
  ... on AutoRebaseEnabledEvent { ${ACTOR} enabler { ${ACTOR_FIELDS} } }
  ... on ReviewDismissedEvent { ${ACTOR} dismissalMessage review { author { login } } }
  ... on PullRequestCommitCommentThread { path commit { abbreviatedOid url } comments { totalCount } }
  ${SIMPLE_PULL_EVENTS.map((t) => `... on ${t} { ${ACTOR} }`).join("\n  ")}`;

/** Timeline item types shown on issues, except project events. Mentions, subscriptions, and classic project events are noise. */
const BASE_ISSUE_ITEM_TYPES = [
  "ISSUE_COMMENT",
  "CROSS_REFERENCED_EVENT",
  "ASSIGNED_EVENT",
  "CLOSED_EVENT",
  "COMMENT_DELETED_EVENT",
  "CONNECTED_EVENT",
  "CONVERTED_NOTE_TO_ISSUE_EVENT",
  "CONVERTED_TO_DISCUSSION_EVENT",
  "DEMILESTONED_EVENT",
  "DISCONNECTED_EVENT",
  "LABELED_EVENT",
  "LOCKED_EVENT",
  "MARKED_AS_DUPLICATE_EVENT",
  "MILESTONED_EVENT",
  "PINNED_EVENT",
  "REFERENCED_EVENT",
  "RENAMED_TITLE_EVENT",
  "REOPENED_EVENT",
  "TRANSFERRED_EVENT",
  "UNASSIGNED_EVENT",
  "UNLABELED_EVENT",
  "UNLOCKED_EVENT",
  "USER_BLOCKED_EVENT",
  "UNMARKED_AS_DUPLICATE_EVENT",
  "UNPINNED_EVENT",
  "ISSUE_COMMENT_PINNED_EVENT",
  "ISSUE_COMMENT_UNPINNED_EVENT",
  "ISSUE_TYPE_ADDED_EVENT",
  "ISSUE_TYPE_REMOVED_EVENT",
  "ISSUE_TYPE_CHANGED_EVENT",
  "SUB_ISSUE_ADDED_EVENT",
  "SUB_ISSUE_REMOVED_EVENT",
  "PARENT_ISSUE_ADDED_EVENT",
  "PARENT_ISSUE_REMOVED_EVENT",
  "BLOCKED_BY_ADDED_EVENT",
  "BLOCKING_ADDED_EVENT",
  "BLOCKED_BY_REMOVED_EVENT",
  "BLOCKING_REMOVED_EVENT",
];

const BASE_PULL_ITEM_TYPES = [
  ...BASE_ISSUE_ITEM_TYPES,
  "PULL_REQUEST_COMMIT",
  "PULL_REQUEST_COMMIT_COMMENT_THREAD",
  "PULL_REQUEST_REVIEW",
  "ADDED_TO_MERGE_QUEUE_EVENT",
  "AUTOMATIC_BASE_CHANGE_FAILED_EVENT",
  "AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT",
  "AUTO_MERGE_DISABLED_EVENT",
  "AUTO_MERGE_ENABLED_EVENT",
  "AUTO_REBASE_ENABLED_EVENT",
  "AUTO_SQUASH_ENABLED_EVENT",
  "BASE_REF_CHANGED_EVENT",
  "BASE_REF_FORCE_PUSHED_EVENT",
  "BASE_REF_DELETED_EVENT",
  "CONVERT_TO_DRAFT_EVENT",
  "DEPLOYED_EVENT",
  "DEPLOYMENT_ENVIRONMENT_CHANGED_EVENT",
  "HEAD_REF_DELETED_EVENT",
  "HEAD_REF_FORCE_PUSHED_EVENT",
  "HEAD_REF_RESTORED_EVENT",
  "MERGED_EVENT",
  "READY_FOR_REVIEW_EVENT",
  "REMOVED_FROM_MERGE_QUEUE_EVENT",
  "REVIEW_DISMISSED_EVENT",
  "REVIEW_REQUESTED_EVENT",
  "REVIEW_REQUEST_REMOVED_EVENT",
];

const PAGE = `pageInfo { hasNextPage endCursor } filteredCount`;
/** Count of all matching items, ignoring the cursor; used to detect deletions on resume. */
const TOTAL = `total: timelineItems(first: 0, itemTypes: $types) @include(if: $withTotal) { filteredCount }`;
/** Count of the item types GitHub can insert before the cursor; see `MOVABLE_TYPENAMES` in timelineMerge.ts. */
const movable = (types: string) => `movable: timelineItems(first: 0, itemTypes: [${types}]) @include(if: $withTotal) { filteredCount }`;

export const ISSUE_ITEM_TYPES = [...BASE_ISSUE_ITEM_TYPES, ...PROJECT_ITEM_TYPES];
export const PULL_ITEM_TYPES = [...BASE_PULL_ITEM_TYPES, ...PROJECT_ITEM_TYPES];
export const ISSUE_ITEM_TYPES_NO_PROJECTS = BASE_ISSUE_ITEM_TYPES;
export const PULL_ITEM_TYPES_NO_PROJECTS = BASE_PULL_ITEM_TYPES;

const issueTimelineQuery = (projects: boolean) => `
  query IssueTimeline($owner: String!, $repo: String!, $number: Int!, $after: String, $skip: Int, $withTotal: Boolean!, $types: [IssueTimelineItemsItemType!]) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        timelineItems(first: 100, after: $after, skip: $skip, itemTypes: $types) { ${PAGE} nodes { ${COMMON_ITEMS} ${projects ? PROJECT_ITEMS : ""} } }
        ${TOTAL}
        ${movable("REFERENCED_EVENT")}
      }
    }
  }`;

const pullTimelineQuery = (projects: boolean) => `
  query PullTimeline($owner: String!, $repo: String!, $number: Int!, $after: String, $skip: Int, $withTotal: Boolean!, $types: [PullRequestTimelineItemsItemType!]) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        timelineItems(first: 100, after: $after, skip: $skip, itemTypes: $types) { ${PAGE} nodes { ${COMMON_ITEMS} ${projects ? PROJECT_ITEMS : ""} ${PULL_ITEMS} } }
        ${TOTAL}
        ${movable("PULL_REQUEST_COMMIT, PULL_REQUEST_COMMIT_COMMENT_THREAD, REFERENCED_EVENT")}
      }
    }
  }`;

export const ISSUE_TIMELINE_QUERY = issueTimelineQuery(true);
export const PULL_TIMELINE_QUERY = pullTimelineQuery(true);
export const ISSUE_TIMELINE_QUERY_NO_PROJECTS = issueTimelineQuery(false);
export const PULL_TIMELINE_QUERY_NO_PROJECTS = pullTimelineQuery(false);

export const SUBJECT_STAMP_QUERY = `
  query SubjectStamp($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issueOrPullRequest(number: $number) { ... on Issue { updatedAt } ... on PullRequest { updatedAt } }
    }
  }`;
