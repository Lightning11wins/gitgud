import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { CheckIcon, CodeIcon, IssueOpenedIcon, GitPullRequestIcon, LockIcon, RepoIcon } from "@primer/octicons-react";
import { gql } from "@/api/client";
import { keys } from "@/api/keys";
import { ErrorBanner } from "@/components/ErrorBanner";
import { FilterInput } from "./FilterInput";
import { DEFAULT_SORT, ListFilters } from "./ListFilters";
import { SubjectList } from "./SubjectList";
import { baseQuery, buildSearch, getSort, getState, setState, useSearchList, type StateFilter } from "./searchList";
import "./repo.css";
import { useTitle } from "@/lib/useTitle";

const DEFAULT_Q = "is:open";

type Kind = "issue" | "pr" | undefined;

const COUNTS_QUERY = `
query RepoCounts($owner: String!, $name: String!, $iOpen: String!, $iClosed: String!, $pOpen: String!, $pClosed: String!) {
  repository(owner: $owner, name: $name) { nameWithOwner description isPrivate }
  iOpen: search(type: ISSUE_ADVANCED, query: $iOpen, first: 0) { issueCount }
  iClosed: search(type: ISSUE_ADVANCED, query: $iClosed, first: 0) { issueCount }
  pOpen: search(type: ISSUE_ADVANCED, query: $pOpen, first: 0) { issueCount }
  pClosed: search(type: ISSUE_ADVANCED, query: $pClosed, first: 0) { issueCount }
}`;

interface RepoCounts {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  iOpen: number;
  iClosed: number;
  pOpen: number;
  pClosed: number;
}

async function fetchCounts(owner: string, name: string, base: string): Promise<RepoCounts> {
  const scope = (kind: string, state: string) => `repo:${owner}/${name} ${base} is:${kind} is:${state}`.replace(/\s+/g, " ");
  const data = await gql<{
    repository: { nameWithOwner: string; description: string | null; isPrivate: boolean };
    iOpen: { issueCount: number };
    iClosed: { issueCount: number };
    pOpen: { issueCount: number };
    pClosed: { issueCount: number };
  }>(COUNTS_QUERY, {
    owner,
    name,
    iOpen: scope("issue", "open"),
    iClosed: scope("issue", "closed"),
    pOpen: scope("pr", "open"),
    pClosed: scope("pr", "closed"),
  });
  return {
    ...data.repository,
    iOpen: data.iOpen.issueCount,
    iClosed: data.iClosed.issueCount,
    pOpen: data.pOpen.issueCount,
    pClosed: data.pClosed.issueCount,
  };
}

function stateCount(c: RepoCounts | undefined, kind: Kind, state: StateFilter): number | undefined {
  if (!c) return undefined;
  const i = state === "open" ? c.iOpen : c.iClosed;
  const p = state === "open" ? c.pOpen : c.pClosed;
  return kind === "issue" ? i : kind === "pr" ? p : i + p;
}

export function RepoPage({ kind }: { kind?: Kind }) {
  const { owner = "", repo = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? DEFAULT_Q;
  const setQ = (next: string) => setParams(next === DEFAULT_Q ? {} : { q: next }, { replace: true });
  const slug = `${owner}/${repo}`;
  useTitle(kind === "issue" ? "Issues" : kind === "pr" ? "Pull requests" : null, slug);

  const base = baseQuery(q);
  const counts = useQuery({
    queryKey: keys.repoCounts(owner, repo, base),
    queryFn: () => fetchCounts(owner, repo, base),
    placeholderData: keepPreviousData,
  });

  const search = buildSearch(q, { repo: slug, kind, defaultSort: DEFAULT_SORT });
  const allKey = keys.repoList(owner, repo, `all:${buildSearch(q, { repo: slug, defaultSort: DEFAULT_SORT })}`);
  const list = useSearchList(keys.repoList(owner, repo, `${kind ?? "all"}:${search}`), search, kind && { key: allKey, kind });

  const c = counts.data;
  const state = getState(q);
  const sort = getSort(q) ?? DEFAULT_SORT;
  const tabQuery = params.toString() ? `?${params.toString()}` : "";
  const tabs = [
    { to: `/${slug}${tabQuery}`, label: "All", icon: null, kind: undefined, count: c && c.iOpen + c.pOpen },
    { to: `/${slug}/issues${tabQuery}`, label: "Issues", icon: <IssueOpenedIcon size={16} />, kind: "issue", count: c?.iOpen },
    { to: `/${slug}/pulls${tabQuery}`, label: "Pull requests", icon: <GitPullRequestIcon size={16} />, kind: "pr", count: c?.pOpen },
  ] as const;

  return (
    <div className="repo">
      <div className="repo-head">
        <h1 className="repo-name">
          <RepoIcon size={20} />
          <span className="muted">{owner} /</span> <strong>{repo}</strong>
          {c?.isPrivate && <LockIcon size={16} className="muted" />}
        </h1>
        {counts.isPending ? (
          <p className="muted repo-desc">
            <span className="skeleton" aria-hidden="true">A short description of this repository</span>
          </p>
        ) : (
          c?.description && <p className="muted repo-desc">{c.description}</p>
        )}
      </div>

      <nav className="tabs" aria-label="Repository lists">
        {tabs.map((t) => (
          <Link key={t.label} to={t.to} className={t.kind === kind ? "tab active" : "tab"}>
            {t.icon}
            {t.label}
            {t.count !== undefined ? (
              <span className="counter">{t.count.toLocaleString()}</span>
            ) : (
              counts.isPending && <span className="counter skeleton" aria-hidden="true">000</span>
            )}
          </Link>
        ))}
        <span className="grow" />
        <a className="btn sm repo-tab-btn" href={`https://github.com/${slug}`} target="_blank" rel="noopener noreferrer">
          <CodeIcon size={14} /> Code
        </a>
      </nav>

      <div className="repo-toolbar">
        <FilterInput value={q === DEFAULT_Q ? "" : q} onApply={(next) => setQ(next || DEFAULT_Q)} placeholder={DEFAULT_Q} />
        {kind !== "issue" && (
          <Link className={kind === "pr" ? "btn primary" : "btn"} to={`/${slug}/compare`}>
            New pull request
          </Link>
        )}
        {kind !== "pr" && (
          <Link className="btn primary" to={`/${slug}/issues/new`}>
            New issue
          </Link>
        )}
      </div>

      {counts.error && !c && <ErrorBanner error={counts.error} action={<button className="btn sm" onClick={() => void counts.refetch()}>Retry</button>} />}

      <SubjectList
        data={list.data}
        checks={list.checks}
        isPending={list.isPending}
        isFetching={list.isFetching}
        error={list.error}
        moreError={list.moreError}
        loadingMore={list.loadingMore}
        onRetry={() => void list.refetch()}
        loadMore={() => void list.loadMore()}
        showUpdated={sort.startsWith("updated")}
        empty={
          <>
            <h3 className="lr-empty-title">No results matched your search</h3>
            Try a different search query.
          </>
        }
        header={
          <>
            {(["open", "closed"] as const).map((s) => (
              <button key={s} className="repo-toggle" data-selected={state === s} onClick={() => setQ(setState(q, s))}>
                {s === "closed" ? <CheckIcon size={16} /> : kind === "pr" ? <GitPullRequestIcon size={16} /> : <IssueOpenedIcon size={16} />}
                {s === "open" ? "Open" : "Closed"}
                {stateCount(c, kind, s) !== undefined ? (
                  <span className="muted">{stateCount(c, kind, s)?.toLocaleString()}</span>
                ) : (
                  counts.isPending && <span className="skeleton" aria-hidden="true">000</span>
                )}
              </button>
            ))}
            <span className="grow" />
            <ListFilters owner={owner} repo={repo} kind={kind} q={q} setQ={setQ} sort={sort} items={list.data?.items} />
          </>
        }
      />
    </div>
  );
}
