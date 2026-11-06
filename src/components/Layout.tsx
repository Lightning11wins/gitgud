import { AlertIcon, CommentIcon, LinkExternalIcon, MoonIcon, SunIcon, DeviceDesktopIcon } from "@primer/octicons-react";
import { useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { rateLimits } from "@/api/rateLimit";
import { auth, signOut } from "@/auth/token";
import { toAppPath, toGitHubUrl } from "@/lib/githubUrl";
import { useHotkey } from "@/lib/hotkeys";
import { useStore } from "@/lib/store";
import { setTheme, themePref, type ThemePref } from "@/lib/theme";
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

/** Repo that the Feedback button files issues in, as owner/repo. */
const FEEDBACK_REPO = import.meta.env.VITE_FEEDBACK_REPO || "Lightning11wins/gitgud";

export function Layout() {
  const { pathname, search } = useLocation();
  const repo = useRepoFromPath();
  const segments = pathname.split("/").filter(Boolean);
  const owner = repo?.owner ?? (segments.length === 1 && segments[0] !== "settings" ? segments[0] : null);
  const [help, setHelp] = useState(false);
  useHotkey("?", () => setHelp(true));
  const wide = /\/pull\/(\d+\/(files|commits\/[0-9a-f]+)|new\/)/.test(pathname) || pathname.includes("/compare");

  return (
    <>
      <header className="app-header">
        <div className="app-header-start">
          <Link to="/" className="brand" title="Dashboard">
            <img src="/favicon.svg" width={24} height={24} alt="" />
            GitGud
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
            </nav>
          )}
        </div>
        <JumpBox repo={repo} />
        <div className="app-header-end">
          <RateLimitWarning />
          {pathname !== "/" && pathname !== "/settings" && (
            <a className="btn invisible sm" href={toGitHubUrl(pathname + search)} target="_blank" rel="noopener noreferrer" title="Open this page on GitHub">
              <LinkExternalIcon /> GitHub
            </a>
          )}
          <Link
            className="btn invisible sm"
            to={`/${FEEDBACK_REPO}/issues/new?title=${encodeURIComponent("Feedback: ")}`}
            title={`Send feedback about GitGud (opens a new issue in ${FEEDBACK_REPO})`}
          >
            <CommentIcon /> Feedback
          </Link>
          <ThemeButton />
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

/** Appears only when a GitHub API rate limit is nearly used up. Settings shows the full numbers. */
function RateLimitWarning() {
  const { core, graphql } = useStore(rateLimits);
  const low = [graphql && { name: "GraphQL", ...graphql }, core && { name: "REST", ...core }].find((r) => r && r.remaining < r.limit * 0.1);
  if (!low) return null;
  const reset = new Date(low.reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <Link
      to="/settings"
      className="btn invisible sm rate-limit-warning"
      title={`GitHub ${low.name} API: ${low.remaining.toLocaleString()} of ${low.limit.toLocaleString()} requests left until ${reset}. Pages may stop refreshing until then.`}
    >
      <AlertIcon /> API limit low
    </Link>
  );
}

const THEME_CYCLE: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

function ThemeButton() {
  const pref = useStore(themePref);
  const Icon = pref === "light" ? SunIcon : pref === "dark" ? MoonIcon : DeviceDesktopIcon;
  return (
    <button className="btn invisible sm icon" title={`Theme: ${pref} (click to change)`} onClick={() => setTheme(THEME_CYCLE[pref])}>
      <Icon />
    </button>
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
