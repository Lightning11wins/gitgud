import { ArrowLeftIcon, CheckIcon, FileDiffIcon, GitBranchIcon, GitCommitIcon, GitCompareIcon, GitPullRequestIcon, PeopleIcon, TriangleDownIcon, XIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { gql, gqlAll, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { queryClient } from "@/api/queryClient";
import { ACTOR_FIELDS, canTriage, type RepoPermission } from "@/api/types";
import { auth } from "@/auth/token";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SelectMenu } from "@/components/SelectMenu";
import { Spinner } from "@/components/Spinner";
import { Composer } from "@/features/composer/Composer";
import { useCompareFiles } from "@/features/diff/data";
import { CompareFiles } from "@/features/diff/FilesChanged";
import { DraftSidebar, PickerSection, type DraftMetadata } from "@/features/sidebar/DraftSidebar";
import { updateSubject } from "@/features/sidebar/data";
import { drafts } from "@/lib/drafts";
import { useStore } from "@/lib/store";
import { fetchReviewerCandidates, requestReviews, reviewerCandidatesKey, type Candidate, type PullCommit } from "./api";
import { CommitList } from "./CommitsTab";
import { plural } from "./util";
import "./pull.css";
import { useTitle } from "@/lib/useTitle";

const TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];

const COMMIT_FIELDS = `oid abbreviatedOid messageHeadline messageBody committedDate authoredDate url
  parents(first: 2) { nodes { oid abbreviatedOid } }
  authors(first: 3) { nodes { name email user { ${ACTOR_FIELDS} } } }`;

interface Branches {
  defaultBranch: string;
  names: string[];
}

async function fetchBranches(owner: string, repo: string): Promise<Branches> {
  let defaultBranch = "";
  type Page = { repository: { defaultBranchRef: { name: string } | null; refs: { pageInfo: PageInfo; nodes: { name: string }[] } } };
  const names = await gqlAll(async (after) => {
    const data = await gql<Page>(
      `query Branches($owner: String!, $repo: String!, $after: String) { repository(owner: $owner, name: $repo) {
        defaultBranchRef { name }
        refs(refPrefix: "refs/heads/", first: 100, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { name } }
      } }`,
      { owner, repo, after },
    );
    defaultBranch = data.repository.defaultBranchRef?.name ?? "";
    return { nodes: data.repository.refs.nodes.map((n) => n.name), pageInfo: data.repository.refs.pageInfo };
  });
  return { defaultBranch, names };
}

interface Comparison {
  repositoryId: string;
  viewerPermission: RepoPermission | null;
  /** Null when either ref doesn't exist. */
  compare: { aheadBy: number; behindBy: number; status: string; totalCommits: number } | null;
  commits: PullCommit[];
  existing: { number: number; title: string } | null;
  template: string | null;
}

async function fetchComparison(owner: string, repo: string, base: string, head: string): Promise<Comparison> {
  const templateVars = Object.fromEntries(TEMPLATE_PATHS.map((p, i) => [`t${i}`, `${base}:${p}`]));
  const templateArgs = TEMPLATE_PATHS.map((_, i) => `$t${i}: String!`).join(", ");
  const templateFields = TEMPLATE_PATHS.map((_, i) => `t${i}: object(expression: $t${i}) { ... on Blob { text } }`).join("\n");
  type CommitPage = { totalCount: number; pageInfo: PageInfo; nodes: PullCommit[] };
  type Data = {
    repository: {
      id: string;
      viewerPermission: RepoPermission | null;
      baseRef: { compare: { aheadBy: number; behindBy: number; status: string; commits: CommitPage } | null } | null;
      pullRequests: { nodes: { number: number; title: string }[] };
    } & Record<string, { text?: string } | null>;
  };
  const first = await gql<Data>(
    `query Compare($owner: String!, $repo: String!, $base: String!, $head: String!, ${templateArgs}) { repository(owner: $owner, name: $repo) {
      id viewerPermission
      baseRef: ref(qualifiedName: $base) { compare(headRef: $head) { aheadBy behindBy status commits(first: 100) {
        totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} }
      } } }
      pullRequests(headRefName: $head, baseRefName: $base, states: OPEN, first: 1) { nodes { number title } }
      ${templateFields}
    } }`,
    { owner, repo, base, head, ...templateVars },
  );
  const r = first.repository;
  const cmp = r.baseRef?.compare ?? null;
  let commits = cmp?.commits.nodes ?? [];
  if (cmp?.commits.pageInfo.hasNextPage) {
    const rest = await gqlAll(async (after) => {
      const data = await gql<{ repository: { baseRef: { compare: { commits: CommitPage } } } }>(
        `query CompareCommits($owner: String!, $repo: String!, $base: String!, $head: String!, $after: String) { repository(owner: $owner, name: $repo) {
          baseRef: ref(qualifiedName: $base) { compare(headRef: $head) { commits(first: 100, after: $after) {
            totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} }
          } } }
        } }`,
        { owner, repo, base, head, after: after ?? cmp.commits.pageInfo.endCursor },
      );
      return data.repository.baseRef.compare.commits;
    });
    commits = [...commits, ...rest];
  }
  const template = TEMPLATE_PATHS.map((_, i) => r[`t${i}`]?.text).find((t) => t != null) ?? null;
  return {
    repositoryId: r.id,
    viewerPermission: r.viewerPermission,
    compare: cmp && { aheadBy: cmp.aheadBy, behindBy: cmp.behindBy, status: cmp.status, totalCommits: cmp.commits.totalCount },
    commits,
    existing: r.pullRequests.nodes[0] ?? null,
    template,
  };
}

/** Splits `base...head`, `head`, or `owner:head` from the compare path. */
function parseSpec(spec: string, owner: string): { base?: string; head?: string; foreign?: boolean } {
  const decoded = spec.replace(/\/$/, "");
  if (!decoded) return {};
  const [a, b] = decoded.includes("...") ? decoded.split("...", 2) : [undefined, decoded];
  const strip = (ref: string | undefined) => {
    if (!ref) return { ref, foreign: false };
    const m = /^([^:]+):(.+)$/.exec(ref);
    if (!m) return { ref, foreign: false };
    return { ref: m[2], foreign: m[1].toLowerCase() !== owner.toLowerCase() };
  };
  const base = strip(a);
  const head = strip(b);
  return { base: base.ref, head: head.ref, foreign: base.foreign || head.foreign };
}

function defaultTitle(head: string, commits: PullCommit[]): string {
  if (commits.length === 1) return commits[0].messageHeadline;
  const words = head.replace(/^.*\//, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : head;
}

/** `/:owner/:repo/compare[/base...head]` and `/pull/new/:head`: branch pickers, the new-PR form, and a diff preview. */
export function ComparePage({ head: headProp }: { head?: string } = {}) {
  const { owner = "", repo = "", "*": spec = "" } = useParams();
  const navigate = useNavigate();
  useTitle(headProp ? "New pull request" : "Compare", `${owner}/${repo}`);
  const parsed = parseSpec(headProp ?? spec, owner);
  const branches = useQuery({ queryKey: ["branches", owner, repo], queryFn: () => fetchBranches(owner, repo) });
  const base = parsed.base ?? branches.data?.defaultBranch;
  const head = parsed.head;
  const comparable = !!base && !!head && base !== head && !parsed.foreign;
  const cmp = useQuery({
    queryKey: ["compare", owner, repo, base, head],
    queryFn: () => fetchComparison(owner, repo, base!, head!),
    enabled: comparable,
  });

  const go = (nextBase: string | undefined, nextHead: string | undefined) => {
    const b = nextBase ?? base;
    if (!nextHead) navigate(`/${owner}/${repo}/compare${b ? `/${b}` : ""}`, { replace: true });
    else navigate(`/${owner}/${repo}/compare/${b}...${nextHead}`, { replace: true });
  };

  const data = cmp.data;
  const nothing = data?.compare && data.compare.aheadBy === 0;
  return (
    <div className="compare-page">
      <div className="compare-top">
        <h1 className="compare-title">{data?.compare && !data.existing && !nothing ? "Open a pull request" : "Comparing changes"}</h1>
        <p className="muted compare-lede">Choose two branches to see what's changed or to start a new pull request.</p>
        <div className="compare-range row">
          <GitCompareIcon />
          <BranchPicker label="base" value={base} branches={branches.data?.names} onPick={(b) => go(b, head)} />
          <ArrowLeftIcon className="muted" />
          <BranchPicker label="compare" value={head} branches={branches.data?.names} onPick={(h) => go(base, h)} />
          {data?.compare && <MergeHint compare={data.compare} />}
          {cmp.isFetching && <Spinner label="Comparing branches" />}
        </div>
        {branches.error != null && <ErrorBanner error={branches.error} />}
        {cmp.error != null && <ErrorBanner error={cmp.error} />}
        {parsed.foreign && (
          <div className="flash warn">
            Comparing across forks isn't supported here.{" "}
            <a href={`https://github.com/${owner}/${repo}/compare/${headProp ?? spec}`} target="_blank" rel="noopener noreferrer">
              Open this comparison on GitHub
            </a>
            .
          </div>
        )}
        {!comparable && !parsed.foreign && (
          <div className="blankslate box">
            <h3>{base && base === head ? "There isn't anything to compare." : "Compare changes across branches"}</h3>
            <p>Choose different branches above to discuss and review changes.</p>
          </div>
        )}
        {data && !data.compare && <div className="flash error">Failed to compare {base}...{head}: one of the branches doesn't exist.</div>}
        {data?.existing && (
          <div className="flash info row">
            <span className="grow">
              There's already an open pull request for these branches: <strong>{data.existing.title}</strong>
            </span>
            <Link className="btn sm" to={`/${owner}/${repo}/pull/${data.existing.number}`}>
              View pull request #{data.existing.number}
            </Link>
          </div>
        )}
        {nothing && (
          <div className="blankslate box">
            <h3>There isn't anything to compare.</h3>
            <p>
              <strong>{base}</strong> is up to date with all commits from <strong>{head}</strong>.
            </p>
          </div>
        )}
        {data?.compare && !data.existing && !nothing && (
          <NewPullForm key={`${base}...${head}`} owner={owner} repo={repo} base={base!} head={head!} data={data} />
        )}
      </div>
      {data?.compare && !nothing && (
        <>
          <CompareSummary owner={owner} repo={repo} base={base!} head={head!} data={data} totalCommits={data.compare.totalCommits} />
          <div className="compare-commits">
            <CommitList commits={data.commits} />
          </div>
          <CompareFiles owner={owner} repo={repo} base={base!} head={head!} />
        </>
      )}
    </div>
  );
}

/** Commit, file, and contributor counts for the comparison. */
function CompareSummary({ owner, repo, base, head, data, totalCommits }: { owner: string; repo: string; base: string; head: string; data: Comparison; totalCommits: number }) {
  const files = useCompareFiles(owner, repo, base, head).data?.files;
  const contributors = new Set(data.commits.flatMap((c) => c.authors.nodes.map((a) => a.user?.login ?? a.email ?? a.name))).size;
  const count = (n: number | undefined, noun: string, suffix = "") => (
    <>
      <strong>{n == null ? "\u2026" : `${n.toLocaleString()}${suffix}`}</strong> {n === 1 ? noun : `${noun}s`}
    </>
  );
  return (
    <div className="box compare-summary">
      <span>
        <GitCommitIcon /> {count(totalCommits, "commit")}
        {data.commits.length < totalCommits && <span className="muted"> (showing {data.commits.length.toLocaleString()})</span>}
      </span>
      <span>
        <FileDiffIcon /> {count(files?.length, "file", files?.length === 300 ? "+" : "")} changed
      </span>
      <span>
        <PeopleIcon /> {count(contributors, "contributor")}
      </span>
    </div>
  );
}

function MergeHint({ compare }: { compare: NonNullable<Comparison["compare"]> }) {
  if (compare.aheadBy === 0) return null;
  if (compare.behindBy === 0)
    return (
      <span className="compare-merge ok">
        <CheckIcon /> <strong>Able to merge.</strong> <span className="muted">These branches can be automatically merged.</span>
      </span>
    );
  return (
    <span className="compare-merge muted">
      {plural(compare.aheadBy, "commit")} ahead, {plural(compare.behindBy, "commit")} behind the base branch.
    </span>
  );
}

function BranchPicker({ label, value, branches, onPick }: { label: string; value?: string; branches?: string[]; onPick: (b: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="btn sm compare-branch-btn" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <GitBranchIcon />
        <span className="muted">{label}:</span>
        <span className="truncate">{value ?? "choose a branch"}</span>
        <TriangleDownIcon />
      </button>
      {anchor && (
        <SelectMenu<string>
          anchor={anchor}
          title={`Choose a ${label} branch`}
          items={branches}
          getKey={(b) => b}
          getText={(b) => b}
          renderItem={(b) => <span className="truncate">{b}</span>}
          initial={value ? [value] : []}
          onApply={(keys) => keys[0] && onPick(keys[0])}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

function NewPullForm({ owner, repo, base, head, data }: { owner: string; repo: string; base: string; head: string; data: Comparison }) {
  const navigate = useNavigate();
  const draftKey = `${owner}/${repo}:compare:${base}...${head}`;
  const fallbackTitle = defaultTitle(head, data.commits);
  const [title, setTitle] = useState(fallbackTitle);
  const [draft, setDraft] = useState(false);
  const [titleLoaded, setTitleLoaded] = useState(false);
  const [meta, setMeta] = useState<DraftMetadata>({ assignees: [], labels: [], milestone: null, type: null });
  const [reviewers, setReviewers] = useState<Candidate[]>([]);
  const triage = canTriage(data.viewerPermission);

  useEffect(() => {
    drafts.get(`${draftKey}:title`).then((t) => {
      if (t) setTitle(t);
      setTitleLoaded(true);
    });
  }, [draftKey]);
  useEffect(() => {
    if (!titleLoaded) return;
    const t = setTimeout(() => drafts.set(`${draftKey}:title`, title === fallbackTitle ? "" : title), 250);
    return () => clearTimeout(t);
  }, [draftKey, title, fallbackTitle, titleLoaded]);

  const initialBody = data.template ?? (data.commits.length === 1 ? data.commits[0].messageBody : "");

  const create = async (body: string) => {
    const t = title.trim();
    if (!t) throw new Error("Failed to create the pull request: the title is empty");
    const res = await gql<{ createPullRequest: { pullRequest: { id: string; number: number } } }>(
      `mutation CreatePull($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id number } } }`,
      { input: { repositoryId: data.repositoryId, baseRefName: base, headRefName: head, title: t, body, draft } },
    );
    const { id, number } = res.createPullRequest.pullRequest;
    const createError = await applyMetadata(id, number, meta, reviewers);
    await drafts.clear(`${draftKey}:title`);
    queryClient.invalidateQueries({ queryKey: ["compare", owner, repo] });
    queryClient.invalidateQueries({ queryKey: ["repo-list", owner, repo] });
    queryClient.invalidateQueries({ queryKey: keys.recentPushes(owner, repo) });
    navigate(`/${owner}/${repo}/pull/${number}`, { state: createError ? { createError } : undefined });
  };

  return (
    <div className="compare-form">
      <div className="compare-form-main">
        <label className="row" htmlFor="compare-title">
          <GitPullRequestIcon />
          Add a title
        </label>
        <input id="compare-title" className="input compare-title-input" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
        {!title.trim() && (
          <div className="muted compare-hint row">
            <XIcon /> A title is required.
          </div>
        )}
        <label>Add a description</label>
        <Composer
          draftKey={draftKey}
          owner={owner}
          repo={repo}
          initialValue={initialBody}
          placeholder="Add a description"
          submitLabel={draft ? "Create draft pull request" : "Create pull request"}
          minRows={10}
          allowEmpty
          onSubmit={create}
          actions={() => (
            <label className="row compare-draft">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              Create as draft
            </label>
          )}
        />
      </div>
      <DraftSidebar kind="pull" owner={owner} repo={repo} editable={triage} value={meta} onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}>
        <DraftReviewers owner={owner} repo={repo} editable={triage} value={reviewers} onChange={setReviewers} />
      </DraftSidebar>
    </div>
  );
}

/** Sets a new PR's metadata. Returns the error of the first update that failed, so the PR page can show it. */
async function applyMetadata(id: string, number: number, meta: DraftMetadata, reviewers: Candidate[]): Promise<string | null> {
  const updates: Promise<unknown>[] = [];
  if (meta.assignees.length || meta.labels.length || meta.milestone)
    updates.push(
      updateSubject("pull", id, { assigneeIds: meta.assignees.map((u) => u.id), labelIds: meta.labels.map((l) => l.id), milestoneId: meta.milestone?.id ?? null }).catch((e) => {
        throw new Error(`Failed to set the assignees, labels, and milestone of #${number}: ${e instanceof Error ? e.message : e}`);
      }),
    );
  if (reviewers.length) {
    const ids = (kind: Candidate["kind"]) => reviewers.filter((r) => r.kind === kind).map((r) => r.id);
    updates.push(
      requestReviews(id, ids("user"), ids("team")).catch((e) => {
        throw new Error(`Failed to request reviewers on #${number}: ${e instanceof Error ? e.message : e}`);
      }),
    );
  }
  const failed = (await Promise.allSettled(updates)).find((r) => r.status === "rejected");
  return failed ? (failed.reason as Error).message : null;
}

function DraftReviewers({ owner, repo, editable, value, onChange }: { owner: string; repo: string; editable: boolean; value: Candidate[]; onChange: (next: Candidate[]) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { viewer } = useStore(auth);
  const candidates = useQuery({
    queryKey: reviewerCandidatesKey(owner, repo),
    queryFn: () => fetchReviewerCandidates(owner, repo),
    enabled: !!anchor,
    staleTime: 5 * 60_000,
  });
  const name = (c: Candidate) => (c.kind === "user" ? c.login : c.combinedSlug);
  return (
    <PickerSection title="Reviewers" editable={editable} onEdit={(e) => setAnchor(anchor ? null : e.currentTarget)}>
      {value.length === 0 ? (
        <div className="muted sidebar-empty">No reviews</div>
      ) : (
        <ul className="sidebar-list">
          {value.map((c) => (
            <li key={c.id} className="row">
              {c.kind === "team" && !c.avatarUrl ? <PeopleIcon size={20} /> : <Avatar src={c.avatarUrl} size={20} login={name(c)} />}
              <span className="sidebar-user truncate">{name(c)}</span>
            </li>
          ))}
        </ul>
      )}
      {candidates.error != null && anchor && <ErrorBanner error={candidates.error} />}
      {anchor && (
        <SelectMenu<Candidate>
          anchor={anchor}
          title="Request up to 15 reviewers"
          items={candidates.data?.filter((c) => c.kind === "team" || c.login !== viewer?.login)}
          getKey={(c) => c.id}
          getText={(c) => (c.kind === "user" ? `${c.login} ${c.name ?? ""}` : `${c.combinedSlug} ${c.name}`)}
          renderItem={(c) => (
            <>
              {c.kind === "team" && !c.avatarUrl ? <PeopleIcon size={20} /> : <Avatar src={c.avatarUrl} size={20} />}
              <span className="truncate">
                <strong>{name(c)}</strong> <span className="muted">{c.name}</span>
              </span>
            </>
          )}
          initial={value.map((c) => c.id)}
          multiple
          onApply={(ids) => onChange((candidates.data ?? []).filter((c) => ids.includes(c.id)))}
          onClose={() => setAnchor(null)}
        />
      )}
    </PickerSection>
  );
}
