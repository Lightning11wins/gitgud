import {
  BookmarkIcon,
  CheckIcon,
  CommentDiscussionIcon,
  CrossReferenceIcon,
  DotFillIcon,
  DuplicateIcon,
  EllipsisIcon,
  EyeIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
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
  XIcon,
  type Icon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/Avatar";
import { IssueLabel } from "@/components/IssueLabel";
import { RelativeTime } from "@/components/RelativeTime";
import { StateBadge, StateIcon } from "@/components/StateBadge";
import { TitleText } from "@/components/TitleText";
import { commitsQueryOptions, type PullCommit } from "@/features/pull/api";
import { CommitChecksButton, OutcomeIcon, rollupOutcome } from "@/features/pull/checks";
import { SignatureLabel } from "@/features/pull/CommitsTab";
import { BotBadge } from "./BotBadge";
import { eventGroup } from "./rows";
import type { CommitItem, EventItem, SubjectRef } from "./types";

function SubjectLink({ s, repo, icon = true }: { s: SubjectRef | null | undefined; repo: string; icon?: boolean }) {
  if (!s) return <span className="muted">a deleted item</span>;
  const [o, r] = s.repository.nameWithOwner.split("/");
  const kind = s.__typename === "PullRequest" ? "pull" : "issues";
  const prefix = s.repository.nameWithOwner === repo ? "" : s.repository.nameWithOwner;
  return (
    <span className="event-ref">
      {icon && <><StateIcon kind={kind === "pull" ? "pull" : "issue"} state={s.state} stateReason={s.stateReason} isDraft={s.isDraft} size={14} />{" "}</>}
      <Link to={`/${o}/${r}/${kind}/${s.number}`}>
        <strong><TitleText text={s.title} /></strong> <span className="muted">{prefix}#{s.number}</span>
      </Link>
    </span>
  );
}

function ActorName({ a, avatar = true }: { a: { __typename?: string; login: string; avatarUrl?: string; url?: string } | null | undefined; avatar?: boolean }) {
  if (!a) return <strong>ghost</strong>;
  return (
    <>
      {avatar && a.avatarUrl && <><Avatar src={a.avatarUrl} size={16} login={a.login} />{" "}</>}
      <a className="event-actor" href={a.url} target="_blank" rel="noopener noreferrer">
        {a.login}
      </a>
      <BotBadge actor={a} />
    </>
  );
}

/** "a", "a and b", or "a, b, and c". */
function joinList(nodes: ReactNode[]) {
  return nodes.map((n, i) => (
    <Fragment key={i}>
      {i === 0 ? null : i < nodes.length - 1 ? ", " : nodes.length > 2 ? ", and " : " and "}
      {n}
    </Fragment>
  ));
}

/** DOM id of an event row; its timestamp links here. */
export const eventAnchor = (id: string) => `event-${id}`;

/** `single` keeps the line to one row; its `.shrink` children take the ellipsis. `merged` are later events folded into this row, whose anchors land here too. */
function Row(props: { icon: Icon; tone?: string; children: ReactNode; item: EventItem; block?: ReactNode; single?: boolean; merged?: EventItem[] }) {
  const { icon: I, tone, children, item, block, single, merged } = props;
  const anchor = eventAnchor(item.id);
  return (
    <div className="tl-event" id={anchor}>
      {merged?.map((e) => <span key={e.id} id={eventAnchor(e.id)} className="tl-event-anchor" />)}
      <span className={`tl-badge ${tone ?? ""}`}>
        <I size={14} />
      </span>
      <div className="tl-event-body">
        <div className={single ? "tl-event-line single" : "tl-event-line"}>
          {item.actor !== undefined && <ActorName a={item.actor} />} {children}
          {item.createdAt && (
            <>
              {" "}
              <Link className="tl-event-time" to={{ hash: `#${anchor}` }}>
                <RelativeTime date={item.createdAt} />
              </Link>
            </>
          )}
        </div>
        {block}
      </div>
    </div>
  );
}

/** A requested reviewer. Teams the token can't see come back as null. */
function reviewerName(r: EventItem["requestedReviewer"], avatar = true) {
  if (!r) return <strong>a team</strong>;
  if (r.__typename === "Team") return <strong>{r.name}</strong>;
  return <ActorName a={{ __typename: r.__typename, login: r.login ?? "ghost", avatarUrl: r.avatarUrl, url: r.url }} avatar={avatar} />;
}

function humanize(typename: string) {
  return typename
    .replace(/Event$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const CLOSE_REASON: Record<string, string> = { COMPLETED: "as completed", NOT_PLANNED: "as not planned", DUPLICATE: "as a duplicate" };

/** One-line timeline event. Unknown types fall back to a generic row. */
export const EventRow = memo(function EventRow({ item, repo, pull }: { item: EventItem; repo: string; pull?: boolean }) {
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
      if (pull) {
        return (
          <Row icon={GitPullRequestClosedIcon} tone="danger-solid" item={e}>
            closed this
          </Row>
        );
      }
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
    case "CrossReferencedEvent": {
      const s = e.source;
      const ref = (
        <div className="tl-event-ref row">
          <span className="grow">
            <SubjectLink s={s} repo={repo} icon={false} />
          </span>
          {s && <StateBadge small kind={s.__typename === "PullRequest" ? "pull" : "issue"} state={s.state} stateReason={s.stateReason} isDraft={s.isDraft} />}
        </div>
      );
      return (
        <Row icon={CrossReferenceIcon} item={e} block={ref}>
          {e.willCloseTarget ? "linked a pull request that will close this" : "mentioned this"}
        </Row>
      );
    }
    case "ReferencedEvent":
      return (
        <Row icon={GitCommitIcon} item={e} single>
          <span>added a commit that referenced this</span>
          <CommitRef e={e} />
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

const ADDING = new Set(["LabeledEvent", "AssignedEvent", "ReviewRequestedEvent"]);

/** A burst of label, assignee, or reviewer changes by one actor, in one row. */
export const EventGroupRow = memo(function EventGroupRow({ events }: { events: EventItem[] }) {
  const [first, ...rest] = events;
  const added = events.filter((e) => ADDING.has(e.__typename));
  const removed = events.filter((e) => !ADDING.has(e.__typename));
  const both = added.length > 0 && removed.length > 0 ? " and " : null;
  switch (eventGroup(first.__typename)) {
    case "labels": {
      const labels = (list: EventItem[]) => list.map((e) => <Fragment key={e.id}>{" "}{e.label && <IssueLabel label={e.label} />}</Fragment>);
      return (
        <Row icon={TagIcon} item={first} merged={rest}>
          {added.length > 0 && <>added{labels(added)}</>}
          {both}
          {removed.length > 0 && <>removed{labels(removed)}</>} labels
        </Row>
      );
    }
    case "assignees": {
      const names = (list: EventItem[]) => joinList(list.map((e) => <ActorName a={e.assignee} avatar={false} />));
      return (
        <Row icon={PersonIcon} item={first} merged={rest}>
          {added.length > 0 && <>assigned {names(added)}</>}
          {both}
          {removed.length > 0 && <>unassigned {names(removed)}</>}
        </Row>
      );
    }
    default: {
      const names = (list: EventItem[]) => joinList(list.map((e) => reviewerName(e.requestedReviewer, false)));
      return (
        <Row icon={EyeIcon} item={first} merged={rest}>
          {added.length > 0 && <>requested review from {names(added)}</>}
          {both}
          {removed.length > 0 && <>removed {removed.length > 1 ? "review requests" : "the review request"} for {names(removed)}</>}
        </Row>
      );
    }
  }
});

/** A referenced commit's link and, when it's in another repository, the repository name. */
function CommitRef({ e }: { e: EventItem }) {
  const where = e.isCrossRepository && e.commitRepository ? ` in ${e.commitRepository.nameWithOwner}` : "";
  return (
    <>
      {e.commit && (
        <a className="shrink" href={e.commit.url} target="_blank" rel="noopener noreferrer" title={`${e.commit.messageHeadline ?? ""}${where}`}>
          <span className="mono">{e.commit.abbreviatedOid}</span> {e.commit.messageHeadline}
        </a>
      )}
      {where && <span className="muted">{where.trim()}</span>}
    </>
  );
}

/** Consecutive commits from other repositories that referenced this, collapsed into one row. */
export const ReferenceGroup = memo(function ReferenceGroup({ events }: { events: EventItem[] }) {
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  return (
    <div className="tl-event">
      <span className="tl-badge">
        <GitCommitIcon size={14} />
      </span>
      <div className="tl-event-body">
        <div className="tl-event-line">
          {events.length} commits in other repositories referenced this
          {last.createdAt && (
            <span className="muted">
              , most recently <RelativeTime date={last.createdAt} />
            </span>
          )}{" "}
          <button className="tl-link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide" : "Show all"}
          </button>
        </div>
        {open && (
          <ul className="tl-commits">
            {events.map((e) => (
              <li key={e.id} className="tl-event-line single">
                <ActorName a={e.actor} />
                <CommitRef e={e} />
                {e.createdAt && (
                  <span className="muted">
                    <RelativeTime date={e.createdAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

/** One commit on the timeline. `detail` comes from the Commits tab's list, which has bodies, checks, and signatures. */
const TimelineCommit = memo(function TimelineCommit({
  item,
  detail,
  to,
  owner,
  repo,
  number,
}: {
  item: CommitItem;
  detail: PullCommit | undefined;
  to: string;
  owner: string;
  repo: string;
  number: number;
}) {
  const [open, setOpen] = useState(false);
  const c = item.commit;
  const login = c.author?.user?.login ?? c.author?.name ?? undefined;
  const outcome = rollupOutcome(detail?.statusCheckRollup?.state);
  return (
    <div className="tl-commit">
      <span className="tl-commit-node">
        <GitCommitIcon size={16} />
      </span>
      <div className="tl-commit-main">
        <div className="tl-commit-line">
          {c.author?.avatarUrl && <Avatar src={c.author.avatarUrl} size={16} login={login} />}
          <Link to={to} className="tl-commit-msg truncate" title={c.messageHeadline}>
            {c.messageHeadline}
          </Link>
          {detail?.messageBody && (
            <button className="btn invisible xs icon commit-expand" aria-expanded={open} aria-label="Show commit message body" onClick={() => setOpen(!open)}>
              <EllipsisIcon size={12} />
            </button>
          )}
          <span className="tl-commit-end">
            <SignatureLabel signature={detail?.signature} />
            {outcome && (
              <CommitChecksButton owner={owner} repo={repo} number={number} oid={c.oid}>
                {outcome === "success" ? (
                  <CheckIcon size={14} className="check-icon success" aria-label="Checks passed" />
                ) : outcome === "failure" ? (
                  <XIcon size={14} className="check-icon failure" aria-label="Checks failed" />
                ) : (
                  <OutcomeIcon outcome={outcome} size={14} />
                )}
              </CommitChecksButton>
            )}
            <Link to={to} className="mono tl-commit-sha">
              {c.abbreviatedOid}
            </Link>
          </span>
        </div>
        {open && detail && <pre className="commit-body">{detail.messageBody}</pre>}
      </div>
    </div>
  );
});

/** Consecutive commits: a summary line, then one row per commit along the timeline. */
export const CommitGroup = memo(function CommitGroup({ commits, owner, repo, number }: { commits: CommitItem[]; owner: string; repo: string; number: number }) {
  const q = useQuery(commitsQueryOptions(owner, repo, number));
  const byOid = useMemo(() => new Map(q.data?.commits.map((c) => [c.oid, c])), [q.data]);
  const first = commits[0].commit;
  const login = first.author?.user?.login ?? first.author?.name ?? "someone";
  const base = `/${owner}/${repo}/pull/${number}/commits/`;
  return (
    <>
      <div className="tl-event">
        <span className="tl-badge">
          <GitCommitIcon size={14} />
        </span>
        <div className="tl-event-body">
          <div className="tl-event-line">
            {first.author?.avatarUrl && <Avatar src={first.author.avatarUrl} size={16} login={login} />} <strong className="event-actor">{login}</strong> added{" "}
            {commits.length} commit{commits.length === 1 ? "" : "s"} <RelativeTime date={first.committedDate} />
          </div>
        </div>
      </div>
      {commits.map((c) => (
        <TimelineCommit key={c.id} item={c} detail={byOid.get(c.commit.oid)} to={base + c.commit.oid} owner={owner} repo={repo} number={number} />
      ))}
    </>
  );
});
