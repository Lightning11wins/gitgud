import { useEffect } from "react";
import { GitHubError, restRaw } from "@/api/client";
import { keys } from "@/api/keys";
import { persistQueryData, queryClient } from "@/api/queryClient";
import { isRateLimitLow } from "@/api/rateLimit";
import { fetchRollup, type PullMeta } from "./api";
import { checkOutcome } from "./checks";

/** How often to recheck pending checks. */
const FAST_MS = 15_000;
/** How often to recheck pending checks that haven't changed for `QUIET_MS`, like a required check that never reports. */
const SLOW_MS = 60_000;
const QUIET_MS = 10 * 60_000;

/**
 * REST endpoints whose ETags change when the pending checks on the PR's head commit do. Empty when
 * nothing is pending.
 */
export function pendingCheckSources(owner: string, repo: string, pull: PullMeta): string[] {
  if (pull.checksForbidden) return [];
  const rollup = pull.rollup;
  const pending = rollup?.contexts.filter((c) => checkOutcome(c) === "pending") ?? [];
  const required = (pull.baseRef?.refUpdateRule?.requiredStatusCheckContexts ?? []).filter(Boolean);
  // Checks that haven't reported yet, or pending ones past the first page, could be runs or statuses.
  const unseen = rollup ? (rollup.state === "PENDING" || rollup.state === "EXPECTED") && !pending.length : required.length > 0;
  const commit = `/repos/${owner}/${repo}/commits/${pull.headRefOid}`;
  const sources: string[] = [];
  if (!pull.checkRunsHidden && (unseen || pending.some((c) => c.__typename === "CheckRun"))) sources.push(`${commit}/check-runs?per_page=100`);
  if (unseen || pending.some((c) => c.__typename === "StatusContext")) sources.push(`${commit}/status?per_page=100`);
  return sources;
}

/**
 * Reloads the head commit's checks when they change, while the page is visible. Once none are
 * pending, reloads the whole PR, since finished checks change its merge state.
 */
export function useCheckPolling(owner: string, repo: string, number: number, pull: PullMeta | undefined) {
  const sources = pull ? pendingCheckSources(owner, repo, pull).join(" ") : "";
  const headRefOid = pull?.headRefOid;
  useEffect(() => {
    if (!sources || !headRefOid) return;
    const etags = new Map<string, string>();
    let lastChange = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      if (!stopped) timer = setTimeout(poll, Date.now() - lastChange < QUIET_MS ? FAST_MS : SLOW_MS);
    };
    const poll = async () => {
      if (document.hidden || isRateLimitLow("core") || isRateLimitLow("graphql")) return schedule();
      let changed = false;
      try {
        for (const path of sources.split(" ")) {
          const res = await restRaw(path, { text: true, etag: etags.get(path) });
          if (res.status === 304) continue;
          const etag = res.headers.get("etag") ?? "";
          if (etags.has(path) && etags.get(path) !== etag) changed = true;
          etags.set(path, etag);
        }
      } catch (e) {
        // Stop on errors a retry won't fix soon, like a missing permission or a rate limit.
        if (e instanceof GitHubError && e.status >= 400 && e.status < 500) return;
      }
      if (stopped) return;
      if (changed) {
        lastChange = Date.now();
        await reloadChecks().catch(() => {});
      }
      schedule();
    };
    const reloadChecks = async () => {
      const rollup = await fetchRollup(owner, repo, number, headRefOid);
      const key = keys.pull(owner, repo, number);
      const pull = queryClient.getQueryData<PullMeta>(key);
      if (stopped || pull?.headRefOid !== headRefOid) return;
      queryClient.setQueryData<PullMeta>(key, { ...pull, rollup });
      persistQueryData(key);
      if (rollup?.hasNextPage) void queryClient.invalidateQueries({ queryKey: keys.checks(owner, repo, headRefOid) });
      if (!pendingCheckSources(owner, repo, { ...pull, rollup }).length) void queryClient.invalidateQueries({ queryKey: key });
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [owner, repo, number, headRefOid, sources]);
}
