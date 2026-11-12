import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({ createStore: () => undefined, get: async () => undefined, set: async () => {}, del: async () => {}, clear: async () => {} }));

const { auth } = await import("@/auth/token");
const { gql, tokenScopes } = await import("./client");

const signIn = (token: string) => auth.set({ status: "signed-in", token, viewer: null });

function respond(headers: Record<string, string>) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: {} }), { headers }));
}

afterEach(() => vi.unstubAllGlobals());

describe("tokenScopes", () => {
  it("reads a classic token's scopes from its responses", async () => {
    signIn("ghp_a");
    respond({ "X-OAuth-Scopes": "repo, read:org" });
    await gql("query A { viewer { login } }");
    expect(tokenScopes()).toEqual(["repo", "read:org"]);
  });

  it("is null for tokens whose responses carry no scopes", async () => {
    signIn("github_pat_b");
    respond({});
    await gql("query B { viewer { login } }");
    expect(tokenScopes()).toBeNull();
  });

  it("is unknown for a token that hasn't made a request", async () => {
    signIn("ghp_c");
    respond({ "X-OAuth-Scopes": "repo" });
    await gql("query C { viewer { login } }");
    signIn("ghp_d");
    expect(tokenScopes()).toBeUndefined();
  });
});
