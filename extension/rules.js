// Redirect rules for declarativeNetRequest, kept free of extension APIs so they can be unit tested.

/** GitHub pages GitGud shows: repo issue and pull request lists, issues, pull requests, and compare views. */
export const GITHUB_PAGE =
  "^https://github\\.com(/[^/?#]+/[^/?#]+/(issues|pulls|issues/([0-9]+|new)|pull/[0-9]+(/(files|commits|checks)(/[0-9a-f]+)?)?|compare(/[^?#]*)?)/?([?#].*)?)$";

/** github.com top-level paths that look like `/:owner` but aren't. Mirrors `RESERVED_OWNERS` in src/lib/githubUrl.ts. */
export const RESERVED_OWNERS = [
  "about", "account", "apps", "codespaces", "collections", "copilot", "customer-stories", "dashboard", "enterprise",
  "enterprises", "explore", "features", "join", "login", "logout", "marketplace", "new", "notifications", "orgs",
  "organizations", "pricing", "pulls", "issues", "readme", "search", "security", "settings", "signup", "site", "sponsors",
  "stars", "team", "topics", "trending", "users", "watching",
];

export const REDIRECT_RULE_ID = 1;
export const RESERVED_RULE_ID = 2;

/**
 * Rules that send top-level github.com navigations to the same page on `origin` (e.g.
 * `https://gitgud.example:4483`), except navigations started from github.com or GitGud.
 */
export function buildRules(origin) {
  const condition = {
    resourceTypes: ["main_frame"],
    excludedInitiatorDomains: ["github.com", new URL(origin).hostname],
  };
  return [
    {
      id: REDIRECT_RULE_ID,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: origin + "\\1" } },
      condition: { ...condition, regexFilter: GITHUB_PAGE },
    },
    {
      id: RESERVED_RULE_ID,
      priority: 2,
      action: { type: "allow" },
      condition: { ...condition, regexFilter: `^https://github\\.com/(${RESERVED_OWNERS.join("|")})/` },
    },
  ];
}

/** The GitGud origin from a saved redirect rule, or null when none is saved. */
export function originFromRules(rules) {
  const rule = rules.find((r) => r.id === REDIRECT_RULE_ID);
  return rule ? rule.action.redirect.regexSubstitution.replace(/\\1$/, "") : null;
}

/** The origin of a GitGud URL typed by the user, or null when it isn't an http(s) URL. */
export function parseOrigin(input) {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
