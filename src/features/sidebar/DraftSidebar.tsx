import { GearIcon } from "@primer/octicons-react";
import { useState, type ReactNode } from "react";
import type { SubjectKind } from "@/api/prefetch";
import type { IssueType, Label, Milestone, User } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { IssueLabel } from "@/components/IssueLabel";
import { SelectMenu } from "@/components/SelectMenu";
import { IssueTypeChip } from "./MetadataSidebar";
import { useAssignableUsers, useIssueTypes, useMilestones, useRepoLabels } from "./data";
import "./sidebar.css";
import { tooltip } from "@/lib/tooltip";

/** Metadata picked for an issue or PR that doesn't exist yet. */
export interface DraftMetadata {
  assignees: User[];
  labels: Label[];
  milestone: Milestone | null;
  type: IssueType | null;
}

type Menu = "assignees" | "labels" | "milestone" | "type";

interface Props {
  kind: SubjectKind;
  owner: string;
  repo: string;
  /** Whether the viewer may set metadata (triage access). */
  editable: boolean;
  value: DraftMetadata;
  onChange: (patch: Partial<DraftMetadata>) => void;
  /** Extra sections, shown first. */
  children?: ReactNode;
}

/** The sidebar of the new issue and new PR forms: pickers that edit `value` locally. Issue types show for issues only. */
export function DraftSidebar({ kind, owner, repo, editable, value, onChange, children }: Props) {
  const [menu, setMenu] = useState<{ which: Menu; anchor: HTMLElement } | null>(null);
  const repoLabels = useRepoLabels(owner, repo, editable && menu?.which === "labels");
  const assignable = useAssignableUsers(owner, repo, editable && menu?.which === "assignees");
  const milestones = useMilestones(owner, repo, editable && menu?.which === "milestone");
  const issueTypes = useIssueTypes(owner, repo, editable && kind === "issue");
  const { assignees, labels, milestone, type } = value;

  const open = (which: Menu) => (e: React.MouseEvent<HTMLElement>) => setMenu(menu ? null : { which, anchor: e.currentTarget });
  const showTypes = kind === "issue" && (issueTypes.data?.length ?? 0) > 0;

  return (
    <aside className="sidebar">
      {children}
      <PickerSection title="Assignees" editable={editable} onEdit={open("assignees")}>
        {assignees.length === 0 ? (
          <div className="muted sidebar-empty">No one</div>
        ) : (
          <ul className="sidebar-list">
            {assignees.map((u) => (
              <li key={u.id} className="row">
                <Avatar src={u.avatarUrl} size={20} login={u.login} />
                <span className="sidebar-user">{u.login}</span>
              </li>
            ))}
          </ul>
        )}
      </PickerSection>
      <PickerSection title="Labels" editable={editable} onEdit={open("labels")}>
        {labels.length === 0 ? (
          <div className="muted sidebar-empty">None yet</div>
        ) : (
          <div className="sidebar-labels">
            {labels.map((l) => (
              <IssueLabel key={l.id} label={l} />
            ))}
          </div>
        )}
      </PickerSection>
      {showTypes && (
        <PickerSection title="Type" editable={editable} onEdit={open("type")}>
          {type ? <IssueTypeChip type={type} /> : <div className="muted sidebar-empty">No type</div>}
        </PickerSection>
      )}
      <PickerSection title="Milestone" editable={editable} onEdit={open("milestone")}>
        {milestone ? <span className="sidebar-milestone">{milestone.title}</span> : <div className="muted sidebar-empty">No milestone</div>}
      </PickerSection>
      {!editable && <p className="muted sidebar-empty">Only people with triage access can set metadata.</p>}

      {menu?.which === "assignees" && (
        <SelectMenu<User>
          anchor={menu.anchor}
          title="Assign up to 10 people"
          items={assignable.data}
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
          onApply={(ids) => onChange({ assignees: (assignable.data ?? []).filter((u) => ids.includes(u.id)) })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.which === "labels" && (
        <SelectMenu<Label>
          anchor={menu.anchor}
          title="Apply labels"
          items={repoLabels.data}
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
          initial={labels.map((l) => l.id)}
          multiple
          onApply={(ids) => onChange({ labels: (repoLabels.data ?? []).filter((l) => ids.includes(l.id)) })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.which === "milestone" && (
        <SelectMenu<Milestone>
          anchor={menu.anchor}
          title="Set milestone"
          items={milestones.data}
          getKey={(m) => m.id}
          getText={(m) => m.title}
          renderItem={(m) => (
            <span className="sidebar-menu-label">
              <strong>{m.title}</strong>
              {m.dueOn && <span className="muted">Due {new Date(m.dueOn).toLocaleDateString()}</span>}
            </span>
          )}
          initial={milestone ? [milestone.id] : []}
          onApply={([id]) => onChange({ milestone: milestones.data?.find((m) => m.id === id) ?? null })}
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
          initial={type ? [type.id] : []}
          onApply={([id]) => onChange({ type: issueTypes.data?.find((t) => t.id === id) ?? null })}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/** A sidebar section with a title and, when `editable`, a gear button that calls `onEdit`. */
export function PickerSection({ title, editable, onEdit, children }: { title: string; editable: boolean; onEdit: (e: React.MouseEvent<HTMLElement>) => void; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <h3 className="sidebar-title row">
        <span className="grow">{title}</span>
        {editable && (
          <button className="btn invisible xs icon" {...tooltip(`Edit ${title.toLowerCase()}`, "label")} onClick={onEdit}>
            <GearIcon />
          </button>
        )}
      </h3>
      {children}
    </section>
  );
}
