import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Keeps each issue and PR consistent across cached queries. Lists and issue/PR pages each cache their
 * own copy; when one query gets a newer copy, the others are patched from it, so a change seen
 * anywhere shows everywhere without waiting for each page to refetch.
 */

/** Query key roots whose data is a search list (`{ items: ListRow[] }`). */
const LIST_ROOTS = new Set(["repo-list", "dashboard"]);
/** Query key roots whose data is one issue or PR's metadata. */
const META_ROOTS = new Set(["issue", "pull"]);

type State = "OPEN" | "CLOSED" | "MERGED";

/** The fields of a list row this module reads and writes. */
export interface ListRow {
  __typename: "Issue" | "PullRequest";
  id: string;
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  isDraft?: boolean;
  updatedAt: string;
  repository: { nameWithOwner: string };
  labels: { nodes: { name: string; color: string; description?: string | null }[] };
  assignees: { nodes: { login: string; avatarUrl: string }[] };
}

interface Meta {
  __typename: "Issue" | "PullRequest";
  id: string;
  title: string;
  state: State;
  stateReason?: string | null;
  isDraft?: boolean;
  merged?: boolean;
  updatedAt: string;
  labels: { nodes: { name: string; color: string; description?: string | null }[] };
  assignees: { nodes: { login: string; avatarUrl: string }[] };
}

type Copy = { row: ListRow; meta?: never } | { meta: Meta; row?: never };

function kindOf(query: Query): "list" | "meta" | undefined {
  const root = query.queryKey[0];
  if (typeof root !== "string") return undefined;
  if (LIST_ROOTS.has(root) && Array.isArray((query.state.data as { items?: unknown })?.items)) return "list";
  if (META_ROOTS.has(root) && (query.state.data as { id?: unknown })?.id) return "meta";
  return undefined;
}

function copiesIn(query: Query, kind: "list" | "meta"): Copy[] {
  if (kind === "meta") return [{ meta: query.state.data as Meta }];
  return (query.state.data as { items: ListRow[] }).items.map((row) => ({ row }));
}

const idOf = (c: Copy) => (c.row ?? c.meta).id;
const updatedOf = (c: Copy) => (c.row ?? c.meta).updatedAt;

const sameLabels = (a: ListRow["labels"]["nodes"], b: ListRow["labels"]["nodes"]) =>
  a.length === b.length && a.every((l, i) => l.name === b[i].name && l.color === b[i].color);
const sameAssignees = (a: ListRow["assignees"]["nodes"], b: ListRow["assignees"]["nodes"]) =>
  a.length === b.length && a.every((u, i) => u.login === b[i].login);

/** `row` updated from a newer (or locally edited) copy, or `row` itself when nothing differs. */
export function patchRow(row: ListRow, from: Copy): ListRow {
  if (from.row) return updatedOf(from) > row.updatedAt ? from.row : row;
  const m = from.meta;
  if (m.updatedAt < row.updatedAt) return row;
  const next: ListRow = {
    ...row,
    title: m.title,
    state: m.state,
    updatedAt: m.updatedAt,
    ...(m.stateReason !== undefined && { stateReason: m.stateReason }),
    ...(m.isDraft !== undefined && { isDraft: m.isDraft }),
  };
  const labels = m.labels.nodes.map(({ name, color, description }) => ({ name, color, description }));
  if (!sameLabels(row.labels.nodes, labels)) next.labels = { nodes: labels };
  if (!sameAssignees(row.assignees.nodes, m.assignees.nodes)) next.assignees = { nodes: m.assignees.nodes.map(({ login, avatarUrl }) => ({ login, avatarUrl })) };
  const changed =
    next.title !== row.title ||
    next.state !== row.state ||
    next.updatedAt !== row.updatedAt ||
    next.stateReason !== row.stateReason ||
    next.isDraft !== row.isDraft ||
    next.labels !== row.labels ||
    next.assignees !== row.assignees;
  return changed ? next : row;
}

/**
 * `meta` with the header fields of a newer list row. Its `updatedAt` stays, so freshness checks
 * keyed on it still refetch the rest.
 */
export function patchMeta(meta: Meta, from: Copy): Meta {
  const row = from.row;
  if (!row || row.updatedAt <= meta.updatedAt) return meta;
  const state = row.state as State;
  if (row.title === meta.title && state === meta.state && (row.isDraft ?? meta.isDraft) === meta.isDraft && (row.stateReason ?? meta.stateReason) === meta.stateReason) return meta;
  return {
    ...meta,
    title: row.title,
    state,
    ...(row.stateReason !== undefined && { stateReason: row.stateReason }),
    ...(row.isDraft !== undefined && { isDraft: row.isDraft }),
    ...(meta.__typename === "PullRequest" && { merged: state === "MERGED" }),
  };
}

function newer(a: Copy | undefined, b: Copy): Copy {
  if (!a) return b;
  const ua = updatedOf(a);
  const ub = updatedOf(b);
  // Metadata wins ties: local edits patch it without changing `updatedAt`.
  return ub > ua || (ub === ua && !!b.meta && !a.meta) ? b : a;
}

/** Applies `best` copies to `query`'s data, keeping its fetch time. */
function apply(client: QueryClient, query: Query, kind: "list" | "meta", best: Map<string, Copy>) {
  const data = query.state.data;
  let next: unknown = data;
  if (kind === "meta") {
    const meta = data as Meta;
    const from = best.get(meta.id);
    if (from) next = patchMeta(meta, from);
  } else {
    const list = data as { items: ListRow[] };
    let changed = false;
    const items = list.items.map((row) => {
      const from = best.get(row.id);
      const patched = from ? patchRow(row, from) : row;
      if (patched !== row) changed = true;
      return patched;
    });
    if (changed) next = { ...list, items };
  }
  if (next !== data) client.setQueryData(query.queryKey as QueryKey, next, { updatedAt: query.state.dataUpdatedAt });
}

/** Spreads issue and PR changes between cached queries as they arrive. */
export function syncSubjects(client: QueryClient) {
  let busy = false;
  return client.getQueryCache().subscribe((event) => {
    if (busy || event.type !== "updated" || event.action.type !== "success") return;
    const source = event.query;
    const sourceKind = kindOf(source);
    if (!sourceKind) return;
    const ids = new Set(copiesIn(source, sourceKind).map(idOf));
    if (!ids.size) return;
    const others = client
      .getQueryCache()
      .getAll()
      .flatMap((q) => {
        const kind = q === source ? undefined : kindOf(q);
        return kind ? [{ q, kind }] : [];
      });
    // The newest copy of each of the source's subjects, wherever it is cached.
    const best = new Map<string, Copy>();
    for (const c of copiesIn(source, sourceKind)) best.set(idOf(c), newer(best.get(idOf(c)), c));
    for (const { q, kind } of others) {
      for (const c of copiesIn(q, kind)) if (ids.has(idOf(c))) best.set(idOf(c), newer(best.get(idOf(c)), c));
    }
    busy = true;
    try {
      apply(client, source, sourceKind, best);
      for (const { q, kind } of others) apply(client, q, kind, best);
    } finally {
      busy = false;
    }
  });
}

/** A cached list row for an issue or PR, for showing it while its page loads. */
export function findListRow(client: QueryClient, owner: string, repo: string, number: number): ListRow | undefined {
  const slug = `${owner}/${repo}`.toLowerCase();
  let found: ListRow | undefined;
  for (const q of client.getQueryCache().getAll()) {
    if (kindOf(q) !== "list") continue;
    for (const row of (q.state.data as { items: ListRow[] }).items) {
      if (row.number === number && row.repository.nameWithOwner.toLowerCase() === slug && (!found || row.updatedAt > found.updatedAt)) found = row;
    }
  }
  return found;
}
