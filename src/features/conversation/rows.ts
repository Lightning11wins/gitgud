// Timeline rows built from items, kept free of components so they can be unit tested.
import type { ReviewThread } from "@/api/types";
import type { CommitItem, EventItem, IssueCommentItem, ReviewItem, TimelineItem } from "./types";

export type Row =
  | { key: string; type: "item"; item: TimelineItem }
  | { key: string; type: "commits"; commits: CommitItem[] }
  | { key: string; type: "refs"; refs: EventItem[] }
  | { key: string; type: "events"; events: EventItem[] };

/** Event types that fold into one row when one actor does them in a burst, by the group they join. */
const EVENT_GROUP: Record<string, string> = {
  LabeledEvent: "labels",
  UnlabeledEvent: "labels",
  AssignedEvent: "assignees",
  UnassignedEvent: "assignees",
  ReviewRequestedEvent: "reviewers",
  ReviewRequestRemovedEvent: "reviewers",
};

/** Events this long after the first event of a group start a new row. */
export const EVENT_GROUP_MS = 3 * 60_000;

export const eventGroup = (typename: string): string | undefined => EVENT_GROUP[typename];

/** True when `item` joins a row that starts with `first`: same group, same actor, and soon after. */
function joins(first: TimelineItem, item: TimelineItem) {
  const group = EVENT_GROUP[first.__typename];
  if (!group || group !== EVENT_GROUP[item.__typename]) return false;
  if (!first.actor || first.actor.login !== item.actor?.login) return false;
  if (!first.createdAt || !item.createdAt) return false;
  return Math.abs(Date.parse(item.createdAt) - Date.parse(first.createdAt)) <= EVENT_GROUP_MS;
}

const isCrossRepoRef = (it: TimelineItem) => it.__typename === "ReferencedEvent" && !!(it as EventItem).isCrossRepository;

/**
 * Groups consecutive commits, cross-repository commit references, and bursts of label, assignee, and
 * reviewer changes by one actor, and drops items that render nothing.
 */
export function buildRows(items: TimelineItem[], prev: Row[] = []): Row[] {
  const prevRows = new Map(prev.map((r) => [r.key, r]));
  const rows: Row[] = [];
  let merged = false;
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.__typename === "PullRequestCommit") {
      if (last?.type === "commits") last.commits.push(item as CommitItem);
      else rows.push({ key: item.id, type: "commits", commits: [item as CommitItem] });
      continue;
    }
    if (isCrossRepoRef(item)) {
      if (last?.type === "refs") last.refs.push(item as EventItem);
      else if (last?.type === "item" && isCrossRepoRef(last.item)) rows[rows.length - 1] = { key: last.key, type: "refs", refs: [last.item as EventItem, item as EventItem] };
      else rows.push({ key: item.id, type: "item", item });
      continue;
    }
    if (last?.type === "events" && joins(last.events[0], item)) {
      last.events.push(item as EventItem);
      continue;
    }
    if (last?.type === "item" && joins(last.item, item)) {
      rows[rows.length - 1] = { key: last.key, type: "events", events: [last.item as EventItem, item as EventItem] };
      continue;
    }
    if (item.__typename === "PullRequestReview" && (item as ReviewItem).state === "PENDING") continue;
    // GitHub hides the ClosedEvent that comes with a merge.
    if (item.__typename === "MergedEvent") merged = true;
    else if (merged && item.__typename === "ClosedEvent") continue;
    rows.push({ key: item.id, type: "item", item });
  }
  // Keep unchanged rows identical so their memoized components skip rendering.
  return rows.map((r) => {
    const old = prevRows.get(r.key);
    if (r.type === "item") return old?.type === "item" && old.item === r.item ? old : r;
    if (r.type === "refs") return old?.type === "refs" && sameItems(old.refs, r.refs) ? old : r;
    if (r.type === "events") return old?.type === "events" && sameItems(old.events, r.events) ? old : r;
    return old?.type === "commits" && sameItems(old.commits, r.commits) ? old : r;
  });
}

function sameItems(a: TimelineItem[], b: TimelineItem[]) {
  return a.length === b.length && a.every((it, i) => it === b[i]);
}

/** The timeline items a row renders. */
export function rowItems(row: Row): TimelineItem[] {
  switch (row.type) {
    case "item":
      return [row.item];
    case "commits":
      return row.commits;
    case "refs":
      return row.refs;
    case "events":
      return row.events;
  }
}

/** DOM id of a review: its `#pullrequestreview-<id>` anchor on github.com. */
export const reviewAnchor = (review: ReviewItem) => `pullrequestreview-${review.url.split("pullrequestreview-")[1] ?? review.id}`;

/** Review threads by the review of their first comment, whose timeline row shows them. */
export function groupThreads(threads: ReviewThread[] | undefined): Map<string, ReviewThread[]> {
  const map = new Map<string, ReviewThread[]>();
  for (const t of threads ?? []) {
    const reviewId = t.comments.nodes[0]?.pullRequestReview?.id;
    if (!reviewId) continue;
    const list = map.get(reviewId);
    if (list) list.push(t);
    else map.set(reviewId, [t]);
  }
  return map;
}

/** Id of the review whose row shows the `#discussion_r<databaseId>` comment, including replies from later reviews. */
export function discussionReview(threads: ReviewThread[] | undefined, anchor: string): string | undefined {
  const m = /^discussion_r(\d+)$/.exec(anchor);
  if (!m) return undefined;
  const thread = threads?.find((t) => t.comments.nodes.some((c) => c.databaseId === Number(m[1])));
  return thread?.comments.nodes[0]?.pullRequestReview?.id;
}

/**
 * True when `row` renders the target of `#issuecomment-<databaseId>`, `#event-<id>`, `#pullrequestreview-<id>`,
 * or `#discussion_r<databaseId>`. The last needs the id {@link discussionReview} returns.
 */
export function rowHasAnchor(row: Row, anchor: string, discussionReviewId?: string): boolean {
  const comment = /^issuecomment-(\d+)$/.exec(anchor);
  if (comment) return rowItems(row).some((it) => (it as IssueCommentItem).databaseId === Number(comment[1]));
  const event = /^event-(.+)$/.exec(anchor);
  if (event) return rowItems(row).some((it) => it.id === event[1]);
  if (anchor.startsWith("pullrequestreview-")) return rowItems(row).some((it) => it.__typename === "PullRequestReview" && reviewAnchor(it as ReviewItem) === anchor);
  if (anchor.startsWith("discussion_r")) return !!discussionReviewId && rowItems(row).some((it) => it.id === discussionReviewId);
  return false;
}
