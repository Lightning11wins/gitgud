import { GearIcon, IssueOpenedIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { gql } from "@/api/client";
import { canTriage, type IssueType, type Label, type Milestone, type RepoPermission, type User } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { IssueLabel } from "@/components/IssueLabel";
import { SelectMenu } from "@/components/SelectMenu";
import { Spinner } from "@/components/Spinner";
import { Composer } from "@/features/composer/Composer";
import { IssueTypeChip } from "@/features/sidebar/MetadataSidebar";
import { useAssignableUsers, useIssueTypes, useMilestones, useRepoLabels } from "@/features/sidebar/data";
import "@/features/sidebar/sidebar.css";
import { drafts } from "@/lib/drafts";
import "./issue.css";

interface Template {
  name: string;
  title: string | null;
  body: string | null;
  about: string | null;
  filename: string;
  labels: { nodes: Label[] };
  assignees: { nodes: User[] };
  type: IssueType | null;
}

interface NewIssueRepo {
  id: string;
  nameWithOwner: string;
  viewerPermission: RepoPermission | null;
  isBlankIssuesEnabled: boolean;
  contactLinks: { name: string; about: string; url: string }[] | null;
  issueTemplates: Template[] | null;
}

const NEW_ISSUE_REPO_QUERY = `
  query NewIssueRepo($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id nameWithOwner viewerPermission isBlankIssuesEnabled
      contactLinks { name about url }
      issueTemplates {
        name title body about filename
        labels(first: 20) { nodes { id name color description } }
        assignees(first: 10) { nodes { id login avatarUrl url } }
        type { id name color description }
      }
    }
  }`;

function useNewIssueRepo(owner: string, repo: string) {
  return useQuery({
    queryKey: ["new-issue", owner, repo],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = await gql<{ repository: NewIssueRepo | null }>(NEW_ISSUE_REPO_QUERY, { owner, repo });
      if (!d.repository) throw new Error(`Failed to find repository ${owner}/${repo}`);
      return d.repository;
    },
  });
}

/** `/:owner/:repo/issues/new`: template chooser, then title, body, and metadata pickers. */
export function NewIssuePage() {
  const { owner = "", repo = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const data = useNewIssueRepo(owner, repo);
  const templateName = params.get("template");

  useEffect(() => {
    document.title = `New issue · ${owner}/${repo}`;
  }, [owner, repo]);

  if (data.isPending)
    return (
      <div className="blankslate">
        <Spinner size={24} />
      </div>
    );
  if (data.error) return <ErrorBanner error={data.error} action={<button className="btn sm" onClick={() => data.refetch()}>Retry</button>} />;

  const r = data.data;
  const templates = r.issueTemplates ?? [];
  const template = templateName ? templates.find((t) => t.filename === templateName || t.name === templateName) : undefined;
  const choosing = templates.length > 0 && templateName == null && !params.has("blank") && !params.has("title") && !params.has("body");

  return (
    <div className="new-issue">
      <h2>
        Create new issue in <Link to={`/${owner}/${repo}`}>{r.nameWithOwner}</Link>
      </h2>
      {choosing ? (
        <TemplateChooser
          repo={r}
          onPick={(t) => setParams(t ? { template: t.filename } : { blank: "1" })}
        />
      ) : (
        <NewIssueForm key={template?.filename ?? "blank"} owner={owner} repo={repo} data={r} template={template} params={params} />
      )}
    </div>
  );
}

function TemplateChooser({ repo, onPick }: { repo: NewIssueRepo; onPick: (t: Template | null) => void }) {
  return (
    <div className="box template-list">
      {(repo.issueTemplates ?? []).map((t) => (
        <div key={t.filename} className="box-row">
          <div className="grow">
            <strong>{t.name}</strong>
            {t.about && <p className="muted">{t.about}</p>}
          </div>
          <button className="btn primary sm" onClick={() => onPick(t)}>
            Get started
          </button>
        </div>
      ))}
      {(repo.contactLinks ?? []).map((l) => (
        <div key={l.url} className="box-row">
          <div className="grow">
            <strong>{l.name}</strong>
            {l.about && <p className="muted">{l.about}</p>}
          </div>
          <a className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer">
            Open <LinkExternalIcon />
          </a>
        </div>
      ))}
      {repo.isBlankIssuesEnabled && (
        <div className="box-row">
          <div className="grow">
            <strong>Blank issue</strong>
            <p className="muted">Create a new issue from scratch</p>
          </div>
          <button className="btn sm" onClick={() => onPick(null)}>
            Get started
          </button>
        </div>
      )}
    </div>
  );
}

type Menu = "assignees" | "labels" | "milestone" | "type";

function NewIssueForm({ owner, repo, data, template, params }: { owner: string; repo: string; data: NewIssueRepo; template?: Template; params: URLSearchParams }) {
  const navigate = useNavigate();
  const base = `${owner}/${repo}:new-issue:${template?.filename ?? "blank"}`;
  const [title, setTitle] = useState(() => params.get("title") ?? template?.title ?? "");
  const [assignees, setAssignees] = useState<User[]>(template?.assignees.nodes ?? []);
  const [labels, setLabels] = useState<Label[]>(template?.labels.nodes ?? []);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [type, setType] = useState<IssueType | null>(template?.type ?? null);
  const [menu, setMenu] = useState<{ which: Menu; anchor: HTMLElement } | null>(null);
  const titleLoaded = useRef(false);
  const titleEdited = useRef(false);
  const titleRef = useRef(title);
  titleRef.current = title;
  const triage = canTriage(data.viewerPermission);

  // Labels named in `?labels=a,b` resolve once the repo's labels load.
  const labelParam = params.get("labels");
  const repoLabels = useRepoLabels(owner, repo, triage && (menu?.which === "labels" || !!labelParam));
  const assignable = useAssignableUsers(owner, repo, triage && menu?.which === "assignees");
  const milestones = useMilestones(owner, repo, triage && menu?.which === "milestone");
  const issueTypes = useIssueTypes(owner, repo, triage);

  useEffect(() => {
    if (!labelParam || !repoLabels.data) return;
    const names = labelParam.split(",").map((s) => s.trim().toLowerCase());
    const found = repoLabels.data.filter((l) => names.includes(l.name.toLowerCase()));
    setLabels((prev) => [...prev, ...found.filter((f) => !prev.some((p) => p.id === f.id))]);
  }, [labelParam, repoLabels.data]);

  useEffect(() => {
    const titleParam = params.has("title");
    drafts.get(`${base}:title`).then((t) => {
      // The `?title=` param and text typed while the draft loaded both win over the draft.
      if (t && !titleParam && !titleEdited.current) setTitle(t);
      titleLoaded.current = true;
      if (titleEdited.current) drafts.setSoon(`${base}:title`, titleRef.current);
    });
  }, [base]);

  useEffect(() => {
    if (titleLoaded.current) drafts.setSoon(`${base}:title`, title);
  }, [base, title]);

  const create = async (body: string) => {
    const t = title.trim();
    if (!t) throw new Error("Failed to create issue: the title is empty");
    const input = {
      repositoryId: data.id,
      title: t,
      body,
      assigneeIds: assignees.map((u) => u.id),
      labelIds: labels.map((l) => l.id),
      milestoneId: milestone?.id ?? null,
      issueTypeId: type?.id ?? null,
      issueTemplate: template?.name ?? null,
    };
    const d = await gql<{ createIssue: { issue: { number: number } } }>(
      `mutation CreateIssue($input: CreateIssueInput!) { createIssue(input: $input) { issue { number } } }`,
      { input },
    );
    await drafts.clear(`${base}:title`);
    navigate(`/${owner}/${repo}/issues/${d.createIssue.issue.number}`);
  };

  const open = (which: Menu) => (e: React.MouseEvent<HTMLElement>) => setMenu(menu ? null : { which, anchor: e.currentTarget });
  const showTypes = (issueTypes.data?.length ?? 0) > 0;

  return (
    <div className="issue-layout">
      <div className="new-issue-form">
        <div className="row">
          <IssueOpenedIcon />
          <label htmlFor="new-issue-title">Add a title</label>
        </div>
        <input
          id="new-issue-title"
          className="input new-issue-title"
          autoFocus
          placeholder="Title"
          value={title}
          onChange={(e) => {
            titleEdited.current = true;
            setTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        <label>Add a description</label>
        <Composer
          draftKey={`${base}:body`}
          owner={owner}
          repo={repo}
          initialValue={params.get("body") ?? template?.body ?? ""}
          placeholder="Type your description here..."
          submitLabel="Create"
          allowEmpty
          minRows={10}
          githubUrl={`https://github.com/${owner}/${repo}/issues/new`}
          onSubmit={create}
        />
      </div>

      <aside className="sidebar">
        <PickerSection title="Assignees" editable={triage} onEdit={open("assignees")}>
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
        <PickerSection title="Labels" editable={triage} onEdit={open("labels")}>
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
          <PickerSection title="Type" editable={triage} onEdit={open("type")}>
            {type ? <IssueTypeChip type={type} /> : <div className="muted sidebar-empty">No type</div>}
          </PickerSection>
        )}
        <PickerSection title="Milestone" editable={triage} onEdit={open("milestone")}>
          {milestone ? <span className="sidebar-milestone">{milestone.title}</span> : <div className="muted sidebar-empty">No milestone</div>}
        </PickerSection>
        {!triage && <p className="muted sidebar-empty">Only people with triage access can set metadata.</p>}
      </aside>

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
          onApply={(ids) => setAssignees((assignable.data ?? []).filter((u) => ids.includes(u.id)))}
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
          onApply={(ids) => setLabels((repoLabels.data ?? []).filter((l) => ids.includes(l.id)))}
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
          onApply={([id]) => setMilestone(milestones.data?.find((m) => m.id === id) ?? null)}
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
          onApply={([id]) => setType(issueTypes.data?.find((t) => t.id === id) ?? null)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function PickerSection({ title, editable, onEdit, children }: { title: string; editable: boolean; onEdit: (e: React.MouseEvent<HTMLElement>) => void; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <h3 className="sidebar-title row">
        <span className="grow">{title}</span>
        {editable && (
          <button className="btn invisible xs icon" aria-label={`Edit ${title.toLowerCase()}`} title={`Edit ${title.toLowerCase()}`} onClick={onEdit}>
            <GearIcon />
          </button>
        )}
      </h3>
      {children}
    </section>
  );
}
