import { CheckIcon, CommentIcon, DotFillIcon, FileDiffIcon, GearIcon, PeopleIcon, SyncIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SelectMenu } from "@/components/SelectMenu";
import { canTriage } from "@/api/types";
import {
  fetchReviewerCandidates,
  patchPull,
  refreshPull,
  removeReviewRequests,
  requestReviews,
  reviewerCandidatesKey,
  setDraft,
  type Candidate,
  type PullMeta,
  type Reviewer,
  type ReviewState,
} from "./api";

interface Props {
  pull: PullMeta;
  owner: string;
  repo: string;
}

interface Row {
  key: string;
  name: string;
  avatarUrl: string | null;
  url: string;
  requested: boolean;
  state?: ReviewState;
  /** User id or team id for re-requesting. */
  id?: string;
  isTeam: boolean;
}

function reviewerKey(r: Reviewer): string {
  return r.__typename === "Team" ? r.combinedSlug : r.login;
}

function buildRows(pull: PullMeta): Row[] {
  const rows = new Map<string, Row>();
  for (const review of pull.latestReviews.nodes) {
    const a = review.author;
    if (!a || review.state === "PENDING" || a.login === pull.author?.login) continue;
    rows.set(a.login, { key: a.login, name: a.login, avatarUrl: a.avatarUrl, url: a.url, requested: false, state: review.state, id: a.id, isTeam: false });
  }
  for (const { requestedReviewer: r } of pull.reviewRequests.nodes) {
    if (!r) continue;
    const key = reviewerKey(r);
    const prev = rows.get(key);
    rows.set(key, {
      key,
      name: r.__typename === "Team" ? r.combinedSlug : r.login,
      avatarUrl: r.avatarUrl,
      url: r.url,
      requested: true,
      state: prev?.state,
      id: r.id,
      isTeam: r.__typename === "Team",
    });
  }
  return [...rows.values()];
}

function StateIcon({ row }: { row: Row }) {
  if (row.requested) return <DotFillIcon className="review-state pending" aria-label="Awaiting requested review" />;
  if (row.state === "APPROVED") return <CheckIcon className="review-state approved" aria-label="Approved these changes" />;
  if (row.state === "CHANGES_REQUESTED") return <FileDiffIcon className="review-state changes" aria-label="Requested changes" />;
  return <CommentIcon className="review-state muted" aria-label="Left review comments" />;
}

const STATE_TITLE: Record<string, string> = {
  APPROVED: "Approved these changes",
  CHANGES_REQUESTED: "Requested changes",
  COMMENTED: "Left review comments",
  DISMISSED: "Review dismissed",
};

/** The PR sidebar's Reviewers section: requested reviewers, their latest review state, and the request picker. */
export function Reviewers({ pull, owner, repo }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<unknown>(null);
  const editable = canTriage(pull.repository.viewerPermission) && pull.state === "OPEN";
  const candidates = useQuery({
    queryKey: reviewerCandidatesKey(owner, repo),
    queryFn: () => fetchReviewerCandidates(owner, repo),
    enabled: !!anchor,
    staleTime: 5 * 60_000,
  });
  const rows = buildRows(pull);
  const requested = pull.reviewRequests.nodes.map((n) => n.requestedReviewer).filter((r): r is Reviewer => !!r);

  const apply = async (selected: string[]) => {
    const before = new Set(requested.map((r) => r.id));
    const after = new Set(selected);
    const all = candidates.data ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const added = selected.filter((id) => !before.has(id)).map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
    const removed = requested.filter((r) => !after.has(r.id));
    setError(null);
    patchPull(owner, repo, pull.number, {
      reviewRequests: {
        nodes: [
          ...pull.reviewRequests.nodes.filter((n) => n.requestedReviewer && after.has(n.requestedReviewer.id)),
          ...added.map((c) => ({ requestedReviewer: candidateToReviewer(c) })),
        ],
      },
    });
    try {
      const users = added.filter((c) => c.kind === "user").map((c) => c.id);
      const teams = added.filter((c) => c.kind === "team").map((c) => c.id);
      if (users.length || teams.length) await requestReviews(pull.id, users, teams);
      if (removed.length) {
        const logins = removed.filter((r) => r.__typename !== "Team").map((r) => (r as { login: string }).login);
        const slugs = removed.flatMap((r) => (r.__typename === "Team" ? [r.slug] : []));
        await removeReviewRequests(owner, repo, pull.number, logins, slugs);
      }
    } catch (e) {
      setError(e);
    }
    refreshPull(owner, repo, pull.number);
  };

  const rerequest = async (row: Row, id: string) => {
    setError(null);
    try {
      await requestReviews(pull.id, row.isTeam ? [] : [id], row.isTeam ? [id] : []);
    } catch (e) {
      setError(e);
    }
    refreshPull(owner, repo, pull.number);
  };

  return (
    <section className="pull-sidebar-section">
      <div className="pull-sidebar-heading row">
        <span className="grow">Reviewers</span>
        {editable && (
          <button className="btn invisible xs icon" aria-label="Request reviewers" title="Request reviewers" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
            <GearIcon />
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="muted pull-sidebar-empty">No reviews</div>
      ) : (
        <ul className="pull-reviewer-list">
          {rows.map((row) => (
            <li key={row.key} className="row" title={row.requested ? "Awaiting requested review" : STATE_TITLE[row.state ?? ""]}>
              {row.isTeam && !row.avatarUrl ? <PeopleIcon size={20} /> : <Avatar src={row.avatarUrl} size={20} login={row.name} />}
              <a className="grow truncate pull-reviewer-name" href={row.url} target="_blank" rel="noopener noreferrer">
                {row.name}
              </a>
              {editable && !row.requested && row.id && (
                <button
                  className="btn invisible xs icon"
                  title="Re-request review"
                  aria-label={`Re-request review from ${row.name}`}
                  onClick={() => rerequest(row, row.id!)}
                >
                  <SyncIcon size={14} />
                </button>
              )}
              <StateIcon row={row} />
            </li>
          ))}
        </ul>
      )}
      {error != null && <ErrorBanner error={error} />}
      {pull.state === "OPEN" && !pull.isDraft && pull.viewerCanUpdate && <ConvertToDraft pull={pull} owner={owner} repo={repo} />}
      {anchor && (
        <SelectMenu<Candidate>
          anchor={anchor}
          title="Request up to 15 reviewers"
          items={candidates.data?.filter((c) => c.kind === "team" || c.login !== pull.author?.login)}
          getKey={(c) => c.id}
          getText={(c) => (c.kind === "user" ? `${c.login} ${c.name ?? ""}` : `${c.combinedSlug} ${c.name}`)}
          renderItem={(c) => (
            <>
              {c.kind === "team" && !c.avatarUrl ? <PeopleIcon size={20} /> : <Avatar src={c.avatarUrl} size={20} />}
              <span className="truncate">
                <strong>{c.kind === "user" ? c.login : c.combinedSlug}</strong> <span className="muted">{c.name}</span>
              </span>
            </>
          )}
          initial={requested.map((r) => r.id)}
          multiple
          onApply={apply}
          onClose={() => setAnchor(null)}
        />
      )}
      {candidates.error != null && anchor && <ErrorBanner error={candidates.error} />}
    </section>
  );
}

function candidateToReviewer(c: Candidate): Reviewer {
  return c.kind === "user"
    ? { __typename: "User", id: c.id, login: c.login, avatarUrl: c.avatarUrl, url: `https://github.com/${c.login}` }
    : { __typename: "Team", id: c.id, name: c.name, slug: c.slug, combinedSlug: c.combinedSlug, url: "", avatarUrl: c.avatarUrl };
}

function ConvertToDraft({ pull, owner, repo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="pull-sidebar-note muted">
      Still in progress?{" "}
      <button
        className="pull-link-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await setDraft(pull.id, true);
            patchPull(owner, repo, pull.number, { isDraft: true });
            await refreshPull(owner, repo, pull.number);
          } catch (e) {
            setError(e);
          }
          setBusy(false);
        }}
      >
        {busy ? "Converting..." : "Convert to draft"}
      </button>
      {error != null && <ErrorBanner error={error} />}
    </div>
  );
}
