import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { RepoForkedIcon, RepoIcon, SearchIcon } from "@primer/octicons-react";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RelativeTime } from "@/components/RelativeTime";
import { Spinner } from "@/components/Spinner";
import { useOwner, type OwnerRepo } from "./ownerData";
import { useTitle } from "@/lib/useTitle";
import "./owner.css";

const ROW_HEIGHT = 48;
const VISIBILITY = { PUBLIC: "Public", PRIVATE: "Private", INTERNAL: "Internal" } as const;

export function OwnerPage() {
  const { owner: login = "" } = useParams();
  useTitle(login);
  const [params, setParams] = useSearchParams();
  const filter = params.get("q") ?? "";
  const deferred = useDeferredValue(filter.trim().toLowerCase());
  const query = useOwner(login);
  const data = query.data;

  const repos = useMemo(() => {
    const all = data?.repos ?? [];
    if (!deferred) return all;
    return all.filter((r) => r.name.toLowerCase().includes(deferred) || r.description?.toLowerCase().includes(deferred));
  }, [data?.repos, deferred]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const top = (bodyRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (Math.abs(top - margin) > 0.5) setMargin(top);
  });
  const virtualizer = useWindowVirtualizer({ count: repos.length, estimateSize: () => ROW_HEIGHT, overscan: 8, scrollMargin: margin });

  const info = data?.owner;
  const about = info?.description ?? info?.bio;
  const loading = !data?.complete && !query.error;

  return (
    <div className="owner">
      <div className="owner-head">
        <Avatar src={info?.avatarUrl} size={48} login={login} />
        <div className="owner-id">
          <h1 className="owner-name">
            {info?.name && <strong>{info.name}</strong>}
            <span className={info?.name ? "muted" : undefined}>{info?.login ?? login}</span>
          </h1>
          {about && <p className="muted owner-desc">{about}</p>}
        </div>
      </div>

      {query.error && (
        <ErrorBanner
          error={query.error}
          action={
            <button className="btn sm" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      )}

      <div className="box owner-box">
        <div className="box-header row owner-header">
          <div className="owner-filter">
            <SearchIcon size={14} />
            <input
              className="input sm"
              value={filter}
              placeholder="Find a repository"
              spellCheck={false}
              aria-label="Filter repositories"
              onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
              onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            />
          </div>
          <span className="muted owner-count">
            {data && (deferred ? `${repos.length.toLocaleString()} of ` : "") + `${data.total.toLocaleString()} repositories`}
          </span>
          {(loading || query.isFetching) && <Spinner label="Loading repositories" />}
        </div>
        <div ref={bodyRef}>
          {data && !repos.length && !loading ? (
            <div className="blankslate">{deferred ? "No repositories match this filter." : "No repositories."}</div>
          ) : (
            <div className="owner-body" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((v) => (
                <RepoRow
                  key={repos[v.index].name}
                  owner={info?.login ?? login}
                  repo={repos[v.index]}
                  style={{ height: v.size, transform: `translateY(${v.start - margin}px)` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const RepoRow = memo(function RepoRow({ owner, repo, style }: { owner: string; repo: OwnerRepo; style: CSSProperties }) {
  const Icon = repo.isFork ? RepoForkedIcon : RepoIcon;
  return (
    <div className="owner-row" style={style}>
      <Icon size={16} className="muted owner-icon" />
      <div className="owner-main">
        <div className="owner-title">
          <Link className="owner-link truncate" to={`/${owner}/${repo.name}`}>
            {repo.name}
          </Link>
          <span className="label owner-label">{VISIBILITY[repo.visibility]}</span>
          {repo.isArchived && <span className="label owner-label archived">Archived</span>}
          {repo.isFork && <span className="label owner-label">Fork</span>}
        </div>
        <div className="muted truncate owner-repo-desc">{repo.description}</div>
      </div>
      <div className="owner-meta muted">
        {repo.primaryLanguage && (
          <span className="owner-lang">
            <span className="owner-lang-dot" style={{ background: repo.primaryLanguage.color ?? "var(--fg-subtle)" }} />
            {repo.primaryLanguage.name}
          </span>
        )}
        <span className="owner-pushed">{repo.pushedAt && <RelativeTime date={repo.pushedAt} prefix="Updated" />}</span>
      </div>
    </div>
  );
});
