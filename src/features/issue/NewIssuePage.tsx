import { IssueOpenedIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { gql } from "@/api/client";
import { canTriage, type IssueType, type Label, type RepoPermission, type User } from "@/api/types";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { Composer } from "@/features/composer/Composer";
import { DraftSidebar, type DraftMetadata } from "@/features/sidebar/DraftSidebar";
import { useRepoLabels } from "@/features/sidebar/data";
import { drafts } from "@/lib/drafts";
import { repoPath } from "@/lib/githubUrl";
import "./issue.css";
import { useTitle } from "@/lib/useTitle";

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

  useTitle("New issue", `${owner}/${repo}`);

  if (data.isPending)
    return (
      <div className="blankslate">
        <Spinner size={20} label="Loading issue templates" />
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
        Create new issue in <Link to={repoPath(owner, repo)}>{r.nameWithOwner}</Link>
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

function NewIssueForm({ owner, repo, data, template, params }: { owner: string; repo: string; data: NewIssueRepo; template?: Template; params: URLSearchParams }) {
  const navigate = useNavigate();
  const base = `${owner}/${repo}:new-issue:${template?.filename ?? "blank"}`;
  const [title, setTitle] = useState(() => params.get("title") ?? template?.title ?? "");
  const [meta, setMeta] = useState<DraftMetadata>({
    assignees: template?.assignees.nodes ?? [],
    labels: template?.labels.nodes ?? [],
    milestone: null,
    type: template?.type ?? null,
  });
  const titleLoaded = useRef(false);
  const titleEdited = useRef(false);
  const titleRef = useRef(title);
  titleRef.current = title;
  const triage = canTriage(data.viewerPermission);

  // Labels named in `?labels=a,b` resolve once the repo's labels load.
  const labelParam = params.get("labels");
  const repoLabels = useRepoLabels(owner, repo, triage && !!labelParam);

  useEffect(() => {
    if (!labelParam || !repoLabels.data) return;
    const names = labelParam.split(",").map((s) => s.trim().toLowerCase());
    const found = repoLabels.data.filter((l) => names.includes(l.name.toLowerCase()));
    setMeta((m) => ({ ...m, labels: [...m.labels, ...found.filter((f) => !m.labels.some((p) => p.id === f.id))] }));
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
      assigneeIds: meta.assignees.map((u) => u.id),
      labelIds: meta.labels.map((l) => l.id),
      milestoneId: meta.milestone?.id ?? null,
      issueTypeId: meta.type?.id ?? null,
      issueTemplate: template?.name ?? null,
    };
    const d = await gql<{ createIssue: { issue: { number: number } } }>(
      `mutation CreateIssue($input: CreateIssueInput!) { createIssue(input: $input) { issue { number } } }`,
      { input },
    );
    await drafts.clear(`${base}:title`);
    navigate(`/${owner}/${repo}/issues/${d.createIssue.issue.number}`);
  };

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

      <DraftSidebar kind="issue" owner={owner} repo={repo} editable={triage} value={meta} onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))} />
    </div>
  );
}
