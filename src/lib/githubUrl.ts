/** Routes this app handles, mirroring github.com paths. */
const SUPPORTED = [
  /^\/[^/]+\/[^/]+\/?$/,
  /^\/[^/]+\/[^/]+\/(issues|pulls)\/?$/,
  /^\/[^/]+\/[^/]+\/issues\/(\d+|new)\/?$/,
  /^\/[^/]+\/[^/]+\/pull\/\d+(\/(files|commits|checks)(\/[0-9a-f]+)?)?\/?$/,
  /^\/[^/]+\/[^/]+\/compare(\/.*)?$/,
];

/** github.com top-level paths that look like `/:owner/:repo` but aren't repos. */
const RESERVED_OWNERS = new Set([
  "about", "apps", "collections", "customer-stories", "enterprise", "enterprises", "explore", "features", "marketplace",
  "new", "notifications", "orgs", "organizations", "pricing", "pulls", "issues", "readme", "search", "security",
  "settings", "site", "sponsors", "team", "topics", "trending", "users",
]);

/**
 * Converts user input into an in-app path. Accepts github.com URLs, `owner/repo`,
 * `owner/repo#123`, and in-app paths. Returns null when the target isn't handled here.
 */
export function toAppPath(input: string): string | null {
  const text = input.trim();
  const short = /^([\w.-]+)\/([\w.-]+)(?:#(\d+))?$/.exec(text);
  if (short) return short[3] ? `/${short[1]}/${short[2]}/issues/${short[3]}` : `/${short[1]}/${short[2]}`;
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
  return path + url.search + url.hash;
}

/** The github.com URL for an in-app path. */
export function toGitHubUrl(appPath: string): string {
  return `https://github.com${appPath}`;
}
