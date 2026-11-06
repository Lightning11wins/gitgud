// Pure timeline merge and freshness rules, kept free of the cache so they can be unit tested.
import type { TimelineData, TimelineItem } from "./types";

/** Cached timelines older than this are refetched from scratch so edits by others show up. */
export const FULL_RELOAD_MS = 30 * 60_000;

/** References from other issues and commits don't change the subject's `updatedAt`, so a cached timeline resumes this often anyway. */
export const RECHECK_MS = 10 * 60_000;

/**
 * Item types GitHub can insert before the end of the timeline. Commits sort by commit date, not push
 * time, so a push can add them before the cached end cursor. Counted apart so a deletion can't hide one.
 */
export const MOVABLE_TYPENAMES = new Set(["PullRequestCommit", "PullRequestCommitCommentThread", "ReferencedEvent"]);

/** Appended events that can replace commits in place, leaving every count unchanged. */
const HISTORY_TYPENAMES = new Set(["HeadRefForcePushedEvent", "BaseRefForcePushedEvent", "BaseRefChangedEvent"]);

/** Matching items on GitHub: all of them, and those in `MOVABLE_TYPENAMES`. */
export interface TimelineCounts {
  total: number;
  movable: number;
}

/** Merges pages into `base` by id: known ids update in place, new ones append and are listed in `added`. */
export function createMerger(base: TimelineItem[]) {
  const items = [...base];
  const index = new Map(items.map((it, i) => [it.id, i]));
  const added: TimelineItem[] = [];
  return {
    items,
    added,
    add(nodes: TimelineItem[]) {
      for (const node of nodes) {
        const i = index.get(node.id);
        if (i === undefined) {
          index.set(node.id, items.length);
          items.push(node);
          added.push(node);
        } else items[i] = node;
      }
    },
  };
}

/**
 * False when GitHub's counts for a timeline loaded from the start disagree. Items hidden from the token
 * (e.g. mentions from repositories it can't read) make GitHub undercount and end pages early, so
 * `hasNextPage` can be false with items left.
 */
export function countsTrusted(counts: TimelineCounts | undefined, firstPageCount: number): boolean {
  return !counts || counts.total === firstPageCount;
}

/** True when `items` has as many items, and as many movable ones, as GitHub reports. */
export function countsMatch(items: TimelineItem[], counts: TimelineCounts): boolean {
  let movable = 0;
  for (const it of items) if (MOVABLE_TYPENAMES.has(it.__typename)) movable++;
  return items.length === counts.total && movable === counts.movable;
}

export interface ResumeResult {
  items: TimelineItem[];
  /** Items whose ids weren't cached. */
  added: TimelineItem[];
  endCursor: string | null;
  complete: boolean;
  counts: TimelineCounts;
}

/**
 * The timeline after resuming `cached` from its end cursor for a new `stamp`, or null when it must be
 * reloaded from scratch: something before the cursor was deleted or inserted, or commits were rewritten.
 */
export function resumed(cached: TimelineData, r: ResumeResult, stamp: string): TimelineData | null {
  if (r.added.some((it) => HISTORY_TYPENAMES.has(it.__typename))) return null;
  if (!r.complete) return { stamp: "", items: r.items, endCursor: r.endCursor, fullAt: cached.fullAt, edited: cached.edited };
  if (!countsMatch(r.items, r.counts)) return null;
  // A new stamp with nothing appended means an earlier item was edited.
  const edited = cached.edited || (r.endCursor === cached.endCursor && !!cached.stamp && stamp !== cached.stamp);
  return { stamp, items: r.items, endCursor: r.endCursor, fullAt: cached.fullAt, edited };
}

/** True when `cached` has edits to earlier items and is old enough to reload, even with an unchanged stamp. */
export function reloadDue(cached: TimelineData | undefined, now: number): boolean {
  return !!cached?.edited && now - cached.fullAt >= FULL_RELOAD_MS;
}

/** True when `cached` is complete but hasn't been checked for appended references in `RECHECK_MS`. */
export function recheckDue(cached: TimelineData | undefined, now: number): boolean {
  return !!cached?.stamp && !!cached.endCursor && now - (cached.checkedAt ?? cached.fullAt) >= RECHECK_MS;
}
