import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keys } from "@/api/keys";
import type { OwnerData } from "@/features/owner/ownerData";
import type { ListData, ListItem } from "@/features/repo/searchList";
import { updateSettings } from "@/lib/settings";
import { cachedHits, jumpRows, type JumpHits } from "./jumpResults";

vi.stubGlobal("location", { origin: "http://localhost" });

const none: JumpHits = { repos: [], owners: [], subjects: [] };
const repo = { owner: "cli", repo: "cli" };
const paths = (rows: { path: string }[]) => rows.map((r) => r.path);

describe("jumpRows", () => {
  beforeEach(() => updateSettings({ repoTab: "all" }));

  it("puts explicit targets first, so Enter opens what was typed", () => {
    const cached: JumpHits = { ...none, repos: [{ owner: "cli", name: "cli" }] };
    expect(paths(jumpRows("#12", repo, cached))).toEqual(["/cli/cli/issues/12"]);
    expect(paths(jumpRows("cli/cli#5", null, cached))).toEqual(["/cli/cli/issues/5"]);
    expect(paths(jumpRows("https://github.com/cli/cli/pull/3", null, cached))).toEqual(["/cli/cli/pull/3"]);
  });

  it("suggests no page for a half-typed name until a real one matches", () => {
    expect(paths(jumpRows("gitgud", null, none))).toEqual([]);
    expect(paths(jumpRows("lightsys/cen", null, none))).toEqual([]);
  });

  it("puts exact name matches first", () => {
    const cached: JumpHits = { ...none, repos: [{ owner: "LightSys", name: "kardia" }] };
    const live: JumpHits = { ...none, repos: [{ owner: "acme", name: "cli-tools" }, { owner: "cli", name: "cli" }], owners: [{ login: "LightSys", avatarUrl: "" }] };
    expect(paths(jumpRows("lightsys", null, cached, live))).toEqual(["/LightSys", "/LightSys/kardia", "/acme/cli-tools", "/cli/cli"]);
    expect(paths(jumpRows("cli/cli", null, none, live))).toEqual(["/cli/cli", "/acme/cli-tools", "/LightSys"]);
  });

  it("shows only cached hits that match, best match first", () => {
    const cached: JumpHits = {
      ...none,
      repos: [
        { owner: "LightSys", name: "kardia" },
        { owner: "acme", name: "centrallix-docs" },
        { owner: "LightSys", name: "centrallix" },
      ],
    };
    expect(paths(jumpRows("centrallix", null, cached))).toEqual(["/LightSys/centrallix", "/acme/centrallix-docs"]);
    expect(paths(jumpRows("lightsys/cen", null, cached))).toEqual(["/LightSys/centrallix"]);
    expect(paths(jumpRows("zzz zzz", null, cached))).toEqual([]);
  });

  it("adds live results after cached ones without repeats", () => {
    const cached: JumpHits = { ...none, repos: [{ owner: "LightSys", name: "kardia" }] };
    const live: JumpHits = { ...none, repos: [{ owner: "LightSys", name: "kardia" }, { owner: "LightSys", name: "centrallix" }], owners: [{ login: "LightSys", avatarUrl: "" }] };
    expect(paths(jumpRows("lightsys kar", null, cached, live))).toEqual(["/LightSys/kardia", "/LightSys/centrallix", "/LightSys"]);
  });

  it("suggests issues and pull requests from the current repo by title", () => {
    const subject = { title: "gh auth login hangs", state: "OPEN", isPull: false };
    const cached: JumpHits = {
      ...none,
      subjects: [
        { ...subject, repo: "cli/cli", number: 9789 },
        { ...subject, repo: "cli/go-gh", number: 5 },
        { ...subject, repo: "cli/cli", number: 14679, isPull: true, title: "Fix auth login stdin" },
      ],
    };
    expect(paths(jumpRows("auth login", repo, cached))).toEqual(["/cli/cli/issues/9789", "/cli/cli/pull/14679"]);
    expect(paths(jumpRows("auth login", null, cached))).toEqual([]);
  });

  it("lists the current repo's issues and pull requests above other repos", () => {
    const live: JumpHits = {
      repos: [{ owner: "acme", name: "auth-login" }],
      owners: [{ login: "authlogin", avatarUrl: "" }],
      subjects: [{ repo: "cli/cli", number: 9789, title: "gh auth login hangs", state: "OPEN", isPull: false }],
    };
    expect(paths(jumpRows("auth login", repo, none, live))).toEqual(["/cli/cli/issues/9789", "/acme/auth-login", "/authlogin"]);
  });
});

describe("cachedHits", () => {
  it("collects repos, owners, and list rows from the query cache", () => {
    const client = new QueryClient();
    const owner: OwnerData = {
      owner: { __typename: "Organization", login: "LightSys", name: "LightSys", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
      repos: [{ name: "kardia", description: null, visibility: "PUBLIC", isArchived: false, isFork: false, pushedAt: null, primaryLanguage: null }],
      total: 1,
      complete: true,
      fullAt: 0,
    };
    client.setQueryData(keys.owner("LightSys"), owner);
    const item = { __typename: "PullRequest", number: 7, title: "Add search", state: "OPEN", isDraft: true, repository: { nameWithOwner: "cli/cli" } } as ListItem;
    const list: ListData = { items: [item], total: 1, hasNextPage: false, endCursor: null };
    client.setQueryData(keys.repoList("cli", "cli", "is:open"), list);

    expect(cachedHits(client)).toEqual({
      owners: [{ login: "LightSys", avatarUrl: owner.owner.avatarUrl }],
      repos: [
        { owner: "LightSys", name: "kardia", visibility: "PUBLIC", isFork: false },
        { owner: "cli", name: "cli" },
      ],
      subjects: [{ repo: "cli/cli", number: 7, title: "Add search", isPull: true, state: "OPEN", stateReason: undefined, isDraft: true }],
    });
  });
});
