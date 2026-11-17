import { describe, expect, it, vi } from "vitest";
import type { CheckContext, CheckRollup, PullMeta } from "./api";
import { checkSources, checksPending, matchesRollup } from "./checkPolling";

vi.mock("@/api/queryClient", () => ({ queryClient: {} }));
vi.mock("@/api/client", () => ({ GitHubError: Error, restRaw: () => {} }));

const RUNS = "/repos/o/r/commits/abc/check-runs?per_page=100";
const STATUS = "/repos/o/r/commits/abc/status?per_page=100";

const run = (status: string, conclusion: string | null = null, id = "CR_kwDOD1jqbs8AAAAfRUXXUQ") =>
  ({ __typename: "CheckRun", id, name: "build", status, conclusion }) as CheckContext;
const status = (state: string, id = "SC_kwDNIULPAAAADcfObqM") => ({ __typename: "StatusContext", id, context: "ci", state }) as CheckContext;
const rollup = (state: CheckRollup["state"], contexts: CheckContext[]): CheckRollup => ({ state, totalCount: contexts.length, hasNextPage: false, endCursor: null, contexts });
const pull = (over: Partial<PullMeta> = {}) =>
  ({ state: "OPEN", headRefOid: "abc", checksForbidden: false, checkRunsHidden: false, rollup: null, baseRef: null, ...over }) as PullMeta;
const finished = rollup("SUCCESS", [run("COMPLETED", "SUCCESS"), status("SUCCESS")]);

describe("checksPending", () => {
  it("is true while a check runs or a required check hasn't reported", () => {
    expect(checksPending(pull({ rollup: rollup("PENDING", [run("IN_PROGRESS"), status("SUCCESS")]) }))).toBe(true);
    expect(checksPending(pull({ rollup: rollup("PENDING", [run("COMPLETED", "SUCCESS"), status("PENDING")]) }))).toBe(true);
    expect(checksPending(pull({ rollup: rollup("EXPECTED", [run("COMPLETED", "SUCCESS")]) }))).toBe(true);
    expect(checksPending(pull({ baseRef: { refUpdateRule: { requiredStatusCheckContexts: ["ci"] } } }))).toBe(true);
  });

  it("is false when every check has finished or there are none", () => {
    expect(checksPending(pull({ rollup: finished }))).toBe(false);
    expect(checksPending(pull())).toBe(false);
  });
});

describe("checkSources", () => {
  it("watches an open PR's checks even when none are pending, since workflows can add more", () => {
    expect(checkSources("o", "r", pull({ rollup: finished }))).toEqual([RUNS, STATUS]);
    expect(checkSources("o", "r", pull())).toEqual([RUNS, STATUS]);
  });

  it("watches a closed PR only while its checks are pending", () => {
    expect(checkSources("o", "r", pull({ state: "MERGED", rollup: finished }))).toEqual([]);
    expect(checkSources("o", "r", pull({ state: "MERGED", rollup: rollup("PENDING", [run("IN_PROGRESS")]) }))).toEqual([RUNS, STATUS]);
  });

  it("skips check runs the token can't read", () => {
    expect(checkSources("o", "r", pull({ checkRunsHidden: true }))).toEqual([STATUS]);
    expect(checkSources("o", "r", pull({ checksForbidden: true, rollup: rollup("PENDING", [run("IN_PROGRESS")]) }))).toEqual([]);
  });
});

describe("matchesRollup", () => {
  const restRun = (status: string, conclusion: string | null = null, node_id = "CR_kwDOD1jqbs8AAAAfRUXXUQ") => ({ node_id, status, conclusion });
  const runs = (...check_runs: ReturnType<typeof restRun>[]) => ({ total_count: check_runs.length, check_runs });

  it("matches listings with the same checks in the same states", () => {
    expect(matchesRollup(runs(restRun("completed", "success")), finished)).toBe(true);
    expect(matchesRollup({ total_count: 1, statuses: [{ node_id: "SC_kwDNIULPAAAADcfObqM", state: "success" }] }, finished)).toBe(true);
    expect(matchesRollup(runs(), null)).toBe(true);
  });

  it("detects checks added or changed since the rollup loaded", () => {
    expect(matchesRollup(runs(restRun("queued")), null)).toBe(false);
    expect(matchesRollup(runs(restRun("completed", "success"), restRun("queued", null, "CR_kwDOD1jqbs8AAAAfRUXlIw")), finished)).toBe(false);
    expect(matchesRollup(runs(restRun("completed", "success")), rollup("PENDING", [run("IN_PROGRESS")]))).toBe(false);
    expect(matchesRollup({ total_count: 1, statuses: [{ node_id: "SC_kwDNIULPAAAADcfObqM", state: "failure" }] }, finished)).toBe(false);
  });

  it("can't match listings past their first page", () => {
    expect(matchesRollup({ ...runs(restRun("completed", "success")), total_count: 101 }, finished)).toBe(false);
    expect(matchesRollup(runs(restRun("completed", "success")), { ...finished, hasNextPage: true })).toBe(false);
  });
});
