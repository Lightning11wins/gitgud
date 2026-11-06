import { gql } from "@/api/client";
import { keys } from "@/api/keys";
import { queryClient } from "@/api/queryClient";
import type { SubjectKind } from "@/api/prefetch";
import type { ReactionContent, ReactionGroup, SubjectMeta } from "@/api/types";
import { ISSUE_COMMENT_FIELDS } from "./queries";
import type { IssueCommentItem } from "./types";

export async function addComment(subjectId: string, body: string): Promise<IssueCommentItem> {
  const d = await gql<{ addComment: { commentEdge: { node: IssueCommentItem } } }>(
    `mutation AddComment($id: ID!, $body: String!) {
      addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { __typename ${ISSUE_COMMENT_FIELDS} } } }
    }`,
    { id: subjectId, body },
  );
  return d.addComment.commentEdge.node;
}

export interface RenderedBody {
  body: string;
  bodyHTML: string;
  lastEditedAt?: string | null;
}

export async function updateComment(id: string, body: string): Promise<RenderedBody> {
  const d = await gql<{ updateIssueComment: { issueComment: RenderedBody } }>(
    `mutation UpdateIssueComment($id: ID!, $body: String!) {
      updateIssueComment(input: { id: $id, body: $body }) { issueComment { body bodyHTML lastEditedAt } }
    }`,
    { id, body },
  );
  return d.updateIssueComment.issueComment;
}

export async function deleteComment(id: string) {
  await gql(`mutation DeleteIssueComment($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }`, { id });
}

export async function updateReviewBody(id: string, body: string): Promise<RenderedBody> {
  const d = await gql<{ updatePullRequestReview: { pullRequestReview: RenderedBody } }>(
    `mutation UpdateReview($id: ID!, $body: String!) {
      updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) { pullRequestReview { body bodyHTML lastEditedAt } }
    }`,
    { id, body },
  );
  return d.updatePullRequestReview.pullRequestReview;
}

export type MinimizeReason = "SPAM" | "ABUSE" | "OFF_TOPIC" | "OUTDATED" | "DUPLICATE" | "RESOLVED";

export async function setMinimized(id: string, minimize: boolean, reason: MinimizeReason = "OUTDATED") {
  if (minimize)
    await gql(`mutation MinimizeComment($id: ID!, $c: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $id, classifier: $c }) { clientMutationId } }`, { id, c: reason });
  else await gql(`mutation UnminimizeComment($id: ID!) { unminimizeComment(input: { subjectId: $id }) { clientMutationId } }`, { id });
}

export async function setReaction(subjectId: string, content: ReactionContent, add: boolean) {
  const op = add ? "addReaction" : "removeReaction";
  await gql(`mutation ${add ? "AddReaction" : "RemoveReaction"}($id: ID!, $content: ReactionContent!) { ${op}(input: { subjectId: $id, content: $content }) { clientMutationId } }`, {
    id: subjectId,
    content,
  });
}

/** Reaction groups after the viewer adds or removes `content`. */
export function applyReaction(groups: ReactionGroup[], content: ReactionContent, add: boolean): ReactionGroup[] {
  const found = groups.some((g) => g.content === content);
  const list = found ? groups : [...groups, { content, viewerHasReacted: false, reactors: { totalCount: 0 } }];
  return list.map((g) =>
    g.content !== content || g.viewerHasReacted === add
      ? g
      : { ...g, viewerHasReacted: add, reactors: { totalCount: Math.max(0, g.reactors.totalCount + (add ? 1 : -1)) } },
  );
}

export async function updateSubjectBody(kind: SubjectKind, id: string, body: string): Promise<RenderedBody> {
  if (kind === "issue") {
    const d = await gql<{ updateIssue: { issue: RenderedBody } }>(
      `mutation UpdateIssueBody($id: ID!, $body: String!) { updateIssue(input: { id: $id, body: $body }) { issue { body bodyHTML lastEditedAt } } }`,
      { id, body },
    );
    return d.updateIssue.issue;
  }
  const d = await gql<{ updatePullRequest: { pullRequest: RenderedBody } }>(
    `mutation UpdatePullBody($id: ID!, $body: String!) { updatePullRequest(input: { pullRequestId: $id, body: $body }) { pullRequest { body bodyHTML lastEditedAt } } }`,
    { id, body },
  );
  return d.updatePullRequest.pullRequest;
}

export type CloseReason = "COMPLETED" | "NOT_PLANNED" | "DUPLICATE";

export async function closeIssue(id: string, reason: CloseReason, duplicateIssueId?: string) {
  await gql(
    `mutation CloseIssue($id: ID!, $reason: IssueClosedStateReason, $dup: ID) {
      closeIssue(input: { issueId: $id, stateReason: $reason, duplicateIssueId: $dup }) { issue { id } }
    }`,
    { id, reason, dup: duplicateIssueId ?? null },
  );
}

export async function reopenIssue(id: string) {
  await gql(`mutation ReopenIssue($id: ID!) { reopenIssue(input: { issueId: $id }) { issue { id } } }`, { id });
}

export async function closePull(id: string) {
  await gql(`mutation ClosePullRequest($id: ID!) { closePullRequest(input: { pullRequestId: $id }) { pullRequest { id } } }`, { id });
}

export async function reopenPull(id: string) {
  await gql(`mutation ReopenPullRequest($id: ID!) { reopenPullRequest(input: { pullRequestId: $id }) { pullRequest { id } } }`, { id });
}

export function subjectKey(kind: SubjectKind, owner: string, repo: string, number: number) {
  return kind === "issue" ? keys.issue(owner, repo, number) : keys.pull(owner, repo, number);
}

/** Patches the cached issue/PR metadata in place. */
export function patchSubject(kind: SubjectKind, owner: string, repo: string, number: number, patch: (s: SubjectMeta) => Partial<SubjectMeta>) {
  queryClient.setQueryData<SubjectMeta>(subjectKey(kind, owner, repo, number), (old) => (old && "id" in old ? { ...old, ...patch(old) } : old));
}

/** Refetches the subject metadata and its timeline after a change. */
export function invalidateSubject(kind: SubjectKind, owner: string, repo: string, number: number) {
  queryClient.invalidateQueries({ queryKey: subjectKey(kind, owner, repo, number) });
  queryClient.invalidateQueries({ queryKey: keys.timeline(owner, repo, number) });
}
