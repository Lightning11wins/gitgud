import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, IssueClosedIcon, IssueOpenedIcon, SkipIcon } from "@primer/octicons-react";
import type { IssueStateReason } from "@/api/types";

export interface StateInfo {
  kind: "issue" | "pull";
  state: string;
  stateReason?: IssueStateReason;
  isDraft?: boolean;
}

/** Icon, color class, and text for an issue/PR state, matching GitHub's conventions. */
export function stateStyle({ kind, state, stateReason, isDraft }: StateInfo) {
  if (kind === "pull") {
    if (state === "MERGED") return { Icon: GitMergeIcon, cls: "merged", text: "Merged", color: "var(--done)" };
    if (state === "CLOSED") return { Icon: GitPullRequestClosedIcon, cls: "closed", text: "Closed", color: "var(--danger)" };
    if (isDraft) return { Icon: GitPullRequestDraftIcon, cls: "draft", text: "Draft", color: "var(--fg-muted)" };
    return { Icon: GitPullRequestIcon, cls: "open", text: "Open", color: "var(--success)" };
  }
  if (state === "CLOSED") {
    if (stateReason === "NOT_PLANNED" || stateReason === "DUPLICATE")
      return { Icon: SkipIcon, cls: "not-planned", text: stateReason === "DUPLICATE" ? "Duplicate" : "Not planned", color: "var(--fg-muted)" };
    return { Icon: IssueClosedIcon, cls: "completed", text: "Closed", color: "var(--done)" };
  }
  return { Icon: IssueOpenedIcon, cls: "open", text: "Open", color: "var(--success)" };
}

export function StateBadge(props: StateInfo & { small?: boolean }) {
  const { Icon, cls, text } = stateStyle(props);
  return (
    <span className={`state-badge ${cls} ${props.small ? "sm" : ""}`}>
      <Icon size={props.small ? 12 : 16} />
      {text}
    </span>
  );
}

export function StateIcon(props: StateInfo & { size?: number }) {
  const { Icon, color, text } = stateStyle(props);
  return (
    <span style={{ color, display: "inline-flex" }} title={text}>
      <Icon size={props.size ?? 16} />
    </span>
  );
}
