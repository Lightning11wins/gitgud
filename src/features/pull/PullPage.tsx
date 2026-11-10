import { ChecklistIcon, CommentDiscussionIcon, FileDiffIcon, GitCommitIcon } from "@primer/octicons-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { isNotFound } from "@/api/client";
import { ErrorBanner } from "@/components/ErrorBanner";
import { NotFound } from "@/components/NotFound";
import { SubjectSeed } from "@/features/conversation/SubjectSeed";
import { Timeline } from "@/features/conversation/Timeline";
import { prefetchPullFiles } from "@/features/diff/data";
import { FilesChanged } from "@/features/diff/FilesChanged";
import { MetadataSidebar } from "@/features/sidebar/MetadataSidebar";
import { HotkeysActive } from "@/lib/hotkeys";
import { prefetchCommits, usePull } from "./api";
import { useCheckPolling } from "./checkPolling";
import { ChecksTab } from "./ChecksTab";
import { CommitView } from "./CommitView";
import { CommitsTab } from "./CommitsTab";
import { ComparePage } from "./ComparePage";
import { MergeBox } from "./MergeBox";
import { PullHeader } from "./PullHeader";
import { Reviewers } from "./Reviewers";
import "./pull.css";
import { useTitle } from "@/lib/useTitle";

type Tab = "conversation" | "commits" | "checks" | "files";
const KEPT_TABS: Tab[] = ["conversation", "commits", "checks", "files"];
const FILES_PREFETCH_DELAY_MS = 2000;

function parseTab(rest: string): { tab: Tab; sha?: string } {
  const [first, second] = rest.split("/");
  if (first === "files") return { tab: "files" };
  if (first === "checks") return { tab: "checks" };
  if (first === "commits") return second ? { tab: "commits", sha: second } : { tab: "commits" };
  return { tab: "conversation" };
}

export function PullPage() {
  const { owner = "", repo = "", number: num = "", "*": rest = "" } = useParams();
  if (num === "new") return <ComparePage head={rest} />;
  const number = Number(num);
  if (!Number.isInteger(number) || number <= 0) return <NotFound />;
  return <PullView key={`${owner}/${repo}#${number}`} owner={owner} repo={repo} number={number} rest={rest} />;
}

function PullView({ owner, repo, number, rest }: { owner: string; repo: string; number: number; rest: string }) {
  const q = usePull(owner, repo, number);
  useCheckPolling(owner, repo, number, q.data);
  useTitle(q.data?.title, `Pull request #${number}`, `${owner}/${repo}`);
  const { tab, sha } = parseTab(rest);
  const view = sha ? `commit:${sha}` : tab;
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const scrollByView = useRef(new Map<string, number>());
  const lastView = useRef(view);

  useEffect(() => {
    if (!sha) setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab, sha]);

  // Files changed is the likeliest next tab; load it once the page settles.
  const loaded = !!q.data;
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => prefetchPullFiles(owner, repo, number, "background"), FILES_PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, owner, repo, number]);

  // Each tab keeps its own scroll position, capped to the top of the tab bar.
  useLayoutEffect(() => {
    if (lastView.current === view) return;
    scrollByView.current.set(lastView.current, window.scrollY);
    lastView.current = view;
    const tabsTop = (document.querySelector(".pull-tabs") as HTMLElement | null)?.offsetTop ?? 0;
    const saved = scrollByView.current.get(view);
    const target = saved ?? Math.min(window.scrollY, Math.max(0, tabsTop - 60));
    window.scrollTo(0, target);
  }, [view]);

  if (!q.data) {
    if (q.error && isNotFound(q.error)) return <NotFound title={`Pull request #${number} doesn't exist in ${owner}/${repo}, or your token can't see it`} />;
    if (q.error) return <ErrorBanner error={q.error} action={<button className="btn sm" onClick={() => q.refetch()}>Retry</button>} />;
    return <SubjectSeed kind="pull" owner={owner} repo={repo} number={number} />;
  }
  const pull = q.data;
  const base = `/${owner}/${repo}/pull/${number}`;
  const checkCount = pull.rollup?.totalCount ?? 0;
  const panel = (t: Tab, node: ReactNode) =>
    KEPT_TABS.includes(t) && (visited.has(t) || (tab === t && !sha)) ? (
      <div key={t} hidden={tab !== t || !!sha}>
        <HotkeysActive.Provider value={tab === t && !sha}>{node}</HotkeysActive.Provider>
      </div>
    ) : null;

  return (
    <div className="pull-page">
      {q.error != null && <ErrorBanner error={q.error} />}
      <PullHeader pull={pull} owner={owner} repo={repo} />
      <nav className="tabs pull-tabs">
        <TabLink to={base} active={tab === "conversation"} icon={<CommentDiscussionIcon />} label="Conversation" count={pull.totalCommentsCount} />
        <TabLink
          to={`${base}/commits`}
          active={tab === "commits"}
          icon={<GitCommitIcon />}
          label="Commits"
          count={pull.commits.totalCount}
          onIntent={() => prefetchCommits(owner, repo, number)}
        />
        <TabLink
          to={`${base}/checks`}
          active={tab === "checks"}
          icon={<ChecklistIcon />}
          label="Checks"
          count={pull.checkRunsHidden ? (checkCount ? `${checkCount}+` : "?") : checkCount}
        />
        <TabLink to={`${base}/files`} active={tab === "files"} icon={<FileDiffIcon />} label="Files changed" count={pull.changedFiles} />
        <span className="grow" />
        <span className="pull-diffstat">
          <span className="add">+{pull.additions.toLocaleString()}</span> <span className="del">−{pull.deletions.toLocaleString()}</span>
        </span>
      </nav>
      {panel(
        "conversation",
        <div className="pull-conversation">
          <div className="pull-main">
            <Timeline
              owner={owner}
              repo={repo}
              number={number}
              kind="pull"
              subject={pull}
              commentCount={pull.totalCommentsCount}
              beforeComposer={<MergeBox pull={pull} owner={owner} repo={repo} fetchedFresh={q.isFetchedAfterMount && !q.isFetching} refetch={q.refetch} />}
            />
          </div>
          <MetadataSidebar subject={pull} owner={owner} repo={repo}>
            <Reviewers pull={pull} owner={owner} repo={repo} />
          </MetadataSidebar>
        </div>,
      )}
      {panel("commits", <CommitsTab pull={pull} owner={owner} repo={repo} />)}
      {panel("checks", <ChecksTab pull={pull} owner={owner} repo={repo} />)}
      {panel("files", <FilesChanged owner={owner} repo={repo} number={number} />)}
      {sha && <CommitView key={sha} pull={pull} owner={owner} repo={repo} sha={sha} />}
    </div>
  );
}

function TabLink(props: { to: string; active: boolean; icon: ReactNode; label: string; count: number | string; onIntent?: () => void }) {
  return (
    <Link to={props.to} className={props.active ? "tab active" : "tab"} onMouseEnter={props.onIntent} onFocus={props.onIntent}>
      <span className="muted pull-tab-icon">{props.icon}</span>
      {props.label}
      <span className="counter">{props.count.toLocaleString()}</span>
    </Link>
  );
}
