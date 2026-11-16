import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { SUBJECT_HEADER_KEYS, type SubjectHeader } from "./types";

/**
 * Keeps each issue and PR consistent across cached queries. Lists, issue/PR pages, and references in
 * markdown each cache their own copy, so a page renders from one cached record; when one query gets a
 * newer copy, the others take its header (`SUBJECT_HEADER_KEYS`), so a change seen anywhere shows
 * everywhere without waiting for each page to refetch.
 */

/** Query key roots whose data is a search list (`{ items: SubjectHeader[] }`). */
const LIST_ROOTS = new Set(["repo-list", "dashboard"]);
/** Query key roots whose data is one issue or PR's metadata. */
const META_ROOTS = new Set(["issue", "pull"]);
/** Query key root whose data is one reference in markdown (`Reference` in `components/references.ts`). */
const REF_ROOT = "reference";

/** A cached copy: a list row, a page's metadata, or a reference. */
export type Copy = { kind: "row" | "meta" | "ref"; data: SubjectHeader };

function kindOf(query: Query): Copy["kind"] | undefined {
  const root = query.queryKey[0];
  if (typeof root !== "string") return undefined;
  if (LIST_ROOTS.has(root) && Array.isArray((query.state.data as { items?: unknown })?.items)) return "row";
  if (META_ROOTS.has(root) && (query.state.data as { id?: unknown })?.id) return "meta";
  if (root === REF_ROOT && (query.state.data as { id?: unknown })?.id) return "ref";
  return undefined;
}

function copiesIn(query: Query, kind: Copy["kind"]): Copy[] {
  if (kind !== "row") return [{ kind, data: query.state.data as SubjectHeader }];
  return (query.state.data as { items: SubjectHeader[] }).items.map((data) => ({ kind, data }));
}

/**
 * Whether `a` is newer than `b`. Metadata wins ties, since local edits patch it without changing
 * `updatedAt`.
 */
function isNewer(a: Copy, b: Copy): boolean {
  return a.data.updatedAt > b.data.updatedAt || (a.data.updatedAt === b.data.updatedAt && a.kind === "meta" && b.kind !== "meta");
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * `target` updated from a newer copy, or `target.data` itself when it is the newest or nothing differs.
 * A row takes a newer row whole; otherwise the copy takes the header, and a row or reference also takes
 * `updatedAt`. Metadata keeps its own `updatedAt`, which also versions its body and timeline that rows
 * don't carry.
 */
export function patchCopy<T extends SubjectHeader>(target: { kind: Copy["kind"]; data: T }, from: Copy): T {
  if (!isNewer(from, target)) return target.data;
  if (target.kind === "row" && from.kind === "row") return from.data as T;
  const next: T = { ...target.data };
  let changed = false;
  for (const key of SUBJECT_HEADER_KEYS) {
    if (!(key in from.data) || sameValue(next[key], from.data[key])) continue;
    (next as SubjectHeader)[key] = from.data[key] as never;
    changed = true;
  }
  if (target.kind !== "meta" && next.updatedAt !== from.data.updatedAt) {
    next.updatedAt = from.data.updatedAt;
    changed = true;
  }
  return changed ? next : target.data;
}

/** Applies the `best` copies to `query`'s data, keeping its fetch time. */
function apply(client: QueryClient, query: Query, kind: Copy["kind"], best: Map<string, Copy>) {
  const data = query.state.data;
  let next: unknown = data;
  if (kind !== "row") {
    const copy = data as SubjectHeader;
    const from = best.get(copy.id);
    if (from) next = patchCopy({ kind, data: copy }, from);
  } else {
    const list = data as { items: SubjectHeader[] };
    let changed = false;
    const items = list.items.map((row) => {
      const from = best.get(row.id);
      const patched = from ? patchCopy({ kind, data: row }, from) : row;
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
    const ids = new Set(copiesIn(source, sourceKind).map((c) => c.data.id));
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
    const consider = (c: Copy) => {
      const current = best.get(c.data.id);
      if (!current || isNewer(c, current)) best.set(c.data.id, c);
    };
    copiesIn(source, sourceKind).forEach(consider);
    for (const { q, kind } of others) for (const c of copiesIn(q, kind)) if (ids.has(c.data.id)) consider(c);
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
export function findListRow(client: QueryClient, owner: string, repo: string, number: number): SubjectHeader | undefined {
  const slug = `${owner}/${repo}`.toLowerCase();
  let found: SubjectHeader | undefined;
  for (const q of client.getQueryCache().getAll()) {
    if (kindOf(q) !== "row") continue;
    for (const row of (q.state.data as { items: SubjectHeader[] }).items) {
      if (row.number === number && row.repository.nameWithOwner.toLowerCase() === slug && (!found || row.updatedAt > found.updatedAt)) found = row;
    }
  }
  return found;
}
