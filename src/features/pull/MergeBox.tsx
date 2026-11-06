import {
  AlertIcon,
  CheckIcon,
  DotFillIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  TriangleDownIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { rest } from "@/api/client";
import { canWrite } from "@/api/types";
import { auth } from "@/auth/token";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Popover } from "@/components/Popover";
import { Spinner } from "@/components/Spinner";
import { useStore } from "@/lib/store";
import { deleteBranch, fetchMergeMessages, mergePull, patchPull, refreshPull, restoreBranch, setDraft, type MergeMethod, type PullMeta } from "./api";
import { CheckRow, sortChecks, summarize } from "./checks";
import { BranchName, plural } from "./util";

interface Props {
  pull: PullMeta;
  owner: string;
  repo: string;
  /** True once the latest fetch after mount has finished. */
  fetchedFresh: boolean;
  refetch: () => unknown;
}

type Tone = "success" | "danger" | "attention" | "muted" | "done";

/** The merge box under the PR conversation: reviews, checks, mergeability, and merge/branch actions. */
export function MergeBox({ pull, owner, repo, fetchedFresh, refetch }: Props) {
  const retried = useRef<string | null>(null);
  useEffect(() => {
    if (!fetchedFresh || pull.state !== "OPEN" || pull.mergeable !== "UNKNOWN" || retried.current === pull.headRefOid) return;
    const t = setTimeout(() => {
      retried.current = pull.headRefOid;
      refetch();
    }, 3000);
    return () => clearTimeout(t);
  }, [fetchedFresh, pull.state, pull.mergeable, pull.headRefOid, refetch]);

  if (pull.state !== "OPEN") return <ClosedBox pull={pull} owner={owner} repo={repo} />;
  const ready = !pull.isDraft && pull.mergeable === "MERGEABLE" && pull.mergeStateStatus !== "BLOCKED" && pull.mergeStateStatus !== "BEHIND";
  const iconTone: Tone = pull.isDraft ? "muted" : ready ? "success" : pull.mergeable === "CONFLICTING" ? "danger" : "muted";
  return (
    <div className="merge-box">
      <span className={`merge-box-badge ${iconTone}`}>{pull.isDraft ? <GitPullRequestDraftIcon size={20} /> : <GitMergeIcon size={20} />}</span>
      <div className="box merge-box-body">
        <ReviewSection pull={pull} />
        <ChecksSection pull={pull} owner={owner} repo={repo} />
        <MergeabilitySection pull={pull} owner={owner} repo={repo} />
        <MergeAction pull={pull} owner={owner} repo={repo} />
      </div>
    </div>
  );
}

function Section(props: { tone: Tone; icon: ReactNode; title: ReactNode; detail?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="merge-section">
      <div className="merge-section-head">
        <span className={`merge-section-icon ${props.tone}`}>{props.icon}</span>
        <div className="grow">
          <div className="merge-section-title">{props.title}</div>
          {props.detail && <div className="muted merge-section-detail">{props.detail}</div>}
        </div>
        {props.aside}
      </div>
      {props.children}
    </div>
  );
}

function Toggle({ open, onClick, labels }: { open: boolean; onClick: () => void; labels: [string, string] }) {
  return (
    <button className="btn invisible sm" onClick={onClick} aria-expanded={open}>
      {open ? labels[1] : labels[0]}
    </button>
  );
}

function ReviewSection({ pull }: { pull: PullMeta }) {
  const [open, setOpen] = useState(false);
  const reviews = pull.latestOpinionatedReviews.nodes.filter((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED");
  const approvals = reviews.filter((r) => r.state === "APPROVED").length;
  const changes = reviews.filter((r) => r.state === "CHANGES_REQUESTED").length;
  const pending = pull.reviewRequests.nodes.length;

  let tone: Tone;
  let title: string;
  let detail: string;
  if (changes) {
    tone = "danger";
    title = "Changes requested";
    detail = `${plural(changes, "review")} requesting changes by reviewers with write access.`;
  } else if (pull.reviewDecision === "REVIEW_REQUIRED") {
    tone = "attention";
    title = "Review required";
    detail = approvals
      ? `${plural(approvals, "approving review")} so far. More approvals are required by reviewers with write access.`
      : "At least 1 approving review is required by reviewers with write access.";
  } else if (approvals) {
    tone = "success";
    title = "Changes approved";
    detail = `${plural(approvals, "approving review")} by reviewers with write access.`;
  } else if (pending) {
    tone = "attention";
    title = "Review requested";
    detail = `Review has been requested from ${plural(pending, "reviewer")}.`;
  } else {
    tone = "muted";
    title = "No reviews";
    detail = pull.reviewDecision === null ? "Reviews are not required to merge." : "No reviews yet.";
  }
  const icon = tone === "success" ? <CheckIcon /> : tone === "danger" ? <FileDiffIcon /> : <DotFillIcon />;
  const people = [...reviews, ...pull.reviewRequests.nodes.map((n) => ({ state: "REQUESTED" as const, author: n.requestedReviewer }))];
  return (
    <Section
      tone={tone}
      icon={icon}
      title={title}
      detail={detail}
      aside={people.length > 0 && <Toggle open={open} onClick={() => setOpen(!open)} labels={["Show reviewers", "Hide"]} />}
    >
      {open && (
        <div className="merge-section-list">
          {people.map((r, i) => {
            const a = r.author;
            const name = !a ? "ghost" : "login" in a ? a.login : a.combinedSlug;
            return (
              <div key={i} className="check-row">
                <Avatar src={a?.avatarUrl} size={16} login={name} />
                <span className="grow truncate">
                  <strong>{name}</strong>{" "}
                  <span className="muted">
                    {r.state === "APPROVED" ? "approved these changes" : r.state === "CHANGES_REQUESTED" ? "requested changes" : "was requested for review"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ChecksSection({ pull, owner, repo }: { pull: PullMeta; owner: string; repo: string }) {
  const [open, setOpen] = useState(false);
  const checksPath = `/${owner}/${repo}/pull/${pull.number}/checks`;
  if (pull.checksForbidden)
    return (
      <Section
        tone="muted"
        icon={<AlertIcon />}
        title="Checks unavailable"
        detail={
          <>
            Your token can't read checks for this repository.{" "}
            <a href={`${pull.url}/checks`} target="_blank" rel="noopener noreferrer">
              View them on GitHub
            </a>
            .
          </>
        }
      />
    );
  const rollup = pull.rollup;
  if (!rollup || rollup.contexts.length === 0) return null;
  const s = summarize(rollup.contexts);
  return (
    <Section
      tone={s.outcome === "success" ? "success" : s.outcome === "failure" ? "danger" : "attention"}
      icon={s.outcome === "success" ? <CheckIcon /> : s.outcome === "failure" ? <XIcon /> : <DotFillIcon />}
      title={s.title}
      detail={s.detail}
      aside={<Toggle open={open} onClick={() => setOpen(!open)} labels={["Show all checks", "Hide all checks"]} />}
    >
      {open && (
        <div className="merge-section-list merge-checks">
          {sortChecks(rollup.contexts).map((c) => (
            <CheckRow key={c.id} check={c} showGroup />
          ))}
          {rollup.hasNextPage && (
            <div className="check-row muted">
              <Link to={checksPath}>{plural(rollup.totalCount - rollup.contexts.length, "more check")} on the Checks tab</Link>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function MergeabilitySection({ pull, owner, repo }: { pull: PullMeta; owner: string; repo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshPull(owner, repo, pull.number);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  const errorBanner = error != null && <ErrorBanner error={error} />;

  if (pull.isDraft)
    return (
      <Section
        tone="muted"
        icon={<GitPullRequestDraftIcon />}
        title="This pull request is still a work in progress"
        detail="Draft pull requests cannot be merged."
        aside={
          pull.viewerCanUpdate && (
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await setDraft(pull.id, false);
                  patchPull(owner, repo, pull.number, { isDraft: false });
                })
              }
            >
              {busy ? "Marking..." : "Ready for review"}
            </button>
          )
        }
      >
        {errorBanner}
      </Section>
    );
  if (pull.mergeable === "CONFLICTING")
    return (
      <Section
        tone="danger"
        icon={<XIcon />}
        title="This branch has conflicts that must be resolved"
        detail="Resolve conflicts on GitHub or with the command line."
        aside={
          <a className="btn sm" href={`${pull.url}/conflicts`} target="_blank" rel="noopener noreferrer">
            Resolve conflicts
          </a>
        }
      />
    );
  if (pull.mergeable === "UNKNOWN")
    return <Section tone="muted" icon={<Spinner size={14} />} title="Checking for the ability to merge automatically..." detail="Hang in there while we check the branch's status." />;
  if (pull.mergeStateStatus === "BEHIND")
    return (
      <Section
        tone="attention"
        icon={<AlertIcon />}
        title="This branch is out-of-date with the base branch"
        detail="Merge the latest changes from the base branch into this branch."
        aside={
          canWrite(pull.repository.viewerPermission) && (
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                run(() => rest(`/repos/${owner}/${repo}/pulls/${pull.number}/update-branch`, { method: "PUT", body: { expected_head_sha: pull.headRefOid } }))
              }
            >
              {busy ? "Updating..." : "Update branch"}
            </button>
          )
        }
      >
        {errorBanner}
      </Section>
    );
  if (pull.mergeStateStatus === "BLOCKED")
    return (
      <Section
        tone="danger"
        icon={<XIcon />}
        title="Merging is blocked"
        detail="The base branch requires all requirements to be met before merging."
      />
    );
  return <Section tone="success" icon={<CheckIcon />} title="No conflicts with base branch" detail="Merging can be performed automatically." />;
}

const METHODS: { method: MergeMethod; label: string; confirm: string; describe: (n: number) => string }[] = [
  { method: "MERGE", label: "Create a merge commit", confirm: "Confirm merge", describe: () => "All commits from this branch will be added to the base branch via a merge commit." },
  { method: "SQUASH", label: "Squash and merge", confirm: "Confirm squash and merge", describe: (n) => `The ${plural(n, "commit")} from this branch will be combined into one commit in the base branch.` },
  { method: "REBASE", label: "Rebase and merge", confirm: "Confirm rebase and merge", describe: (n) => `The ${plural(n, "commit")} from this branch will be rebased and added to the base branch.` },
];

const BUTTON_LABEL: Record<MergeMethod, string> = { MERGE: "Merge pull request", SQUASH: "Squash and merge", REBASE: "Rebase and merge" };

function allowedMethods(pull: PullMeta): MergeMethod[] {
  const s = pull.mergeSettings;
  return METHODS.map((m) => m.method).filter((m) => (m === "MERGE" ? s.mergeCommitAllowed : m === "SQUASH" ? s.squashMergeAllowed : s.rebaseMergeAllowed));
}

function MergeAction({ pull, owner, repo }: { pull: PullMeta; owner: string; repo: string }) {
  const allowed = allowedMethods(pull);
  const preferred = allowed.includes(pull.mergeSettings.viewerDefaultMergeMethod) ? pull.mergeSettings.viewerDefaultMergeMethod : allowed[0];
  const [method, setMethod] = useState<MergeMethod | undefined>(preferred);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bypass, setBypass] = useState(false);

  if (!canWrite(pull.repository.viewerPermission))
    return (
      <div className="merge-section merge-action muted">
        {pull.autoMergeRequest && <AutoMergeNote pull={pull} />}
        Only those with write access to this repository can merge pull requests.
      </div>
    );
  if (!method) return <div className="merge-section merge-action muted">No merge methods are allowed in this repository.</div>;

  const blocked = pull.mergeStateStatus === "BLOCKED" || pull.mergeStateStatus === "BEHIND";
  const canMerge = !pull.isDraft && pull.mergeable === "MERGEABLE" && (!blocked || (bypass && pull.viewerCanMergeAsAdmin));
  const green = canMerge && (pull.mergeStateStatus === "CLEAN" || pull.mergeStateStatus === "HAS_HOOKS");

  if (confirming && canMerge) return <MergeConfirm pull={pull} owner={owner} repo={repo} method={method} onCancel={() => setConfirming(false)} />;

  return (
    <div className="merge-section merge-action">
      {pull.autoMergeRequest && <AutoMergeNote pull={pull} />}
      {blocked && pull.viewerCanMergeAsAdmin && !pull.isDraft && (
        <label className="row merge-bypass">
          <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
          Merge without waiting for requirements to be met (bypass rules)
        </label>
      )}
      <div className="row">
        <div className="btn-group">
          <button className={`btn ${green ? "primary" : ""} ${bypass ? "danger" : ""}`} disabled={!canMerge} onClick={() => setConfirming(true)}>
            {bypass ? "Bypass rules and merge" : BUTTON_LABEL[method]}
          </button>
          <button
            className={`btn icon ${green ? "primary" : ""}`}
            disabled={!canMerge || allowed.length < 2}
            aria-label="Select merge method"
            onClick={(e) => setMenu(menu ? null : e.currentTarget)}
          >
            <TriangleDownIcon />
          </button>
        </div>
        <span className="muted merge-hint">
          You can also merge this with the command line.{" "}
          <a href={pull.url} target="_blank" rel="noopener noreferrer">
            Open on GitHub
          </a>
        </span>
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={340}>
          <div className="select-menu-list">
            {METHODS.filter((m) => allowed.includes(m.method)).map((m) => (
              <button
                key={m.method}
                className="select-menu-item merge-method"
                onClick={() => {
                  setMethod(m.method);
                  setMenu(null);
                }}
              >
                <span className="check">{m.method === method && <CheckIcon />}</span>
                <span>
                  <strong>{m.label}</strong>
                  <div className="muted">{m.describe(pull.commits.totalCount)}</div>
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function AutoMergeNote({ pull }: { pull: PullMeta }) {
  const a = pull.autoMergeRequest!;
  return (
    <div className="merge-auto">
      <strong>Auto-merge enabled</strong>
      {a.enabledBy && <> by {a.enabledBy.login}</>}. This pull request will be merged ({BUTTON_LABEL[a.mergeMethod].toLowerCase()}) when all requirements are met.
    </div>
  );
}

function MergeConfirm({ pull, owner, repo, method, onCancel }: { pull: PullMeta; owner: string; repo: string; method: MergeMethod; onCancel: () => void }) {
  const needsMessage = method !== "REBASE";
  const messages = useQuery({
    queryKey: ["merge-messages", owner, repo, pull.number, pull.headRefOid],
    queryFn: () => fetchMergeMessages(owner, repo, pull.number),
    enabled: needsMessage,
    staleTime: Infinity,
  });
  const defaults = needsMessage ? messages.data?.[method as "MERGE" | "SQUASH"] : undefined;
  const [headline, setHeadline] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const loading = needsMessage && !messages.data && !messages.error;
  const headlineValue = headline ?? defaults?.headline ?? "";
  const bodyValue = body ?? defaults?.body ?? "";

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      await mergePull({
        pullRequestId: pull.id,
        mergeMethod: method,
        expectedHeadOid: pull.headRefOid,
        ...(needsMessage ? { commitHeadline: headlineValue, commitBody: bodyValue } : {}),
      });
      await refreshPull(owner, repo, pull.number);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const confirmLabel = METHODS.find((m) => m.method === method)!.confirm;
  return (
    <div className="merge-section merge-confirm">
      {needsMessage && (
        <>
          <label className="merge-field-label" htmlFor="merge-headline">
            Commit message
          </label>
          <input
            id="merge-headline"
            className="input"
            value={headlineValue}
            disabled={loading || busy}
            placeholder={loading ? "Loading..." : ""}
            onChange={(e) => setHeadline(e.target.value)}
          />
          <label className="merge-field-label" htmlFor="merge-body">
            Extended description
          </label>
          <textarea
            id="merge-body"
            className="input"
            rows={Math.min(12, Math.max(3, bodyValue.split("\n").length + 1))}
            value={bodyValue}
            disabled={loading || busy}
            onChange={(e) => setBody(e.target.value)}
          />
        </>
      )}
      {messages.error != null && <ErrorBanner error={messages.error} />}
      {error != null && <ErrorBanner error={error} />}
      <div className="row">
        <button className="btn primary" disabled={loading || busy || (needsMessage && !headlineValue.trim())} onClick={merge}>
          {busy ? "Merging..." : confirmLabel}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ClosedBox({ pull, owner, repo }: { pull: PullMeta; owner: string; repo: string }) {
  const { viewer } = useStore(auth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const merged = pull.state === "MERGED";
  const headRepo = pull.headRepository;
  const canManageBranch =
    !!headRepo && (pull.isCrossRepository ? headRepo.owner.login === viewer?.login : canWrite(pull.repository.viewerPermission));
  const exists = !!pull.headRef;
  const branch = <BranchName name={pull.headRefName} owner={pull.isCrossRepository ? headRepo?.owner.login : undefined} />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshPull(owner, repo, pull.number);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  const action =
    canManageBranch &&
    (exists ? (
      <button
        className="btn sm"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await deleteBranch(pull.headRef!.id);
            patchPull(owner, repo, pull.number, { headRef: null });
          })
        }
      >
        <GitBranchIcon /> {busy ? "Deleting..." : "Delete branch"}
      </button>
    ) : (
      <button
        className="btn sm"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const ref = await restoreBranch(headRepo!.owner.login, headRepo!.name, pull.headRefName, pull.headRefOid);
            patchPull(owner, repo, pull.number, { headRef: { id: (ref as { node_id: string }).node_id } });
          })
        }
      >
        <GitBranchIcon /> {busy ? "Restoring..." : "Restore branch"}
      </button>
    ));

  const title = merged ? "Pull request successfully merged and closed" : "Closed with unmerged commits";
  const detail = !headRepo ? (
    "The head repository was deleted."
  ) : exists ? (
    merged ? (
      <>You're all set. The {branch} branch can be safely deleted.</>
    ) : (
      <>This pull request is closed, but the {branch} branch has unmerged commits.</>
    )
  ) : (
    <>The {branch} branch was deleted.</>
  );
  return (
    <div className="merge-box">
      <span className={`merge-box-badge ${merged ? "done" : "danger"}`}>{merged ? <GitMergeIcon size={20} /> : <GitPullRequestClosedIcon size={20} />}</span>
      <div className="box merge-box-body">
        <Section tone={merged ? "done" : "danger"} icon={merged ? <GitMergeIcon /> : <XIcon />} title={title} detail={detail} aside={action}>
          {error != null && <ErrorBanner error={error} />}
        </Section>
      </div>
    </div>
  );
}
