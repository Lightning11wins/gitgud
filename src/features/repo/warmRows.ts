import { keys } from "@/api/keys";
import { speculate } from "@/api/prefetch";
import { persistedData, persistQueryData, queryClient } from "@/api/queryClient";
import { fetchIssuesBatch } from "@/features/issue/issueData";
import { fetchPullsBatch } from "@/features/pull/api";
import type { ListItem } from "./searchList";

/** How many rows from the top of a list get their pages warmed. */
const WARM_ROWS = 6;

function refOf(item: ListItem) {
  const [owner, repo] = item.repository.nameWithOwner.split("/");
  return { owner, repo, number: item.number };
}

function metaKey(item: ListItem) {
  const { owner, repo, number } = refOf(item);
  return item.__typename === "PullRequest" ? keys.pull(owner, repo, number) : keys.issue(owner, repo, number);
}

/**
 * Loads the page metadata of a list's top rows, skipping rows whose cached copy is current, in one
 * request per kind. Opening one of them then shows its header, body, and sidebar at once.
 */
export function warmRows(items: ListItem[]) {
  const top = items.slice(0, WARM_ROWS);
  if (!top.length) return;
  speculate(`warm:${top.map((i) => `${i.id}@${i.updatedAt}`).join(",")}`, async () => {
    const stale: ListItem[] = [];
    for (const item of top) {
      const key = metaKey(item);
      const cached = queryClient.getQueryData<{ updatedAt?: string }>(key) ?? (await persistedData<{ updatedAt?: string }>(key));
      if (!cached?.updatedAt || cached.updatedAt < item.updatedAt) stale.push(item);
    }
    const issues = stale.filter((i) => i.__typename === "Issue");
    const pulls = stale.filter((i) => i.__typename === "PullRequest");
    const save = (key: readonly unknown[], data: unknown) => {
      queryClient.setQueryData(key, data);
      persistQueryData(key);
    };
    await Promise.all([
      fetchIssuesBatch(issues.map(refOf)).then((r) => r.forEach(({ ref, issue }) => save(keys.issue(ref.owner, ref.repo, ref.number), issue))),
      fetchPullsBatch(pulls.map(refOf)).then((r) => r.forEach(({ ref, pull }) => save(keys.pull(ref.owner, ref.repo, ref.number), pull))),
    ]);
  }, { lane: "background" });
}
