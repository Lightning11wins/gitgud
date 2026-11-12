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

  it("puts the jump target first, so Enter keeps opening what was typed", () => {
    const cached: JumpHits = { ...none, repos: [{ owner: "cli", name: "cli" }, { owner: "cli", name: "go-gh" }] };
    expect(paths(jumpRows("cli/go-gh", repo, cached))).toEqual(["/cli/go-gh"]);
    expect(paths(jumpRows("#12", repo, none))).toEqual(["/cli/cli/issues/12"]);
    expect(paths(jumpRows("cli", repo, cached))).toEqual(["/cli", "/cli/cli", "/cli/go-gh"]);
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
    expect(paths(jumpRows("centrallix", null, cached))).toEqual(["/centrallix", "/LightSys/centrallix", "/acme/centrallix-docs"]);
    expect(paths(jumpRows("lightsys/cen", null, cached))).toEqual(["/lightsys/cen", "/LightSys/centrallix"]);
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
