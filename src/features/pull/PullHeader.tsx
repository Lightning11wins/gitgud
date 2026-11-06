import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { RelativeTime } from "@/components/RelativeTime";
import { StateBadge } from "@/components/StateBadge";
import { ReviewSubmitButton } from "@/features/review/ReviewSubmit";
import { patchPull, refreshPull, updateTitle, type PullMeta } from "./api";
import { BranchName, CopyButton, plural } from "./util";

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
              <span className="pull-title-text">{pull.title}</span> <span className="muted pull-number">#{pull.number}</span>
            </h1>
            <div className="pull-title-actions">
              {pull.viewerCanUpdate && (
                <button className="btn sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
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
                <strong>{pull.title}</strong> <span className="muted">#{pull.number}</span>
              </div>
              <div className="truncate muted pull-sticky-sub">
                <BranchSummary pull={pull} owner={owner} repo={repo} compact />
              </div>
            </div>
            {pull.state === "OPEN" && <ReviewSubmitButton owner={owner} repo={repo} number={pull.number} pullId={pull.id} />}
          </div>
        </div>
      )}
    </>
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
      <BranchName name={pull.headRefName} owner={headLabel} href={headHref} />
      {!compact && <CopyButton text={pull.headRefName} label="Copy head branch name" />}
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
  const [value, setValue] = useState(pull.title);
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
    if (title === pull.title) return onDone();
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
