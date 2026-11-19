import { PencilIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RelativeTime } from "@/components/RelativeTime";
import { StateBadge } from "@/components/StateBadge";
import { TitleText } from "@/components/TitleText";
import { ReviewSubmitButton } from "@/features/review/ReviewSubmit";
import { patchPull, refreshPull, updateTitle, type PullMeta } from "./api";
import { dependencyNumbers, useDependencyBase } from "./dependencies";
import { BranchName, CopyButton, plural } from "./util";
import { tooltip } from "@/lib/tooltip";

interface Props {
  pull: PullMeta;
  owner: string;
  repo: string;
}

export function PullHeader({ pull, owner, repo }: Props) {
  const [editing, setEditing] = useState(false);
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 60), {
      rootMargin: "-48px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const badge = <StateBadge kind="pull" state={pull.state} isDraft={pull.isDraft} small={stuck} />;
  return (
    <>
      <header className="pull-header">
        {editing ? (
          <TitleEditor pull={pull} owner={owner} repo={repo} onDone={() => setEditing(false)} />
        ) : (
          <div className="pull-title-row">
            <h1 className="pull-title">
              <span className="pull-title-text"><TitleText text={pull.title} /></span> <span className="muted pull-number">#{pull.number}</span>
              {pull.viewerCanUpdate && (
                <button className="btn invisible sm icon pull-title-edit-btn" {...tooltip("Edit title", "label")} onClick={() => setEditing(true)}>
                  <PencilIcon />
                </button>
              )}
            </h1>
            <div className="pull-title-actions">
              {pull.state === "OPEN" && <DependencyDiffButton pull={pull} owner={owner} repo={repo} />}
              {pull.state === "OPEN" && <ReviewSubmitButton owner={owner} repo={repo} number={pull.number} pullId={pull.id} />}
            </div>
          </div>
        )}
        <div className="pull-subtitle">
          <StateBadge kind="pull" state={pull.state} isDraft={pull.isDraft} />
          <BranchSummary pull={pull} owner={owner} repo={repo} />
        </div>
        <div ref={sentinel} />
      </header>
      {stuck && (
        <div className="pull-sticky">
          <div className="pull-sticky-inner">
            {badge}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="truncate">
                <strong><TitleText text={pull.title} /></strong> <span className="muted">#{pull.number}</span>
              </div>
              <div className="truncate muted pull-sticky-sub">
                <BranchSummary pull={pull} owner={owner} repo={repo} compact />
              </div>
            </div>
            {pull.state === "OPEN" && <DependencyDiffButton pull={pull} owner={owner} repo={repo} />}
            {pull.state === "OPEN" && <ReviewSubmitButton owner={owner} repo={repo} number={pull.number} pullId={pull.id} />}
          </div>
        </div>
      )}
    </>
  );
}

/** Default branch names: a PR into one shows its unmerged dependencies' changes in its diff. */
const DEPENDENT_BASES = new Set(["main", "master"]);

/** Links to the PR's changes compared with the branch of the unmerged PR it says it "Depends on". */
function DependencyDiffButton({ pull, owner, repo }: Props) {
  const numbers = useMemo(() => (DEPENDENT_BASES.has(pull.baseRefName) ? dependencyNumbers(pull.body) : []), [pull.baseRefName, pull.body]);
  const { data, error } = useDependencyBase(owner, repo, pull.baseRefName, numbers);
  if (!numbers.length || data === null) return null;
  const label = "Without dependencies";
  const dep = data && "pull" in data ? data.pull : undefined;
  let problem: string | undefined;
  if (error) problem = error instanceof Error ? error.message : String(error);
  else if (!data) problem = "Loading dependencies";
  else if ("problem" in data) problem = data.problem;
  else if (pull.isCrossRepository) problem = "This pull request's branch is on a fork";
  else if (!pull.headRef) problem = "This pull request's branch was deleted";
  if (problem || !dep) {
    return (
      <button className="btn sm" disabled {...tooltip(problem)}>
        {label}
      </button>
    );
  }
  return (
    <Link className="btn sm" to={`/${owner}/${repo}/compare/${dep.headRefName}...${pull.headRefName}`} {...tooltip(`Compare with #${dep.number}'s branch, ${dep.headRefName}`)}>
      {label}
    </Link>
  );
}

function BranchSummary({ pull, owner, repo, compact }: Props & { compact?: boolean }) {
  const headOwner = pull.headRepository?.owner.login;
  const headRepo = pull.headRepository?.name;
  const headLabel = pull.isCrossRepository ? headOwner : undefined;
  const headHref = headOwner && headRepo && pull.headRef ? `https://github.com/${headOwner}/${headRepo}/tree/${pull.headRefName}` : undefined;
  const author = pull.author?.login ?? "ghost";
  const merged = pull.state === "MERGED";
  return (
    <span className="pull-branch-summary">
      <strong>{merged ? (pull.mergedBy?.login ?? author) : author}</strong> {merged ? "merged" : "wants to merge"} {plural(pull.commits.totalCount, "commit")} into{" "}
      <BranchName name={pull.baseRefName} href={`https://github.com/${owner}/${repo}/tree/${pull.baseRefName}`} /> from{" "}
      {compact ? (
        <BranchName name={pull.headRefName} owner={headLabel} href={headHref} />
      ) : (
        <span className="pull-head-ref">
          <BranchName name={pull.headRefName} owner={headLabel} href={headHref} />
          <CopyButton text={pull.headRefName} label="Copy head branch name" />
        </span>
      )}
      {merged && pull.mergedAt && !compact && (
        <span className="muted">
          {" "}
          <RelativeTime date={pull.mergedAt} />
        </span>
      )}
    </span>
  );
}

function TitleEditor({ pull, owner, repo, onDone }: { pull: PullMeta; owner: string; repo: string; onDone: () => void }) {
  // The title when editing began, to tell whether the user changed it.
  const [start] = useState(pull.title);
  const [value, setValue] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const save = async () => {
    const title = value.trim();
    if (!title) return;
    if (title === start) return onDone();
    setSaving(true);
    setError(null);
    const previous = pull.title;
    try {
      patchPull(owner, repo, pull.number, { title });
      await updateTitle(pull.id, title);
      onDone();
      refreshPull(owner, repo, pull.number);
    } catch (e) {
      patchPull(owner, repo, pull.number, { title: previous });
      setError(e);
      setSaving(false);
    }
  };

  return (
    <div className="pull-title-edit">
      <div className="row">
        <input
          ref={ref}
          className="input grow"
          value={value}
          aria-label="Title"
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              e.preventDefault();
              onDone();
            }
          }}
        />
        <button className="btn" onClick={save} disabled={saving || !value.trim()}>
          Save
        </button>
        <button className="btn invisible" onClick={onDone} disabled={saving}>
          Cancel
        </button>
      </div>
      {error != null && <ErrorBanner error={error} />}
    </div>
  );
}
