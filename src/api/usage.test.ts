// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({ createStore: () => undefined, get: async () => undefined, set: async () => {}, del: async () => {}, clear: async () => {} }));

const now = 1_700_000_000_000;

/** A fresh copy of the usage module, like one in a newly opened tab. */
async function openTab() {
  vi.resetModules();
  return import("./usage");
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("restOperationName", () => {
  it("names REST requests by their path template", async () => {
    const { restOperationName } = await openTab();
    expect(restOperationName("GET", "https://api.github.com/repos/cli/cli/pulls/12/files?per_page=100&page=2")).toBe("GET /repos/{owner}/{repo}/pulls/{number}/files");
    expect(restOperationName("GET", "/repos/cli/cli/commits/0123abcd/check-runs?per_page=100")).toBe("GET /repos/{owner}/{repo}/commits/{ref}/check-runs");
    expect(restOperationName("GET", "/repos/cli/cli/compare/main...feature%2Fx?per_page=1")).toBe("GET /repos/{owner}/{repo}/compare/{basehead}");
    expect(restOperationName("GET", "/repos/cli/cli/contents/src/app/main.ts?ref=main")).toBe("GET /repos/{owner}/{repo}/contents/{path}");
    expect(restOperationName("POST", "/repos/cli/cli/git/refs")).toBe("POST /repos/{owner}/{repo}/git/refs");
    expect(restOperationName("GET", "/repos/cli/cli/activity?per_page=100")).toBe("GET /repos/{owner}/{repo}/activity");
    expect(restOperationName("GET", "https://api.github.com/user")).toBe("GET /user");
  });
});

describe("usage", () => {
  it("adds up usage from every tab, including closed ones", async () => {
    const first = await openTab();
    first.recordUsage("octocat", "graphql", "PullMeta", { points: 2 });
    first.recordUsage("octocat", "core", "GET /user", { points: 1 });
    vi.advanceTimersByTime(1000);
    const second = await openTab();
    second.recordUsage("octocat", "graphql", "PullMeta", { points: 3 });
    second.recordUsage("octocat", "graphql", "AddComment", { points: 1, estimated: true });
    second.recordUsage("hubot", "graphql", "PullMeta", { points: 50 });

    expect(second.usageByOperation(second.usageEntries("octocat"))).toEqual([
      { resource: "graphql", name: "PullMeta", requests: 2, points: 5, estimated: 0, free: 0 },
      { resource: "graphql", name: "AddComment", requests: 1, points: 1, estimated: 1, free: 0 },
      { resource: "core", name: "GET /user", requests: 1, points: 1, estimated: 0, free: 0 },
    ]);
  });

  it("forgets usage after 24 hours", async () => {
    const first = await openTab();
    first.recordUsage("octocat", "graphql", "PullMeta", { points: 2 });
    vi.advanceTimersByTime(1000);
    vi.setSystemTime(now + 24 * 60 * 60_000 + 60_000);
    const later = await openTab();
    expect(later.usageEntries("octocat")).toEqual([]);
    expect(localStorage.length).toBe(0);
  });
});

describe("client usage", () => {
  async function client(body: unknown, init: ResponseInit) {
    const { auth } = await openTab().then(() => import("@/auth/token"));
    auth.set({ status: "signed-in", token: "ghp_a", viewer: { login: "octocat", name: null, avatarUrl: "", url: "" } });
    vi.stubGlobal("fetch", async () => new Response(body === undefined ? null : JSON.stringify(body), init));
    return { ...(await import("./client")), ...(await import("./operation")), ...(await import("./usage")) };
  }
  const graphqlHeaders = { "x-ratelimit-resource": "graphql" };

  it("records a query's cost and leaves it out of the data", async () => {
    const c = await client({ data: { gitgudCost: { cost: 3 }, viewer: { login: "octocat" } } }, { headers: graphqlHeaders });
    expect(await c.gql(c.gqlQuery("Viewer", "", "viewer { login }"))).toEqual({ viewer: { login: "octocat" } });
    expect(c.usageByOperation(c.usageEntries("octocat"))).toEqual([{ resource: "graphql", name: "Viewer", requests: 1, points: 3, estimated: 0, free: 0 }]);
  });

  it("estimates a mutation as 1 point", async () => {
    const c = await client({ data: { reopenIssue: { issue: { id: "I_1" } } } }, { headers: graphqlHeaders });
    await c.gql(c.gqlMutation("ReopenIssue", "$id: ID!", "reopenIssue(input: { issueId: $id }) { issue { id } }"), { id: "I_1" });
    expect(c.usageByOperation(c.usageEntries("octocat"))).toEqual([{ resource: "graphql", name: "ReopenIssue", requests: 1, points: 1, estimated: 1, free: 0 }]);
  });

  it("estimates a REST GET as 1 point, since the browser may have revalidated it", async () => {
    const c = await client({ login: "octocat" }, { headers: { "x-ratelimit-resource": "core" } });
    await c.rest("/user");
    expect(c.usageByOperation(c.usageEntries("octocat"))).toEqual([{ resource: "core", name: "GET /user", requests: 1, points: 1, estimated: 1, free: 0 }]);
  });

  it("counts unchanged REST responses as free", async () => {
    const c = await client(undefined, { status: 304, headers: { "x-ratelimit-resource": "core", etag: '"a"' } });
    await c.restRaw("/repos/cli/cli/commits/0123abcd/status?per_page=100", { etag: '"a"' });
    expect(c.usageByOperation(c.usageEntries("octocat"))).toEqual([
      { resource: "core", name: "GET /repos/{owner}/{repo}/commits/{ref}/status", requests: 1, points: 0, estimated: 0, free: 1 },
    ]);
  });
});

describe("ranges", () => {
  const entry = (minute: number, resource: "graphql" | "core", points: number) => ({ minute, resource, name: "Op", requests: 1, points, estimated: 0, free: 0 });

  it("keeps entries in each limit's running window", async () => {
    const { entriesInWindows } = await openTab();
    const reset = now / 1000 + 20 * 60; // started 40 minutes ago
    const limits = { graphql: { remaining: 4990, limit: 5000, reset }, core: { remaining: 10, limit: 5000, reset: now / 1000 - 1 } };
    const inside = entry(now - 30 * 60_000, "graphql", 3);
    const before = entry(now - 50 * 60_000, "graphql", 4);
    const expired = entry(now - 5 * 60_000, "core", 1);
    expect(entriesInWindows([inside, before, expired], limits, now)).toEqual([inside]);
  });

  it("adds up points by clock hour for the last 24 hours", async () => {
    const { pointsByHour } = await openTab();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const thisHour = hourStart.getTime();
    const hours = pointsByHour(
      [entry(thisHour + 60_000, "graphql", 3), entry(thisHour, "core", 1), entry(thisHour - 60_000, "graphql", 5), entry(thisHour - 24 * 3600_000, "graphql", 9)],
      now,
    );
    expect(hours).toHaveLength(24);
    expect(hours.at(-1)).toEqual({ start: thisHour, graphql: 3, rest: 1 });
    expect(hours.at(-2)).toEqual({ start: thisHour - 3600_000, graphql: 5, rest: 0 });
    expect(hours.reduce((n, h) => n + h.graphql + h.rest, 0)).toBe(9);
  });
});
