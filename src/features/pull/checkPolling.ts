import { useEffect, useRef } from "react";
import { GitHubError, restRaw } from "@/api/client";
import { keys } from "@/api/keys";
import { persistQueryData, queryClient } from "@/api/queryClient";
import { isRateLimitLow } from "@/api/rateLimit";
import { fetchRollup, type CheckRollup, type PullMeta } from "./api";
import { checkOutcome } from "./checks";

/** How often to recheck checks while the PR or its checks changed within `QUIET_MS`. */
const FAST_MS = 15_000;
/** How often to recheck quiet checks, like finished ones or a required check that never reports. */
const SLOW_MS = 60_000;
const QUIET_MS = 10 * 60_000;

/** Whether the head commit has checks that haven't finished, or required checks that haven't reported. */
export function checksPending(pull: PullMeta): boolean {
  const rollup = pull.rollup;
  if (!rollup) return (pull.baseRef?.refUpdateRule?.requiredStatusCheckContexts ?? []).some(Boolean);
  return rollup.state === "PENDING" || rollup.state === "EXPECTED" || rollup.contexts.some((c) => checkOutcome(c) === "pending");
}

/**
 * REST endpoints whose ETags change when the head commit's checks do. Watched while the PR is open,
 * since workflows can add checks at any time, and while checks are pending.
 */
export function checkSources(owner: string, repo: string, pull: PullMeta): string[] {
  if (pull.checksForbidden || (pull.state !== "OPEN" && !checksPending(pull))) return [];
  const commit = `/repos/${owner}/${repo}/commits/${pull.headRefOid}`;
  const status = `${commit}/status?per_page=100`;
  return pull.checkRunsHidden ? [status] : [`${commit}/check-runs?per_page=100`, status];
}

type RestChecks =
  | { total_count: number; check_runs: { node_id: string; status: string; conclusion: string | null }[] }
  | { total_count: number; statuses: { node_id: string; state: string }[] };

/** Whether a check source's REST listing shows the same checks and states as the rollup. */
export function matchesRollup(data: RestChecks, rollup: CheckRollup | null): boolean {
  if (rollup?.hasNextPage) return false;
  const contexts = rollup?.contexts ?? [];
  let listed: string[];
  let cached: string[];
  if ("check_runs" in data) {
    if (data.total_count > data.check_runs.length) return false;
    listed = data.check_runs.map((r) => `${r.node_id}:${r.conclusion ?? r.status}`);
    cached = contexts.flatMap((c) => (c.__typename === "CheckRun" ? [`${c.id}:${(c.conclusion ?? c.status).toLowerCase()}`] : []));
  } else {
    if (data.total_count > data.statuses.length) return false;
    listed = data.statuses.map((s) => `${s.node_id}:${s.state}`);
    cached = contexts.flatMap((c) => (c.__typename === "StatusContext" ? [`${c.id}:${c.state.toLowerCase()}`] : []));
  }
  return listed.sort().join(" ") === cached.sort().join(" ");
}

/**
 * Reloads the head commit's checks when they change, while the page is visible. Once none are
 * pending, reloads the whole PR, since finished checks change its merge state.
 */
export function useCheckPolling(owner: string, repo: string, number: number, pull: PullMeta | undefined) {
  const sources = pull ? checkSources(owner, repo, pull).join(" ") : "";
  const headRefOid = pull?.headRefOid;
  const updatedAt = pull?.updatedAt;
  // ETags by path, kept when the PR updates so the next poll is still conditional.
  const etags = useRef(new Map<string, string>());
  useEffect(() => {
    if (!sources || !headRefOid) return;
    const key = keys.pull(owner, repo, number);
    const cached = () => queryClient.getQueryData<PullMeta>(key);
    const initial = cached();
    let lastChange = initial && checksPending(initial) ? Date.now() : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      const lastActivity = Math.max(lastChange, Date.parse(cached()?.updatedAt ?? "") || 0);
      if (!stopped) timer = setTimeout(poll, Date.now() - lastActivity < QUIET_MS ? FAST_MS : SLOW_MS);
    };
    const poll = async () => {
      if (document.hidden || isRateLimitLow("core") || isRateLimitLow("graphql")) return schedule();
      let changed = false;
      try {
        for (const path of sources.split(" ")) {
          const last = etags.current.get(path);
          const res = await restRaw<RestChecks>(path, { etag: last });
          if (res.status === 304) continue;
          const etag = res.headers.get("etag") ?? "";
          // A first response has nothing to compare with but the rollup, which may predate it.
          if (last === undefined ? !matchesRollup(res.data, cached()?.rollup ?? null) : last !== etag) changed = true;
          etags.current.set(path, etag);
        }
      } catch (e) {
        // Stop on errors a retry won't fix soon, like a missing permission or a rate limit.
        if (e instanceof GitHubError && e.status >= 400 && e.status < 500) return;
      }
      if (stopped) return;
      if (changed) {
        lastChange = Date.now();
        // Forget the ETags on failure, so the next poll compares with the rollup again.
        await reloadChecks().catch(() => sources.split(" ").forEach((path) => etags.current.delete(path)));
      }
      schedule();
    };
    const reloadChecks = async () => {
      const rollup = await fetchRollup(owner, repo, number, headRefOid);
      const pull = cached();
      if (stopped || pull?.headRefOid !== headRefOid) return;
      queryClient.setQueryData<PullMeta>(key, { ...pull, rollup });
      persistQueryData(key);
      if (rollup?.hasNextPage) void queryClient.invalidateQueries({ queryKey: keys.checks(owner, repo, headRefOid) });
      if (!checksPending({ ...pull, rollup })) void queryClient.invalidateQueries({ queryKey: key });
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [owner, repo, number, headRefOid, sources, updatedAt]);
}
