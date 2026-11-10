import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  get: async (key: string, s: string) => store(s).get(key),
  set: async (key: string, value: unknown, s: string) => void store(s).set(key, value),
  del: async (key: string, s: string) => void store(s).delete(key),
  update: async (key: string, fn: (v: unknown) => unknown, s: string) => void store(s).set(key, fn(store(s).get(key))),
  clear: async (s: string) => store(s).clear(),
  entries: async (s: string) => [...store(s).entries()],
}));

const { auth, loadAuth, signIn, tokenRejected } = await import("./token");
const { drafts } = await import("@/lib/drafts");

const viewer = (login: string) => ({ login, name: null, avatarUrl: "", url: "" });
function mockViewer(login: string) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { viewer: viewer(login) } }), { status: 200 }));
}

describe("token rejection", () => {
  beforeEach(async () => {
    stores.clear();
    mockViewer("alice");
    await signIn("t1");
    await drafts.set("k", "draft");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs out and remembers who was rejected", () => {
    tokenRejected(auth.get());
    expect(auth.get()).toMatchObject({ status: "signed-out", token: null, rejected: { login: "alice" } });
  });

  it("ignores a 401 from a session that was already replaced", async () => {
    const old = auth.get();
    tokenRejected(old);
    await signIn("t2");
    tokenRejected(old);
    expect(auth.get()).toMatchObject({ status: "signed-in", token: "t2" });
  });

  it("keeps drafts when the same user signs in again", async () => {
    tokenRejected(auth.get());
    await signIn("t2");
    expect(await drafts.get("k")).toBe("draft");
  });

  it("clears drafts when a different user signs in", async () => {
    tokenRejected(auth.get());
    mockViewer("bob");
    await signIn("t3");
    expect(auth.get().viewer?.login).toBe("bob");
    expect(await drafts.get("k")).toBeUndefined();
  });
});

describe("token storage", () => {
  beforeEach(() => {
    stores.clear();
    mockViewer("alice");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stores the token encrypted and reads it back", async () => {
    await signIn("ghp_secret");
    const stored = store("gitgud-auth").get("token");
    expect(typeof stored).not.toBe("string");
    expect(new TextDecoder().decode((stored as { data: ArrayBuffer }).data)).not.toContain("ghp_secret");
    await loadAuth();
    expect(auth.get()).toMatchObject({ status: "signed-in", token: "ghp_secret" });
  });

  it("encrypts a plain-text token from an older version", async () => {
    store("gitgud-auth").set("token", "ghp_old").set("viewer", viewer("alice"));
    await loadAuth();
    expect(auth.get()).toMatchObject({ status: "signed-in", token: "ghp_old" });
    expect(typeof store("gitgud-auth").get("token")).not.toBe("string");
  });

  it("signs out, keeping the cache, when the key is gone", async () => {
    await signIn("ghp_secret");
    store("gitgud-auth").delete("key");
    await loadAuth();
    expect(auth.get()).toMatchObject({ status: "signed-out", rejected: { login: "alice" } });
  });
});
