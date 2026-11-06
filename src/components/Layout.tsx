import { CommentIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { rateLimits } from "@/api/rateLimit";
import { auth, signOut } from "@/auth/token";
import { toAppPath, toGitHubUrl } from "@/lib/githubUrl";
import { useHotkey } from "@/lib/hotkeys";
import { settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { Popover } from "./Popover";

/** owner/repo from the current path, when the path is inside a repo. */
export function useRepoFromPath(): { owner: string; repo: string } | null {
  const { pathname } = useLocation();
  const [owner, repo] = pathname.split("/").filter(Boolean);
  if (!owner || !repo || owner === "settings") return null;
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

/** The list crumb on issue and PR pages, linking back with the last query used for that list. */
function listCrumb(segments: string[]): { to: string; label: string } | null {
  const [owner, repo, kind, num] = segments;
  if (!/^\d+$/.test(num ?? "")) return null;
  const list = kind === "issues" ? "issues" : kind === "pull" ? "pulls" : null;
  if (!list) return null;
  const search = readListQueries()[`${owner}/${repo}:${list}`] ?? "";
  return { to: `/${owner}/${repo}/${list}${search}`, label: list === "issues" ? "Issues" : "Pull requests" };
}

/** Repo that the Feedback button files issues in, as owner/repo. */
const FEEDBACK_REPO = import.meta.env.VITE_FEEDBACK_REPO || "Lightning11wins/gitgud";

export function Layout() {
  const { pathname, search } = useLocation();
  const repo = useRepoFromPath();
  const segments = pathname.split("/").filter(Boolean);
  const owner = repo?.owner ?? (segments.length === 1 && segments[0] !== "settings" ? segments[0] : null);
  const [help, setHelp] = useState(false);
  useHotkey("?", () => setHelp(true));
  useRememberListQuery(repo ? segments : [], search);
  const list = repo && listCrumb(segments);
  const wide = /\/pull\/(\d+\/(files|commits\/[0-9a-f]+)|new\/)/.test(pathname) || pathname.includes("/compare");

  return (
    <>
      <header className="app-header">
        <div className="app-header-start">
          <Link to="/" className="brand" title="Dashboard" aria-label="GitGud dashboard">
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
                  <Crumb to={`/${repo.owner}/${repo.repo}`} current={pathname} bold>
                    {repo.repo}
                  </Crumb>
                </>
              )}
              {list && (
                <>
                  <span className="muted">/</span>
                  <Crumb to={list.to} current={pathname}>
                    {list.label}
                  </Crumb>
                </>
              )}
            </nav>
          )}
        </div>
        <JumpBox repo={repo} />
        <div className="app-header-end">
          <ApiMeter />
          {pathname !== "/" && pathname !== "/settings" && (
            <a className="btn invisible sm" href={toGitHubUrl(pathname + search)} target="_blank" rel="noopener noreferrer" title="Open this page on GitHub" aria-label="Open this page on GitHub">
              <LinkExternalIcon /> <span className="app-header-label">GitHub</span>
            </a>
          )}
          <Link
            className="btn invisible sm"
            to={`/${FEEDBACK_REPO}/issues/new?title=${encodeURIComponent("Feedback: ")}`}
            title="Opens an issue on the GitGud repo."
            aria-label="Send feedback"
          >
            <CommentIcon /> <span className="app-header-label">Feedback</span>
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className={`app-main ${wide ? "wide" : ""}`}>
        <Outlet />
      </main>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
    </>
  );
}

/** Breadcrumb link, or plain text when it points at the current page. */
function Crumb({ to, current, bold, children }: { to: string; current: string; bold?: boolean; children: ReactNode }) {
  const style = bold ? { fontWeight: 600 } : undefined;
  if (current.replace(/\/$/, "") === to)
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

function JumpBox({ repo }: { repo: { owner: string; repo: string } | null }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  useHotkey("/", () => ref.current?.focus());

  const go = () => {
    const text = value.trim();
    const num = /^#?(\d+)$/.exec(text);
    const path = num && repo ? `/${repo.owner}/${repo.repo}/issues/${num[1]}` : toAppPath(text);
    if (!path) {
      setInvalid(true);
      return;
    }
    setValue("");
    ref.current?.blur();
    navigate(path);
  };

  return (
    <label className="jump-box">
      <input
        ref={ref}
        className="input sm"
        style={invalid ? { borderColor: "var(--danger)" } : undefined}
        placeholder="Jump to…"
        title={repo ? "Type #123, owner/repo, or paste a GitHub URL, then press Enter. Shortcut: /" : "Type owner/repo, owner/repo#123, or paste a GitHub URL, then press Enter. Shortcut: /"}
        aria-label="Jump to an issue, pull request, or repository"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
          if (e.key === "Escape") ref.current?.blur();
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const path = toAppPath(text);
          if (path && /github\.com\//.test(text)) {
            e.preventDefault();
            setValue("");
            ref.current?.blur();
            navigate(path);
          }
        }}
      />
      {!value && <kbd aria-hidden="true">/</kbd>}
    </label>
  );
}

const METER_LIMITS = [
  ["graphql", "GraphQL"],
  ["core", "REST"],
] as const;

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
    title: `GitHub API requests left\n${bars.map((b) => b.text).join("\n")}`,
    "aria-label": "GitHub API usage",
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
      <button className="btn invisible sm icon" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} title={viewer.login}>
        <Avatar src={viewer.avatarUrl} size={24} login={viewer.login} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" width={200}>
          <div className="select-menu-list">
            <div className="select-menu-header muted">
              Signed in as <strong>{viewer.login}</strong>
            </div>
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
