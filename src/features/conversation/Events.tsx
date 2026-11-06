import {
  BookmarkIcon,
  CommentDiscussionIcon,
  CrossReferenceIcon,
  DotFillIcon,
  DuplicateIcon,
  EyeIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueReopenedIcon,
  IssueTrackedByIcon,
  IssueTracksIcon,
  LinkIcon,
  LockIcon,
  MilestoneIcon,
  PencilIcon,
  PersonIcon,
  PinIcon,
  ProjectIcon,
  RepoPushIcon,
  RocketIcon,
  SkipIcon,
  TagIcon,
  TrashIcon,
  UnlockIcon,
  XCircleIcon,
  type Icon,
} from "@primer/octicons-react";
import { memo, type ReactNode } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/Avatar";
import { IssueLabel } from "@/components/IssueLabel";
import { RelativeTime } from "@/components/RelativeTime";
import { StateIcon } from "@/components/StateBadge";
import type { CommitItem, EventItem, SubjectRef } from "./types";

function SubjectLink({ s, repo }: { s: SubjectRef | null | undefined; repo: string }) {
  if (!s) return <span className="muted">a deleted item</span>;
  const [o, r] = s.repository.nameWithOwner.split("/");
  const kind = s.__typename === "PullRequest" ? "pull" : "issues";
  const prefix = s.repository.nameWithOwner === repo ? "" : s.repository.nameWithOwner;
  return (
    <span className="event-ref">
      <StateIcon kind={kind === "pull" ? "pull" : "issue"} state={s.state} stateReason={s.stateReason} isDraft={s.isDraft} size={14} />{" "}
      <Link to={`/${o}/${r}/${kind}/${s.number}`}>
        <strong>{s.title}</strong> <span className="muted">{prefix}#{s.number}</span>
      </Link>
    </span>
  );
}

function ActorName({ a }: { a: { login: string; avatarUrl?: string; url?: string } | null | undefined }) {
  if (!a) return <strong>ghost</strong>;
  return (
    <>
      {a.avatarUrl && <Avatar src={a.avatarUrl} size={16} login={a.login} />}{" "}
      <a className="event-actor" href={a.url} target="_blank" rel="noopener noreferrer">
        {a.login}
      </a>
    </>
  );
}

function Row({ icon: I, tone, children, item, block }: { icon: Icon; tone?: string; children: ReactNode; item: EventItem; block?: ReactNode }) {
  return (
    <div className="tl-event">
      <span className={`tl-badge ${tone ?? ""}`}>
        <I size={14} />
      </span>
      <div className="tl-event-body">
        <div className="tl-event-line">
          {item.actor !== undefined && <ActorName a={item.actor} />} {children}
          {item.createdAt && (
            <span className="muted">
              {" "}
              <RelativeTime date={item.createdAt} />
            </span>
          )}
        </div>
        {block}
      </div>
    </div>
  );
}

function reviewerName(r: EventItem["requestedReviewer"]) {
  if (!r) return <strong>someone</strong>;
  if (r.__typename === "Team") return <strong>{r.name}</strong>;
  return <ActorName a={{ login: r.login ?? "ghost", avatarUrl: r.avatarUrl, url: r.url }} />;
}

function humanize(typename: string) {
  return typename
    .replace(/Event$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const CLOSE_REASON: Record<string, string> = { COMPLETED: "as completed", NOT_PLANNED: "as not planned", DUPLICATE: "as a duplicate" };

/** One-line timeline event. Unknown types fall back to a generic row. */
export const EventRow = memo(function EventRow({ item, repo }: { item: EventItem; repo: string }) {
  const e = item;
  switch (e.__typename) {
    case "LabeledEvent":
    case "UnlabeledEvent":
      return (
        <Row icon={TagIcon} item={e}>
          {e.__typename === "LabeledEvent" ? "added" : "removed"} {e.label && <IssueLabel label={e.label} />} label
        </Row>
      );
    case "AssignedEvent":
    case "UnassignedEvent": {
      const self = e.assignee?.login === e.actor?.login;
      const verb = e.__typename === "AssignedEvent" ? "assigned" : "unassigned";
      return (
        <Row icon={PersonIcon} item={e}>
          {self ? `self-${verb} this` : <>{verb} <ActorName a={e.assignee} /></>}
        </Row>
      );
    }
    case "MilestonedEvent":
      return (
        <Row icon={MilestoneIcon} item={e}>
          added this to the <strong>{e.milestoneTitle}</strong> milestone
        </Row>
      );
    case "DemilestonedEvent":
      return (
        <Row icon={MilestoneIcon} item={e}>
          removed this from the <strong>{e.milestoneTitle}</strong> milestone
        </Row>
      );
    case "RenamedTitleEvent":
      return (
        <Row icon={PencilIcon} item={e}>
          changed the title <del className="muted">{e.previousTitle}</del> <strong>{e.currentTitle}</strong>
        </Row>
      );
    case "ClosedEvent": {
      const notPlanned = e.stateReason === "NOT_PLANNED" || e.stateReason === "DUPLICATE";
      return (
        <Row icon={notPlanned ? SkipIcon : IssueClosedIcon} tone={notPlanned ? "neutral" : "done"} item={e}>
          closed this {e.stateReason ? CLOSE_REASON[e.stateReason] ?? "" : ""}
          {e.duplicateOf && (
            <>
              {" "}
              of <SubjectLink s={e.duplicateOf} repo={repo} />
            </>
          )}
          {e.closer?.__typename === "PullRequest" && (
            <>
              {" "}
              in <Link to={new URL(e.closer.url!).pathname}>#{e.closer.number}</Link>
            </>
          )}
          {e.closer?.__typename === "Commit" && (
            <>
              {" "}
              in <a className="mono" href={e.closer.url} target="_blank" rel="noopener noreferrer">{e.closer.abbreviatedOid}</a>
            </>
          )}
        </Row>
      );
    }
    case "ReopenedEvent":
      return (
        <Row icon={IssueReopenedIcon} tone="success" item={e}>
          reopened this
        </Row>
      );
    case "CrossReferencedEvent":
      return (
        <Row icon={CrossReferenceIcon} item={e} block={<div className="tl-event-ref"><SubjectLink s={e.source} repo={repo} /></div>}>
          {e.willCloseTarget ? "linked a pull request that will close this" : "mentioned this"}
        </Row>
      );
    case "ReferencedEvent":
      return (
        <Row icon={GitCommitIcon} item={e}>
          added a commit that referenced this{" "}
          {e.commit && (
            <a href={e.commit.url} target="_blank" rel="noopener noreferrer">
              <span className="mono">{e.commit.abbreviatedOid}</span> {e.commit.messageHeadline}
            </a>
          )}
          {e.isCrossRepository && e.commitRepository && <span className="muted"> in {e.commitRepository.nameWithOwner}</span>}
        </Row>
      );
    case "ConnectedEvent":
    case "DisconnectedEvent":
      return (
        <Row icon={LinkIcon} item={e} block={<div className="tl-event-ref"><SubjectLink s={e.source?.repository.nameWithOwner === repo && e.subject ? e.subject : e.source} repo={repo} /></div>}>
          {e.__typename === "ConnectedEvent" ? "linked" : "removed a link to"} a {e.source?.__typename === "PullRequest" || e.subject?.__typename === "PullRequest" ? "pull request" : "issue"}
        </Row>
      );
    case "MarkedAsDuplicateEvent":
    case "UnmarkedAsDuplicateEvent":
      return (
        <Row icon={DuplicateIcon} item={e}>
          {e.__typename === "MarkedAsDuplicateEvent" ? "marked this as a duplicate of" : "unmarked this as a duplicate of"} <SubjectLink s={e.canonical} repo={repo} />
        </Row>
      );
    case "SubIssueAddedEvent":
    case "SubIssueRemovedEvent":
      return (
        <Row icon={IssueTracksIcon} item={e}>
          {e.__typename === "SubIssueAddedEvent" ? "added" : "removed"} sub-issue <SubjectLink s={e.subIssue} repo={repo} />
        </Row>
      );
    case "ParentIssueAddedEvent":
    case "ParentIssueRemovedEvent":
      return (
        <Row icon={IssueTrackedByIcon} item={e}>
          {e.__typename === "ParentIssueAddedEvent" ? "added parent issue" : "removed parent issue"} <SubjectLink s={e.parent} repo={repo} />
        </Row>
      );
    case "IssueTypeAddedEvent":
      return (
        <Row icon={TagIcon} item={e}>
          added the <strong>{e.issueType?.name}</strong> issue type
        </Row>
      );
    case "IssueTypeRemovedEvent":
      return (
        <Row icon={TagIcon} item={e}>
          removed the <strong>{e.issueType?.name}</strong> issue type
        </Row>
      );
    case "IssueTypeChangedEvent":
      return (
        <Row icon={TagIcon} item={e}>
          changed the issue type from <strong>{e.prevIssueType?.name}</strong> to <strong>{e.issueType?.name}</strong>
        </Row>
      );
    case "LockedEvent":
      return (
        <Row icon={LockIcon} item={e}>
          locked {e.lockReason ? <>as <strong>{e.lockReason.toLowerCase().replace("_", " ")}</strong> </> : ""}and limited conversation to collaborators
        </Row>
      );
    case "UnlockedEvent":
      return (
        <Row icon={UnlockIcon} item={e}>
          unlocked this conversation
        </Row>
      );
    case "PinnedEvent":
    case "UnpinnedEvent":
      return (
        <Row icon={PinIcon} item={e}>
          {e.__typename === "PinnedEvent" ? "pinned" : "unpinned"} this issue
        </Row>
      );
    case "TransferredEvent":
      return (
        <Row icon={RepoPushIcon} item={e}>
          transferred this issue from <strong>{e.fromRepository?.nameWithOwner ?? "a deleted repository"}</strong>
        </Row>
      );
    case "CommentDeletedEvent":
      return (
        <Row icon={TrashIcon} item={e}>
          deleted a comment{e.deletedCommentAuthor ? ` from ${e.deletedCommentAuthor.login}` : ""}
        </Row>
      );
    case "ConvertedToDiscussionEvent":
      return (
        <Row icon={CommentDiscussionIcon} item={e}>
          converted this issue into a discussion
        </Row>
      );
    case "AddedToProjectV2Event":
    case "RemovedFromProjectV2Event":
    case "ProjectV2ItemStatusChangedEvent":
      return (
        <Row icon={ProjectIcon} item={e}>
          {e.__typename === "AddedToProjectV2Event" ? "added this to a project" : e.__typename === "RemovedFromProjectV2Event" ? "removed this from a project" : "changed the project status"}
        </Row>
      );
    case "HeadRefForcePushedEvent":
      return (
        <Row icon={RepoPushIcon} item={e}>
          force-pushed the {e.ref && <code className="branch-name">{e.ref.name}</code>} branch from{" "}
          {e.beforeCommit ? <a className="mono" href={e.beforeCommit.url} target="_blank" rel="noopener noreferrer">{e.beforeCommit.abbreviatedOid}</a> : "?"} to{" "}
          {e.afterCommit ? <a className="mono" href={e.afterCommit.url} target="_blank" rel="noopener noreferrer">{e.afterCommit.abbreviatedOid}</a> : "?"}
        </Row>
      );
    case "ReviewRequestedEvent":
      return (
        <Row icon={EyeIcon} item={e}>
          requested a review from {reviewerName(e.requestedReviewer)}
        </Row>
      );
    case "ReviewRequestRemovedEvent":
      return (
        <Row icon={EyeIcon} item={e}>
          removed the review request for {reviewerName(e.requestedReviewer)}
        </Row>
      );
    case "ReadyForReviewEvent":
      return (
        <Row icon={GitPullRequestIcon} tone="success" item={e}>
          marked this pull request as ready for review
        </Row>
      );
    case "ConvertToDraftEvent":
      return (
        <Row icon={GitPullRequestDraftIcon} item={e}>
          marked this pull request as draft
        </Row>
      );
    case "MergedEvent":
      return (
        <Row icon={GitMergeIcon} tone="done" item={e}>
          merged commit{" "}
          {e.commit && (
            <a className="mono" href={e.commit.url} target="_blank" rel="noopener noreferrer">
              {e.commit.abbreviatedOid}
            </a>
          )}{" "}
          into <code className="branch-name">{e.mergeRefName}</code>
        </Row>
      );
    case "HeadRefDeletedEvent":
      return (
        <Row icon={GitBranchIcon} item={e}>
          deleted the <code className="branch-name">{e.headRefName}</code> branch
        </Row>
      );
    case "HeadRefRestoredEvent":
      return (
        <Row icon={GitBranchIcon} item={e}>
          restored the head branch
        </Row>
      );
    case "BaseRefDeletedEvent":
      return (
        <Row icon={GitBranchIcon} item={e}>
          deleted the base branch <code className="branch-name">{e.baseRefName}</code>
        </Row>
      );
    case "BaseRefChangedEvent":
      return (
        <Row icon={GitBranchIcon} item={e}>
          changed the base branch from <code className="branch-name">{e.previousRefName}</code> to <code className="branch-name">{e.currentRefName}</code>
        </Row>
      );
    case "BaseRefForcePushedEvent":
      return (
        <Row icon={RepoPushIcon} item={e}>
          force-pushed the base branch
        </Row>
      );
    case "AutoMergeEnabledEvent":
    case "AutoSquashEnabledEvent":
    case "AutoRebaseEnabledEvent":
      return (
        <Row icon={GitMergeIcon} item={e}>
          enabled auto-merge{e.__typename === "AutoSquashEnabledEvent" ? " (squash)" : e.__typename === "AutoRebaseEnabledEvent" ? " (rebase)" : ""}
        </Row>
      );
    case "AutoMergeDisabledEvent":
      return (
        <Row icon={XCircleIcon} item={e}>
          disabled auto-merge{e.reason ? ` (${e.reason.toLowerCase().replace(/_/g, " ")})` : ""}
        </Row>
      );
    case "ReviewDismissedEvent":
      return (
        <Row icon={XCircleIcon} item={e} block={e.dismissalMessage ? <div className="tl-event-ref muted">{e.dismissalMessage}</div> : undefined}>
          dismissed {e.review?.author ? `${e.review.author.login}'s` : "a"} stale review
        </Row>
      );
    case "DeployedEvent":
    case "DeploymentEnvironmentChangedEvent":
      return (
        <Row icon={RocketIcon} item={e}>
          {e.__typename === "DeployedEvent" ? "deployed this" : "changed the deployment environment"}
        </Row>
      );
    case "PullRequestCommitCommentThread":
      return (
        <Row icon={CommentDiscussionIcon} item={e}>
          {e.comments?.totalCount ?? 0} comment{e.comments?.totalCount === 1 ? "" : "s"} on commit{" "}
          {e.commit && <a className="mono" href={e.commit.url} target="_blank" rel="noopener noreferrer">{e.commit.abbreviatedOid}</a>}
          {e.path && <span className="muted"> in {e.path}</span>}
        </Row>
      );
    case "AddedToMergeQueueEvent":
    case "RemovedFromMergeQueueEvent":
      return (
        <Row icon={BookmarkIcon} item={e}>
          {e.__typename === "AddedToMergeQueueEvent" ? "added this to the merge queue" : "removed this from the merge queue"}
        </Row>
      );
    default:
      return (
        <Row icon={DotFillIcon} item={e}>
          {humanize(e.__typename)}
        </Row>
      );
  }
});

/** Consecutive commits collapsed into one row. */
export const CommitGroup = memo(function CommitGroup({ commits, pullPath }: { commits: CommitItem[]; pullPath: string }) {
  const first = commits[0].commit;
  const login = first.author?.user?.login ?? first.author?.name ?? "someone";
  return (
    <div className="tl-event">
      <span className="tl-badge">
        <GitCommitIcon size={14} />
      </span>
      <div className="tl-event-body">
        <div className="tl-event-line">
          {first.author?.avatarUrl && <Avatar src={first.author.avatarUrl} size={16} login={login} />} <strong>{login}</strong> added {commits.length} commit
          {commits.length === 1 ? "" : "s"}{" "}
          <span className="muted">
            <RelativeTime date={first.committedDate} />
          </span>
        </div>
        <ul className="tl-commits">
          {commits.map((c) => (
            <li key={c.id} className="row">
              <span className="grow truncate">
                <Link to={`${pullPath}/commits/${c.commit.oid}`} className="tl-commit-msg">
                  {c.commit.messageHeadline}
                </Link>
              </span>
              <a className="mono muted" href={c.commit.url} target="_blank" rel="noopener noreferrer">
                {c.commit.abbreviatedOid}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});
