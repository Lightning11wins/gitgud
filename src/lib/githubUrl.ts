import { settings } from "./settings";

/** Path to a repo's default tab. */
export function repoPath(owner: string, repo: string): string {
  const tab = settings.get().repoTab;
  return tab === "issues" || tab === "pulls" ? `/${owner}/${repo}/${tab}` : `/${owner}/${repo}`;
}

/** True for a name GitHub allows for an owner or repo: letters, digits, `_`, `.`, and `-`, but not only dots. */
export function isValidName(name: string): boolean {
  return /^[\w.-]+$/.test(name) && !/^\.+$/.test(name);
}

/** Routes this app handles, mirroring github.com paths. */
const SUPPORTED = [
  /^\/[^/]+\/?$/,
  /^\/[^/]+\/[^/]+\/?$/,
  /^\/[^/]+\/[^/]+\/(issues|pulls)\/?$/,
  /^\/[^/]+\/[^/]+\/issues\/(\d+|new)\/?$/,
  /^\/[^/]+\/[^/]+\/pull\/\d+(\/(files|commits|checks)(\/[0-9a-f]+)?)?\/?$/,
  /^\/[^/]+\/[^/]+\/compare(\/.*)?$/,
];

/** github.com top-level paths that look like `/:owner` or `/:owner/:repo` but aren't. */
export const RESERVED_OWNERS = new Set([
  "about", "account", "apps", "codespaces", "collections", "copilot", "customer-stories", "dashboard", "enterprise",
  "enterprises", "explore", "features", "join", "login", "logout", "marketplace", "new", "notifications", "orgs",
  "organizations", "pricing", "pulls", "issues", "readme", "search", "security", "settings", "signup", "site", "sponsors",
  "stars", "team", "topics", "trending", "users", "watching",
]);

/**
 * Converts user input into an in-app path. Accepts github.com URLs, `owner/repo`,
 * `owner/repo#123`, and in-app paths. Returns null when the target isn't handled here.
 */
export function toAppPath(input: string): string | null {
  const text = input.trim();
  const short = /^([\w.-]+)\/([\w.-]+)(?:#(\d+))?$/.exec(text);
  if (short) return short[3] ? `/${short[1]}/${short[2]}/issues/${short[3]}` : repoPath(short[1], short[2]);
  let url: URL;
  try {
    url = new URL(text, location.origin);
  } catch {
    return null;
  }
  const isGitHub = url.hostname === "github.com" || url.hostname === "www.github.com";
  if (!isGitHub && url.origin !== location.origin) return null;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!SUPPORTED.some((re) => re.test(path)) || RESERVED_OWNERS.has(path.split("/")[1].toLowerCase())) return null;
  if (!path.split("/").slice(1, 3).every(isValidName)) return null;
  const repo = /^\/([^/]+)\/([^/]+)$/.exec(path);
  if (repo && !url.search) return repoPath(repo[1], repo[2]) + url.hash;
  return path + url.search + url.hash;
}

/** The github.com URL for an in-app path. */
export function toGitHubUrl(appPath: string): string {
  return `https://github.com${appPath}`;
}
