import { describe, expect, it, vi } from "vitest";
import type { CheckContext, CheckRollup, PullMeta } from "./api";
import { pendingCheckSources } from "./checkPolling";

vi.mock("@/api/queryClient", () => ({ queryClient: {} }));
vi.mock("@/api/client", () => ({ GitHubError: Error, restRaw: () => {} }));

const RUNS = "/repos/o/r/commits/abc/check-runs?per_page=100";
const STATUS = "/repos/o/r/commits/abc/status?per_page=100";

const run = (status: string, conclusion: string | null = null) => ({ __typename: "CheckRun", id: `R${status}`, name: "build", status, conclusion }) as CheckContext;
const status = (state: string) => ({ __typename: "StatusContext", id: `S${state}`, context: "ci", state }) as CheckContext;
const rollup = (state: CheckRollup["state"], contexts: CheckContext[]): CheckRollup => ({ state, totalCount: contexts.length, hasNextPage: false, endCursor: null, contexts });
const pull = (over: Partial<PullMeta> = {}) =>
  ({ headRefOid: "abc", checksForbidden: false, checkRunsHidden: false, rollup: null, baseRef: null, ...over }) as PullMeta;

describe("pendingCheckSources", () => {
  it("polls nothing when every check has finished", () => {
    expect(pendingCheckSources("o", "r", pull({ rollup: rollup("SUCCESS", [run("COMPLETED", "SUCCESS"), status("SUCCESS")]) }))).toEqual([]);
  });

  it("polls only the kinds that are pending", () => {
    expect(pendingCheckSources("o", "r", pull({ rollup: rollup("PENDING", [run("IN_PROGRESS"), status("SUCCESS")]) }))).toEqual([RUNS]);
    expect(pendingCheckSources("o", "r", pull({ rollup: rollup("PENDING", [run("COMPLETED", "SUCCESS"), status("PENDING")]) }))).toEqual([STATUS]);
  });

  it("polls both kinds for checks that haven't reported yet", () => {
    expect(pendingCheckSources("o", "r", pull({ rollup: rollup("EXPECTED", [run("COMPLETED", "SUCCESS")]) }))).toEqual([RUNS, STATUS]);
    expect(pendingCheckSources("o", "r", pull({ baseRef: { refUpdateRule: { requiredStatusCheckContexts: ["ci"] } } }))).toEqual([RUNS, STATUS]);
  });

  it("polls nothing without a rollup or required checks", () => {
    expect(pendingCheckSources("o", "r", pull())).toEqual([]);
  });

  it("skips check runs the token can't read", () => {
    expect(pendingCheckSources("o", "r", pull({ checkRunsHidden: true, rollup: rollup("PENDING", [status("PENDING")]) }))).toEqual([STATUS]);
    expect(pendingCheckSources("o", "r", pull({ checksForbidden: true, rollup: rollup("PENDING", [run("IN_PROGRESS")]) }))).toEqual([]);
  });
});
