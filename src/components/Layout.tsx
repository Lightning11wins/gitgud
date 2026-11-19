import { CheckIcon, CommentIcon, GitPullRequestIcon, IssueOpenedIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { rateLimits } from "@/api/rateLimit";
import { auth, signOut } from "@/auth/token";
import { copyText } from "@/lib/clipboard";
import { isValidName, repoPath, toGitHubUrl } from "@/lib/githubUrl";
import { useHotkey } from "@/lib/hotkeys";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { Avatar } from "./Avatar";
import { CrumbMenu } from "./CrumbMenu";
import { Dialog } from "./Dialog";
import { NotFound } from "./NotFound";
import { Popover } from "./Popover";
import { JumpBox } from "./JumpBox";
import { RepoSwitcher } from "./RepoSwitcher";
import { SelectMenu } from "./SelectMenu";
import { tooltip } from "@/lib/tooltip";

/** owner/repo from the current path, when the path is inside a repo. */
export function useRepoFromPath(): { owner: string; repo: string } | null {
  const { pathname } = useLocation();
  const [owner, repo] = pathname.split("/").filter(Boolean);
  if (!owner || !repo || owner === "settings" || !isValidName(owner) || !isValidName(repo)) return null;
  return { owner, repo };
}

const LIST_QUERY_KEY = "gitgud:list-queries";

/** Last search string of each repo's issue and PR lists, keyed by `owner/repo:issues` or `owner/repo:pulls`. */
function readListQueries(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(LIST_QUERY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Remembers the list query on repo list pages. The All tab's query applies to both lists. */
function useRememberListQuery(segments: string[], search: string) {
  const [owner, repo, list, extra] = segments;
  useEffect(() => {
    if (!owner || !repo || extra !== undefined || (list !== undefined && list !== "issues" && list !== "pulls")) return;
    const saved = readListQueries();
    for (const l of list ? [list] : ["issues", "pulls"]) saved[`${owner}/${repo}:${l}`] = search;
    try {
      sessionStorage.setItem(LIST_QUERY_KEY, JSON.stringify(saved));
    } catch {
      // Storage can be full or blocked; the crumb then links to the unfiltered list.
    }
  }, [owner, repo, list, extra, search]);
}

const SECTIONS = [
  { list: "issues", label: "Issues", icon: IssueOpenedIcon, paths: ["issues"] },
  { list: "pulls", label: "Pull requests", icon: GitPullRequestIcon, paths: ["pulls", "pull", "compare"] },
] as const;
type Section = (typeof SECTIONS)[number];

/** Link to a section's list, with the last query used for that list. */
function sectionLink(owner: string, repo: string, section: Section): string {
  return `/${owner}/${repo}/${section.list}${readListQueries()[`${owner}/${repo}:${section.list}`] ?? ""}`;
}

/** Crumb after the repo for the section the page is in, with a caret to switch sections. */
function SectionCrumb({ owner, repo, kind, current }: { owner: string; repo: string; kind: string | undefined; current: string }) {
  const section = SECTIONS.find((s) => (s.paths as readonly string[]).includes(kind ?? ""));
  const navigate = useNavigate();
  if (!section) return null;
  return (
    <>
      <span className="muted">/</span>
      <span className="crumb-split">
        <Crumb to={sectionLink(owner, repo, section)} current={current}>
          {section.label}
        </Crumb>
        <CrumbMenu
          label="Switch section"
          menu={(anchor, close) => (
            <SelectMenu<Section>
              anchor={anchor}
              title="Switch section"
              items={[...SECTIONS]}
              getKey={(s) => s.list}
              getText={(s) => s.label}
              renderItem={(s) => (
                <>
                  <s.icon className="muted" />
                  {s.label}
                </>
              )}
              initial={[section.list]}
              filterable={false}
              onApply={(keys) => navigate(sectionLink(owner, repo, SECTIONS.find((s) => s.list === keys[0]) ?? section))}
              onClose={close}
            />
          )}
        />
      </span>
    </>
  );
}

/** Repo that the Feedback button files issues in, as owner/repo. */
const FEEDBACK_REPO = import.meta.env.VITE_FEEDBACK_REPO || "Lightning11wins/gitgud";

export function Layout() {
  const { pathname, search } = useLocation();
  const repo = useRepoFromPath();
  const { tabSize } = useStore(settings);
  useLayoutEffect(() => document.documentElement.style.setProperty("--tab-size", String(tabSize)), [tabSize]);
  const segments = pathname.split("/").filter(Boolean);
  // Names a crafted link could use to send API requests outside the repo they name.
  const badName = segments[0] !== "settings" && !segments.slice(0, 2).every(isValidName);
  const owner = repo?.owner ?? (segments.length === 1 && !badName && segments[0] !== "settings" ? segments[0] : null);
  const [help, setHelp] = useState(false);
  useHotkey("?", () => setHelp(true));
  useRememberListQuery(repo ? segments : [], search);
  const onFeedback = pathname.toLowerCase() === `/${FEEDBACK_REPO}/issues/new`.toLowerCase();
  const wide = /\/pull\/\d+\/(files|commits\/[0-9a-f]+)/.test(pathname);

  return (
    <>
      <header className="app-header">
        <div className="app-header-start">
          <Link to="/" className="brand" {...tooltip("GitGud dashboard", "label")}>
            <img src="/favicon.svg" width={24} height={24} alt="" />
          </Link>
          {owner && (
            <nav className="crumbs truncate">
              <span className="muted">/</span>
              <Crumb to={`/${owner}`} current={pathname} bold={!repo}>
                {owner}
              </Crumb>
              {repo && (
                <>
                  <span className="muted">/</span>
                  <span className="crumb-split">
                    <Crumb to={repoPath(repo.owner, repo.repo)} current={pathname} bold>
                      {repo.repo}
                    </Crumb>
                    <RepoSwitcher owner={repo.owner} repo={repo.repo} />
                  </span>
                </>
              )}
              {repo && <SectionCrumb owner={repo.owner} repo={repo.repo} kind={segments[2]} current={pathname} />}
            </nav>
          )}
        </div>
        <JumpBox repo={repo} />
        <div className="app-header-end">
          <ApiMeter />
          {pathname !== "/" && pathname !== "/settings" && (
            <GitHubLink url={toGitHubUrl(pathname + search)} />
          )}
          {!onFeedback && (
            <Link
              className="btn invisible sm"
              to={`/${FEEDBACK_REPO}/issues/new?title=${encodeURIComponent("Feedback: ")}`}
              {...tooltip("Opens an issue on the GitGud repo.")}
              aria-label="Send feedback"
            >
              <CommentIcon /> <span className="app-header-label">Feedback</span>
            </Link>
          )}
          <UserMenu />
        </div>
      </header>
      <main className={`app-main ${wide ? "wide" : ""}`}>
        {badName ? <NotFound /> : <Outlet />}
      </main>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
    </>
  );
}

/** Breadcrumb link, or plain text when it points at the current page (whatever the query). */
function Crumb({ to, current, bold, children }: { to: string; current: string; bold?: boolean; children: ReactNode }) {
  const style = bold ? { fontWeight: 600 } : undefined;
  if (current.replace(/\/$/, "") === to.split("?")[0])
    return (
      <span aria-current="page" style={style}>
        {children}
      </span>
    );
  return (
    <Link to={to} style={style}>
      {children}
    </Link>
  );
}

const METER_LIMITS = [
  ["graphql", "GraphQL"],
  ["core", "REST"],
] as const;

/** Opens the current page on GitHub. Shift-click copies the GitHub link instead. */
function GitHubLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <a
      className="btn invisible sm"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      {...tooltip(copied ? "Copied!" : "Open this page on GitHub. Shift-click to copy the link.")}
      aria-label="Open this page on GitHub"
      onClick={(e) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        copyText(url).then(() => setCopied(true), () => {});
      }}
    >
      {copied ? <CheckIcon /> : <LinkExternalIcon />} <span className="app-header-label">{copied ? "Copied" : "GitHub"}</span>
    </a>
  );
}

/** One bar per GitHub API rate limit, filled by the share used. Links to Settings for the numbers, except on Settings. Hidden by a setting unless a limit runs low. */
function ApiMeter() {
  const limits = useStore(rateLimits);
  const { showApiMeter } = useStore(settings);
  const onSettings = useLocation().pathname === "/settings";
  const bars = METER_LIMITS.map(([key, name]) => {
    const r = limits[key];
    const left = r && r.limit ? r.remaining / r.limit : undefined;
    const reset = r && new Date(r.reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { name, left, text: r ? `${name}: ${r.remaining.toLocaleString()} of ${r.limit.toLocaleString()} left until ${reset}` : `${name}: not used yet this session` };
  });
  const low = Math.min(...bars.map((b) => b.left ?? 1));
  const tone = low <= 0 ? "danger" : low < 0.1 ? "attention" : undefined;
  if (!showApiMeter && !tone) return null;
  const props = {
    className: `${onSettings ? "api-meter-static" : "btn invisible sm icon"} api-meter${tone ? ` ${tone}` : ""}`,
    "aria-label": "GitHub API usage",
    ...tooltip(`GitHub API requests left\n${bars.map((b) => b.text).join("\n")}`),
  };
  const svg = (
    <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden="true">
      {bars.map((b, i) => {
        const w = Math.max(2, 18 * (1 - (b.left ?? 1)));
        return (
          <g key={b.name}>
            <rect className="api-meter-track" x={1} y={4.5 + i * 4} width={18} height={3} rx={1.5} />
            <rect x={1} y={4.5 + i * 4} width={w} height={3} rx={1.5} />
          </g>
        );
      })}
    </svg>
  );
  return onSettings ? (
    <span role="img" {...props}>
      {svg}
    </span>
  ) : (
    <Link to="/settings" {...props}>
      {svg}
    </Link>
  );
}

function UserMenu() {
  const { viewer } = useStore(auth);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!viewer) return null;
  return (
    <>
      <button className="btn invisible sm icon" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} {...tooltip(viewer.login, "label")}>
        <Avatar src={viewer.avatarUrl} size={24} login={viewer.login} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" width={200}>
          <div className="select-menu-list">
            <div className="select-menu-header muted">
              Signed in as <strong>{viewer.login}</strong>
            </div>
            <Link className="select-menu-item" to={`/${viewer.login}`} onClick={() => setAnchor(null)} style={{ color: "var(--fg)" }}>
              Repositories
            </Link>
            <Link className="select-menu-item" to="/settings/organizations" onClick={() => setAnchor(null)} style={{ color: "var(--fg)" }}>
              Organizations
            </Link>
            <Link className="select-menu-item" to="/settings" onClick={() => setAnchor(null)} style={{ color: "var(--fg)" }}>
              Settings
            </Link>
            <button className="select-menu-item" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "Focus the jump box"],
  ["j / k", "Next / previous item, or change in Files changed"],
  ["Enter / o", "Open selected item"],
  ["r", "Reply / focus the comment box"],
  ["n / p", "Next / previous file in Files changed"],
  ["v", "Toggle viewed on the current file"],
  ["Ctrl+Enter", "Submit the comment you're writing"],
  ["Esc", "Cancel / close"],
  ["?", "Show this help"],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width={420}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td style={{ padding: "4px 0", width: 120 }}>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
