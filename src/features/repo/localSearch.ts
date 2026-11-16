import type { ListData, ListItem } from "./searchList";

type Filter = (i: ListItem) => boolean;

/** The kind group `buildSearch` adds to mixed lists. It narrows nothing. */
const ANY_KIND = "(is:issue or is:pr)";

/**
 * A search's tokens, lowercased: parenthesized groups whole, other runs of non-space text and quoted
 * strings. Undefined when it joins tokens with OR or AND, since its results then aren't the tokens' intersection.
 */
function searchTokens(search: string): Set<string> | undefined {
  const tokens = search.toLowerCase().match(/\((?:"[^"]*"|[^)"])*\)|(?:"[^"]*"|[^\s"])+/g) ?? [];
  if (tokens.some((t) => t === "or" || t === "and")) return undefined;
  return new Set(tokens.filter((t) => t !== ANY_KIND));
}

const open: Filter = (i) => i.state === "OPEN";
const closed: Filter = (i) => i.state !== "OPEN";
const issue: Filter = (i) => i.__typename === "Issue";
const pull: Filter = (i) => i.__typename === "PullRequest";
const draft: Filter = (i) => !!i.isDraft;

/** Qualifiers with fixed values, as GitHub matches them. */
const FIXED = new Map<string, Filter>(Object.entries({
  "is:open": open,
  "state:open": open,
  "is:closed": closed,
  "state:closed": closed,
  "is:merged": (i) => i.state === "MERGED",
  "is:issue": issue,
  "type:issue": issue,
  "is:pr": pull,
  "type:pr": pull,
  "is:pull-request": pull,
  "is:draft": draft,
  "draft:true": draft,
  "no:label": (i) => !i.labels.nodes.length,
  "no:assignee": (i) => !i.assignees.nodes.length,
} satisfies Record<string, Filter>));

/** Qualifiers naming people or labels: the names a row has for each. */
const NAMED = new Map<string, (i: ListItem) => (string | undefined)[]>(Object.entries({
  label: (i) => i.labels.nodes.map((l) => l.name),
  author: (i) => [i.author?.login],
  assignee: (i) => i.assignees.nodes.map((a) => a.login),
} satisfies Record<string, (i: ListItem) => (string | undefined)[]>));

/** A `label:` value's names: comma-separated, each plain or quoted. Undefined for other syntax. */
function labelNames(value: string): string[] | undefined {
  if (!/^(?:"[^"]*"|[^",]+)(?:,(?:"[^"]*"|[^",]+))*$/.test(value)) return undefined;
  return [...value.matchAll(/"([^"]*)"|([^",]+)/g)].map((m) => m[1] ?? m[2]);
}

/** The filter for a `label:`, `author:`, or `assignee:` qualifier. */
function namedFilter(qualifier: string): Filter | undefined {
  const [, name = "", value = ""] = /^([a-z]+):(.+)$/.exec(qualifier) ?? [];
  const get = NAMED.get(name);
  // Logins only: `@me`, `app/name`, and wildcards need more than rows hold.
  const names = name === "label" ? labelNames(value) : /^[a-z\d-]+$/.test(value) ? [value] : undefined;
  return get && names && ((i) => get(i).some((n) => n !== undefined && names.includes(n.toLowerCase())));
}

/** The filter for a lowercased token, or undefined when rows don't carry what it matches. */
function tokenFilter(token: string): Filter | undefined {
  const negated = token.startsWith("-");
  const qualifier = negated ? token.slice(1) : token;
  const filter = FIXED.get(qualifier) ?? namedFilter(qualifier);
  return filter && negated ? (i) => !filter(i) : filter;
}

/**
 * The rows of a cached list for `source` that match `search`, standing in for the top of its results
 * through the list's last row. Undefined unless `search` is `source` plus qualifiers rows carry.
 */
export function narrowList(data: ListData, source: string, search: string): ListData | undefined {
  const from = searchTokens(source);
  const to = searchTokens(search);
  if (!from || !to || [...from].some((t) => !to.has(t))) return undefined;
  const filters = [...to].filter((t) => !from.has(t)).map(tokenFilter);
  if (!filters.every((f): f is Filter => !!f)) return undefined;
  const items = data.items.filter((i) => filters.every((f) => f(i)));
  if (!items.length && data.hasNextPage) return undefined;
  return { items, total: items.length, hasNextPage: data.hasNextPage, endCursor: null };
}
