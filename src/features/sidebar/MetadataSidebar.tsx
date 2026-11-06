import { GearIcon, LinkIcon, LockIcon, UnlockIcon, XIcon } from "@primer/octicons-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { gql } from "@/api/client";
import type { SubjectKind } from "@/api/prefetch";
import { canTriage, canWrite, type IssueType, type Label, type Milestone, type SubjectMeta, type User } from "@/api/types";
import { auth } from "@/auth/token";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { IssueLabel } from "@/components/IssueLabel";
import { SelectMenu } from "@/components/SelectMenu";
import { StateIcon } from "@/components/StateBadge";
import { invalidateSubject, patchSubject } from "@/features/conversation/mutations";
import { useStore } from "@/lib/store";
import {
  addSubIssue,
  findIssue,
  removeSubIssue,
  setLocked,
  updateSubject,
  useAssignableUsers,
  useIssueTypes,
  useMilestones,
  useRepoLabels,
  type IssueExtras,
  type IssueRef,
  type PullRef,
  type SubjectUpdate,
} from "./data";
import "./sidebar.css";
import { copyText } from "@/lib/clipboard";

export interface MetadataSidebarProps {
  subject: SubjectMeta;
  owner: string;
  repo: string;
  /** Extra sections rendered first, e.g. reviewers for PRs. */
  children?: ReactNode;
}

type Menu = "assignees" | "labels" | "milestone" | "type";

/** Assignees, labels, issue type, milestone, sub-issues, lock, and copy link. */
export function MetadataSidebar({ subject, owner, repo, children }: MetadataSidebarProps) {
  const kind: SubjectKind = subject.__typename === "Issue" ? "issue" : "pull";
  const editable = canTriage(subject.repository.viewerPermission);
  const [menu, setMenu] = useState<{ which: Menu; anchor: HTMLElement } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { viewer } = useStore(auth);
  const extras = subject as SubjectMeta & Partial<IssueExtras>;

  const labels = useRepoLabels(owner, repo, menu?.which === "labels");
  const assignable = useAssignableUsers(owner, repo, menu?.which === "assignees");
  const milestones = useMilestones(owner, repo, menu?.which === "milestone");
  const issueTypes = useIssueTypes(owner, repo, kind === "issue");

  const apply = (input: SubjectUpdate, optimistic: Partial<SubjectMeta>) => {
    setError(null);
    patchSubject(kind, owner, repo, subject.number, () => optimistic);
    updateSubject(kind, subject.id, input)
      .catch(setError)
      .finally(() => invalidateSubject(kind, owner, repo, subject.number));
  };

  const assignSelf = async () => {
    if (!viewer) return;
    try {
      const { viewer: v } = await gql<{ viewer: { id: string } }>(`query ViewerId { viewer { id } }`);
      apply({ assigneeIds: [v.id] }, { assignees: { nodes: [{ id: v.id, login: viewer.login, avatarUrl: viewer.avatarUrl, url: viewer.url }] } });
    } catch (e) {
      setError(e);
    }
  };

  const open = (which: Menu) => (e: React.MouseEvent<HTMLElement>) => setMenu(menu ? null : { which, anchor: e.currentTarget });
  const gear = (which: Menu, label: string) =>
    editable && (
      <button className="btn invisible xs icon" aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={open(which)}>
        <GearIcon />
      </button>
    );

  const assignees = subject.assignees.nodes;
  const showTypes = kind === "issue" && (issueTypes.data?.length ?? 0) > 0;

  return (
    <aside className="sidebar">
      {children}
      {error != null && <ErrorBanner error={error} />}

      <section className="sidebar-section">
        <h3 className="sidebar-title row">
          <span className="grow">Assignees</span>
          {gear("assignees", "assignees")}
        </h3>
        {assignees.length === 0 ? (
          <div className="muted sidebar-empty">
            No one
            {editable && viewer && (
              <>
                {" · "}
                <button className="link-button" onClick={assignSelf}>
                  assign yourself
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="sidebar-list">
            {assignees.map((u) => (
              <li key={u.login} className="row">
                <Avatar src={u.avatarUrl} size={20} login={u.login} />
                <a href={u.url} target="_blank" rel="noopener noreferrer" className="sidebar-user">
                  {u.login}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sidebar-section">
        <h3 className="sidebar-title row">
          <span className="grow">Labels</span>
          {gear("labels", "labels")}
        </h3>
        {subject.labels.nodes.length === 0 ? (
          <div className="muted sidebar-empty">None yet</div>
        ) : (
          <div className="sidebar-labels">
            {subject.labels.nodes.map((l) => (
              <Link key={l.id} to={`/${owner}/${repo}/issues?q=${encodeURIComponent(`label:"${l.name}"`)}`}>
                <IssueLabel label={l} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {showTypes && (
        <section className="sidebar-section">
          <h3 className="sidebar-title row">
            <span className="grow">Type</span>
            {gear("type", "issue type")}
          </h3>
          {subject.issueType ? <IssueTypeChip type={subject.issueType} /> : <div className="muted sidebar-empty">No type</div>}
        </section>
      )}

      <section className="sidebar-section">
        <h3 className="sidebar-title row">
          <span className="grow">Milestone</span>
          {gear("milestone", "milestone")}
        </h3>
        {subject.milestone ? (
          <a href={`https://github.com/${owner}/${repo}/milestone/${subject.milestone.number}`} target="_blank" rel="noopener noreferrer" className="sidebar-milestone">
            {subject.milestone.title}
          </a>
        ) : (
          <div className="muted sidebar-empty">No milestone</div>
        )}
      </section>

      {kind === "issue" && extras.subIssues && (
        <SubIssues subject={extras as SubjectMeta & IssueExtras} owner={owner} repo={repo} editable={editable} onError={setError} />
      )}

      {kind === "issue" && extras.closedByPullRequestsReferences && (
        <section className="sidebar-section">
          <h3 className="sidebar-title">Development</h3>
          {extras.closedByPullRequestsReferences.nodes.length === 0 ? (
            <div className="muted sidebar-empty">No linked pull requests</div>
          ) : (
            <ul className="sidebar-list">
              {extras.closedByPullRequestsReferences.nodes.map((p) => (
                <li key={p.id} className="row">
                  <PullRefRow pull={p} owner={owner} repo={repo} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {kind === "issue" && extras.participants && extras.participants.totalCount > 0 && (
        <section className="sidebar-section">
          <h3 className="sidebar-title">Participants</h3>
          <div className="sidebar-participants">
            {extras.participants.nodes.map((u) => (
              <a key={u.id} href={u.url} target="_blank" rel="noopener noreferrer" title={u.login}>
                <Avatar src={u.avatarUrl} size={20} login={u.login} />
              </a>
            ))}
            {extras.participants.totalCount > extras.participants.nodes.length && (
              <span className="muted">+{extras.participants.totalCount - extras.participants.nodes.length}</span>
            )}
          </div>
        </section>
      )}

      <section className="sidebar-section sidebar-footer">
        {canWrite(subject.repository.viewerPermission) && <LockButton subject={subject} kind={kind} owner={owner} repo={repo} onError={setError} />}
        <CopyLinkButton url={subject.url} />
      </section>

      {menu?.which === "assignees" && (
        <SelectMenu<User>
          anchor={menu.anchor}
          title="Assign up to 10 people"
          items={assignable.data ? mergeSelected(assignable.data, assignees, (u) => u.login) : undefined}
          getKey={(u) => u.id}
          getText={(u) => `${u.login} ${u.name ?? ""}`}
          renderItem={(u) => (
            <>
              <Avatar src={u.avatarUrl} size={20} login={u.login} />
              <strong>{u.login}</strong>
              {u.name && <span className="muted truncate">{u.name}</span>}
            </>
          )}
          initial={assignees.map((u) => u.id)}
          multiple
          onApply={(ids) => {
            const users = mergeSelected(assignable.data ?? [], assignees, (u) => u.login).filter((u) => ids.includes(u.id));
            apply({ assigneeIds: ids }, { assignees: { nodes: users } });
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.which === "labels" && (
        <SelectMenu<Label>
          anchor={menu.anchor}
          title="Apply labels"
          items={labels.data}
          getKey={(l) => l.id}
          getText={(l) => `${l.name} ${l.description ?? ""}`}
          renderItem={(l) => (
            <span className="sidebar-menu-label">
              <span className="row" style={{ gap: 6 }}>
                <span className="label-dot" style={{ background: `#${l.color}` }} />
                <strong>{l.name}</strong>
              </span>
              {l.description && <span className="muted truncate">{l.description}</span>}
            </span>
          )}
          initial={subject.labels.nodes.map((l) => l.id)}
          multiple
          onApply={(ids) => {
            const chosen = (labels.data ?? []).filter((l) => ids.includes(l.id));
            apply({ labelIds: ids }, { labels: { nodes: chosen } });
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.which === "milestone" && (
        <SelectMenu<Milestone>
          anchor={menu.anchor}
          title="Set milestone"
          items={milestones.data ? mergeSelected(milestones.data, subject.milestone ? [subject.milestone] : [], (m) => m.id) : undefined}
          getKey={(m) => m.id}
          getText={(m) => m.title}
          renderItem={(m) => (
            <span className="sidebar-menu-label">
              <strong>{m.title}</strong>
              {m.dueOn && <span className="muted">Due {new Date(m.dueOn).toLocaleDateString()}</span>}
            </span>
          )}
          initial={subject.milestone ? [subject.milestone.id] : []}
          onApply={([id]) => {
            const m = milestones.data?.find((x) => x.id === id) ?? null;
            apply({ milestoneId: id ?? null }, { milestone: m });
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.which === "type" && (
        <SelectMenu<IssueType>
          anchor={menu.anchor}
          title="Select issue type"
          items={issueTypes.data}
          getKey={(t) => t.id}
          getText={(t) => `${t.name} ${t.description ?? ""}`}
          renderItem={(t) => (
            <span className="sidebar-menu-label">
              <IssueTypeChip type={t} />
              {t.description && <span className="muted truncate">{t.description}</span>}
            </span>
          )}
          initial={subject.issueType ? [subject.issueType.id] : []}
          onApply={([id]) => {
            const t = issueTypes.data?.find((x) => x.id === id) ?? null;
            apply({ issueTypeId: id ?? null }, { issueType: t });
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/** Keeps currently selected items in the list even when the server list omits them. */
function mergeSelected<T>(items: T[], selected: T[], key: (t: T) => string): T[] {
  const have = new Set(items.map(key));
  return [...selected.filter((s) => !have.has(key(s))), ...items];
}

const TYPE_COLORS: Record<string, string> = {
  GRAY: "var(--fg-muted)",
  BLUE: "var(--accent)",
  GREEN: "var(--success)",
  YELLOW: "var(--attention)",
  ORANGE: "#bc4c00",
  RED: "var(--danger)",
  PINK: "#bf3989",
  PURPLE: "var(--done)",
};

export function IssueTypeChip({ type }: { type: Pick<IssueType, "name" | "color"> }) {
  return (
    <span className="issue-type-chip">
      <span className="label-dot" style={{ background: TYPE_COLORS[type.color] ?? "var(--fg-muted)" }} />
      {type.name}
    </span>
  );
}

function SubIssues({ subject, owner, repo, editable, onError }: { subject: SubjectMeta & IssueExtras; owner: string; repo: string; editable: boolean; onError: (e: unknown) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { subIssues, subIssuesSummary: summary, parent } = subject;
  const refresh = () => invalidateSubject("issue", owner, repo, subject.number);

  const add = async () => {
    setBusy(true);
    onError(null);
    try {
      const target = await findIssue(owner, repo, text);
      await addSubIssue(subject.id, target.id);
      patchSubject("issue", owner, repo, subject.number, (s) => {
        const x = s as SubjectMeta & IssueExtras;
        // A refetch that finished after the mutation may already list it.
        if (x.subIssues.nodes.some((n) => n.id === target.id)) return {};
        return { subIssues: { totalCount: x.subIssues.totalCount + 1, nodes: [...x.subIssues.nodes, target] } } as Partial<SubjectMeta>;
      });
      setText("");
      setAdding(false);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const remove = (sub: IssueRef) => {
    onError(null);
    patchSubject("issue", owner, repo, subject.number, (s) => {
      const x = s as SubjectMeta & IssueExtras;
      return { subIssues: { totalCount: x.subIssues.totalCount - 1, nodes: x.subIssues.nodes.filter((n) => n.id !== sub.id) } } as Partial<SubjectMeta>;
    });
    removeSubIssue(subject.id, sub.id).catch(onError).finally(refresh);
  };

  return (
    <>
      {parent && (
        <section className="sidebar-section">
          <h3 className="sidebar-title">Parent issue</h3>
          <IssueRefRow issue={parent} owner={owner} repo={repo} />
        </section>
      )}
      <section className="sidebar-section">
        <h3 className="sidebar-title row">
          <span className="grow">Sub-issues</span>
          {summary.total > 0 && (
            <span className="muted sidebar-progress-text">
              {summary.completed} of {summary.total}
            </span>
          )}
          {editable && (
            <button className="btn invisible xs icon" aria-label="Add sub-issue" title="Add existing issue as sub-issue" onClick={() => setAdding(!adding)}>
              {adding ? <XIcon /> : <GearIcon />}
            </button>
          )}
        </h3>
        {summary.total > 0 && (
          <div className="sidebar-progress" role="progressbar" aria-valuenow={summary.percentCompleted} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${summary.percentCompleted}%` }} />
          </div>
        )}
        {subIssues.nodes.length === 0 && !adding && <div className="muted sidebar-empty">None</div>}
        <ul className="sidebar-list">
          {subIssues.nodes.map((s) => (
            <li key={s.id} className="row sidebar-subissue">
              <IssueRefRow issue={s} owner={owner} repo={repo} />
              {editable && (
                <button className="btn invisible xs icon" aria-label={`Remove sub-issue #${s.number}`} title="Remove sub-issue" onClick={() => remove(s)}>
                  <XIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
        {subIssues.totalCount > subIssues.nodes.length && (
          <a className="muted" href={subject.url} target="_blank" rel="noopener noreferrer">
            {subIssues.totalCount - subIssues.nodes.length} more on GitHub
          </a>
        )}
        {adding && (
          <form
            className="row sidebar-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) add();
            }}
          >
            <input className="input sm grow" autoFocus placeholder="#123 or owner/repo#123" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn sm" disabled={busy || !text.trim()}>
              Add
            </button>
          </form>
        )}
      </section>
    </>
  );
}

function PullRefRow({ pull, owner, repo }: { pull: PullRef; owner: string; repo: string }) {
  const [o, r] = pull.repository.nameWithOwner.split("/");
  const local = o === owner && r === repo;
  return (
    <Link to={`/${o}/${r}/pull/${pull.number}`} className="row grow sidebar-ref" title={pull.title}>
      <StateIcon kind="pull" state={pull.state} isDraft={pull.isDraft} size={14} />
      <span className="truncate grow">{pull.title}</span>
      <span className="muted">{local ? "" : pull.repository.nameWithOwner}#{pull.number}</span>
    </Link>
  );
}

function IssueRefRow({ issue, owner, repo }: { issue: IssueRef; owner: string; repo: string }) {
  const [o, r] = issue.repository.nameWithOwner.split("/");
  const local = o === owner && r === repo;
  return (
    <Link to={`/${o}/${r}/issues/${issue.number}`} className="row grow sidebar-ref" title={issue.title}>
      <StateIcon kind="issue" state={issue.state} stateReason={issue.stateReason} size={14} />
      <span className="truncate grow">{issue.title}</span>
      <span className="muted">{local ? "" : issue.repository.nameWithOwner}#{issue.number}</span>
    </Link>
  );
}

function LockButton({ subject, kind, owner, repo, onError }: { subject: SubjectMeta; kind: SubjectKind; owner: string; repo: string; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const lock = !subject.locked;
    if (lock && !confirm("Lock this conversation? Only collaborators will be able to comment.")) return;
    setBusy(true);
    onError(null);
    try {
      await setLocked(subject.id, lock);
      patchSubject(kind, owner, repo, subject.number, () => ({ locked: lock }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
      invalidateSubject(kind, owner, repo, subject.number);
    }
  };
  return (
    <button className="btn invisible sm sidebar-action" disabled={busy} onClick={toggle}>
      {subject.locked ? <UnlockIcon /> : <LockIcon />} {subject.locked ? "Unlock conversation" : "Lock conversation"}
    </button>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn invisible sm sidebar-action"
      onClick={() =>
        copyText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, () => {})
      }
    >
      <LinkIcon /> {copied ? "Copied" : "Copy link"}
    </button>
  );
}
