import { GitPullRequestClosedIcon, IssueClosedIcon, IssueReopenedIcon, LockIcon, SkipIcon, TriangleDownIcon } from "@primer/octicons-react";
import { useState, type Ref } from "react";
import { gql } from "@/api/client";
import type { SubjectKind } from "@/api/prefetch";
import { canTriage, type SubjectMeta } from "@/api/types";
import { auth } from "@/auth/token";
import { Avatar } from "@/components/Avatar";
import { Dialog } from "@/components/Dialog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Popover } from "@/components/Popover";
import { Composer, type ComposerActionContext, type ComposerHandle } from "@/features/composer/Composer";
import { useStore } from "@/lib/store";
import { addComment, closeIssue, closePull, invalidateSubject, patchSubject, reopenIssue, reopenPull, type CloseReason } from "./mutations";
import { updateTimeline } from "./timeline";
import type { IssueCommentItem } from "./types";

interface CommentFormProps {
  kind: SubjectKind;
  owner: string;
  repo: string;
  number: number;
  subject: SubjectMeta;
  handle: Ref<ComposerHandle>;
  /** Locked and the viewer isn't a collaborator. */
  locked: boolean;
}

const CLOSE_OPTIONS: { reason: CloseReason; label: string; hint: string }[] = [
  { reason: "COMPLETED", label: "Close as completed", hint: "Done, closed, fixed, resolved" },
  { reason: "NOT_PLANNED", label: "Close as not planned", hint: "Won't fix, can't repro, stale" },
  { reason: "DUPLICATE", label: "Close as duplicate", hint: "Duplicate of another issue" },
];

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The bottom comment box with close/reopen actions. */
export function CommentForm({ kind, owner, repo, number, subject, handle, locked }: CommentFormProps) {
  const { viewer } = useStore(auth);
  const [reason, setReason] = useState<CloseReason>("COMPLETED");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [dupFor, setDupFor] = useState<ComposerActionContext | null>(null);
  const canClose = subject.viewerCanUpdate || canTriage(subject.repository.viewerPermission);
  const isOpen = subject.state === "OPEN";

  if (locked) {
    return (
      <div className="flash warn row tl-locked">
        <LockIcon /> This conversation has been locked and limited to collaborators.
      </div>
    );
  }

  const comment = async (body: string) => {
    const temp: IssueCommentItem = {
      __typename: "IssueComment",
      id: `optimistic-${Date.now()}`,
      databaseId: 0,
      author: viewer && { login: viewer.login, avatarUrl: viewer.avatarUrl, url: viewer.url },
      body,
      bodyHTML: `<p style="white-space: pre-wrap">${escapeHtml(body)}</p>`,
      createdAt: new Date().toISOString(),
      url: subject.url,
      viewerCanUpdate: false,
      viewerCanReact: false,
      reactionGroups: [],
    };
    updateTimeline(owner, repo, number, (items) => [...items, temp]);
    try {
      const real = await addComment(subject.id, body);
      updateTimeline(owner, repo, number, (items) => items.map((it) => (it.id === temp.id ? real : it)));
    } catch (e) {
      updateTimeline(owner, repo, number, (items) => items.filter((it) => it.id !== temp.id));
      throw e;
    }
  };

  const submit = async (body: string) => {
    await comment(body);
    invalidateSubject(kind, owner, repo, number);
  };

  const setState = async (body: string, close: boolean, why: CloseReason = reason, duplicateId?: string) => {
    if (body.trim()) await comment(body);
    if (kind === "issue") await (close ? closeIssue(subject.id, why, duplicateId) : reopenIssue(subject.id));
    else await (close ? closePull(subject.id) : reopenPull(subject.id));
    patchSubject(kind, owner, repo, number, () => (kind === "issue" ? { state: close ? "CLOSED" : "OPEN", stateReason: close ? why : "REOPENED" } : { state: close ? "CLOSED" : "OPEN" }));
    invalidateSubject(kind, owner, repo, number);
  };

  const actions = (ctx: ComposerActionContext) => {
    if (!canClose || subject.state === "MERGED") return null;
    const withText = ctx.value.trim().length > 0;
    const noun = kind === "issue" ? "issue" : "pull request";
    if (!isOpen) {
      return (
        <button className="btn" disabled={ctx.submitting} onClick={() => ctx.run((b) => setState(b, false))}>
          <IssueReopenedIcon /> {withText ? "Reopen with comment" : `Reopen ${noun}`}
        </button>
      );
    }
    if (kind === "pull") {
      return (
        <button className="btn" disabled={ctx.submitting} onClick={() => ctx.run((b) => setState(b, true))}>
          <GitPullRequestClosedIcon /> {withText ? "Close with comment" : "Close pull request"}
        </button>
      );
    }
    const option = CLOSE_OPTIONS.find((o) => o.reason === reason)!;
    const Icon = reason === "COMPLETED" ? IssueClosedIcon : SkipIcon;
    const label = withText ? "Close with comment" : option.label.replace(" as completed", " issue");
    return (
      <span className="btn-group">
        <button
          className="btn"
          disabled={ctx.submitting}
          onClick={() => (reason === "DUPLICATE" ? setDupFor(ctx) : ctx.run((b) => setState(b, true)))}
        >
          <Icon className={reason === "COMPLETED" ? "done-icon" : "muted"} /> {label}
        </button>
        <button className="btn icon" aria-label="Choose close reason" disabled={ctx.submitting} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <TriangleDownIcon />
        </button>
        {menu && (
          <Popover anchor={menu} onClose={() => setMenu(null)} align="end" width={280}>
            <div className="select-menu-list">
              {CLOSE_OPTIONS.map((o) => (
                <button
                  key={o.reason}
                  className="select-menu-item"
                  aria-selected={o.reason === reason}
                  onClick={() => {
                    setReason(o.reason);
                    setMenu(null);
                  }}
                >
                  <span className="check">{o.reason === reason ? "✓" : ""}</span>
                  <span>
                    <strong>{o.label}</strong>
                    <br />
                    <span className="muted">{o.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Popover>
        )}
      </span>
    );
  };

  return (
    <div className="tl-form">
      {subject.locked && (
        <div className="flash warn row tl-locked">
          <LockIcon /> This conversation is locked. You can comment because you are a collaborator.
        </div>
      )}
      <div className="tl-form-row">
        {viewer && <Avatar src={viewer.avatarUrl} size={32} login={viewer.login} />}
        <div className="grow">
          <Composer
            handle={handle}
            draftKey={`${owner}/${repo}#${number}:comment`}
            owner={owner}
            repo={repo}
            githubUrl={subject.url}
            placeholder="Leave a comment"
            onSubmit={submit}
            actions={actions}
          />
        </div>
      </div>
      {dupFor && (
        <DuplicateDialog
          owner={owner}
          repo={repo}
          self={number}
          onClose={() => setDupFor(null)}
          onPick={(id) => {
            const ctx = dupFor;
            setDupFor(null);
            ctx.run((b) => setState(b, true, "DUPLICATE", id));
          }}
        />
      )}
    </div>
  );
}

function DuplicateDialog({ owner, repo, self, onClose, onPick }: { owner: string; repo: string; self: number; onClose: () => void; onPick: (id: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const n = Number(text.replace(/^#/, "").trim());
    if (!Number.isInteger(n) || n <= 0 || n === self) {
      setError(new Error(`Failed to use "${text}": enter another issue number`));
      return;
    }
    setBusy(true);
    try {
      const d = await gql<{ repository: { issue: { id: string } | null } }>(
        `query DuplicateTarget($owner: String!, $repo: String!, $n: Int!) { repository(owner: $owner, name: $repo) { issue(number: $n) { id } } }`,
        { owner, repo, n },
      );
      if (!d.repository.issue) throw new Error(`Failed to find issue #${n} in ${owner}/${repo}`);
      onPick(d.repository.issue.id);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Close as duplicate"
      onClose={onClose}
      width={400}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={go}>
            Close as duplicate
          </button>
        </>
      }
    >
      <label className="row">
        Duplicate of #
        <input className="input grow" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="Issue number" />
      </label>
      {error != null && <div style={{ marginTop: 8 }}><ErrorBanner error={error} /></div>}
    </Dialog>
  );
}
