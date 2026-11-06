import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { gql, isNotFound } from "@/api/client";
import { ErrorBanner } from "@/components/ErrorBanner";
import { NotFound } from "@/components/NotFound";
import { RelativeTime } from "@/components/RelativeTime";
import { Spinner } from "@/components/Spinner";
import { TitleText } from "@/components/TitleText";
import { StateBadge } from "@/components/StateBadge";
import { invalidateSubject, patchSubject } from "@/features/conversation/mutations";
import { Timeline } from "@/features/conversation/Timeline";
import { MetadataSidebar } from "@/features/sidebar/MetadataSidebar";
import { useIssueMeta, type IssueMeta } from "./issueData";
import "./issue.css";
import { useTitle } from "@/lib/useTitle";

export function IssuePage() {
  const params = useParams();
  const owner = params.owner!;
  const repo = params.repo!;
  const number = Number(params.number);
  const navigate = useNavigate();
  const { hash } = useLocation();
  const meta = useIssueMeta(owner, repo, number);
  const isPull = meta.data?.__typename === "PullRequest";

  useEffect(() => {
    if (isPull) navigate(`/${owner}/${repo}/pull/${number}${hash}`, { replace: true });
  }, [isPull, owner, repo, number, hash, navigate]);

  const title = meta.data && !isPull ? (meta.data as IssueMeta).title : undefined;
  useTitle(title, `Issue #${number}`, `${owner}/${repo}`);

  if (!Number.isInteger(number) || number <= 0) return <ErrorBanner error={`Failed to open issue "${params.number}": not a number`} />;
  if (meta.isPending)
    return (
      <div className="blankslate">
        <Spinner size={20} label="Loading issue" />
      </div>
    );
  if (meta.error && !meta.data && isNotFound(meta.error)) return <NotFound title={`Issue #${number} doesn't exist in ${owner}/${repo}, or your token can't see it`} />;
  if (meta.error && !meta.data) return <ErrorBanner error={meta.error} action={<button className="btn sm" onClick={() => meta.refetch()}>Retry</button>} />;
  if (isPull || !meta.data) return null;
  const issue = meta.data as IssueMeta;

  return (
    <div className="issue-page" key={`${owner}/${repo}#${number}`}>
      <IssueHeader issue={issue} owner={owner} repo={repo} />
      <div className="issue-layout">
        <Timeline owner={owner} repo={repo} number={number} kind="issue" subject={issue} />
        <MetadataSidebar subject={issue} owner={owner} repo={repo} />
      </div>
    </div>
  );
}

function IssueHeader({ issue, owner, repo }: { issue: IssueMeta; owner: string; repo: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [stuck, setStuck] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: "-48px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const save = async () => {
    const title = draft.trim();
    if (!title || title === issue.title) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await gql(`mutation UpdateIssueTitle($id: ID!, $title: String!) { updateIssue(input: { id: $id, title: $title }) { issue { id } } }`, { id: issue.id, title });
      patchSubject("issue", owner, repo, issue.number, () => ({ title }));
      invalidateSubject("issue", owner, repo, issue.number);
      setEditing(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const state = <StateBadge kind="issue" state={issue.state} stateReason={issue.stateReason} />;
  const comments = issue.comments.totalCount;

  return (
    <>
      <div className="issue-header" ref={ref}>
        {editing ? (
          <form
            className="row issue-title-edit"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              className="input grow"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              aria-label="Title"
            />
            <button className="btn" disabled={busy}>
              Save
            </button>
            <button type="button" className="btn invisible" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="row issue-title-row">
            <h1 className="issue-title grow">
              <bdi><TitleText text={issue.title} /></bdi> <span className="muted">#{issue.number}</span>
            </h1>
            {issue.viewerCanUpdate && (
              <button
                className="btn sm"
                onClick={() => {
                  setDraft(issue.title);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
          </div>
        )}
        {error != null && <ErrorBanner error={error} />}
        <div className="row issue-subtitle">
          {state}
          <span className="muted">
            <a className="issue-author" href={issue.author?.url} target="_blank" rel="noopener noreferrer">
              {issue.author?.login ?? "ghost"}
            </a>{" "}
            opened this issue <RelativeTime date={issue.createdAt} /> · {comments} comment{comments === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {stuck && (
        <div className="issue-sticky">
          <div className="issue-sticky-inner row">
            <StateBadge kind="issue" state={issue.state} stateReason={issue.stateReason} small />
            <strong className="truncate"><TitleText text={issue.title} /></strong>
            <span className="muted">#{issue.number}</span>
          </div>
        </div>
      )}
    </>
  );
}
