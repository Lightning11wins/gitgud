import { createStore as createIdbStore, del, get, set } from "idb-keyval";
import { createStore } from "@/lib/store";

const authDb = createIdbStore("gitgud-auth", "kv");

export interface Viewer {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
}

export interface AuthState {
  status: "loading" | "signed-out" | "signed-in";
  token: string | null;
  viewer: Viewer | null;
  /** The user whose token GitHub rejected; the sign-in screen asks them for a new one. */
  rejected?: Viewer | null;
}

export const auth = createStore<AuthState>({ status: "loading", token: null, viewer: null });

/** The current token, read synchronously by the API client. */
export function getToken(): string | null {
  return auth.get().token;
}

export async function loadAuth() {
  try {
    const [token, viewer] = await Promise.all([get<string>("token", authDb), get<Viewer>("viewer", authDb)]);
    if (token && viewer) auth.set({ status: "signed-in", token, viewer });
    // A stored viewer without a token means GitHub rejected it; the cache and drafts are still theirs.
    else auth.set({ status: "signed-out", token: null, viewer: null, rejected: viewer ?? null });
  } catch {
    auth.set({ status: "signed-out", token: null, viewer: null });
  }
}

/**
 * Validates `token` against the API, then stores it. Keeps the cache and drafts when the token belongs
 * to the user they were saved for, and clears them otherwise. Throws with a readable message on failure.
 */
export async function signIn(token: string) {
  token = token.trim();
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query Viewer { viewer { login name avatarUrl url } }" }),
  });
  if (res.status === 401) throw new Error("Failed to sign in: GitHub rejected this token (401).");
  if (!res.ok) throw new Error(`Failed to sign in: GitHub returned ${res.status} ${res.statusText}.`);
  const body = await res.json();
  const viewer = body?.data?.viewer as Viewer | undefined;
  if (!viewer) throw new Error(`Failed to sign in: ${body?.errors?.[0]?.message ?? "no viewer returned"}.`);
  const previous = auth.get().rejected ?? (await get<Viewer>("viewer", authDb).catch(() => undefined));
  if (previous?.login !== viewer.login) await clearLocalData();
  await Promise.all([set("token", token, authDb), set("viewer", viewer, authDb)]);
  auth.set({ status: "signed-in", token, viewer });
  // Best effort: keep the cache from being evicted under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export async function signOut() {
  // Drop the token first so in-flight requests can't persist into the wiped cache.
  auth.set({ status: "signed-out", token: null, viewer: null });
  await Promise.all([del("token", authDb), del("viewer", authDb)]);
  await clearLocalData();
}

async function clearLocalData() {
  const [{ clearCache }, { drafts }] = await Promise.all([import("@/api/queryClient"), import("@/lib/drafts")]);
  await Promise.all([clearCache(), drafts.clearAll()]);
}

/**
 * Returns to the sign-in screen after GitHub answers a request made in `session` with a 401. The URL,
 * cache, and drafts stay. Ignored when the session has since been replaced, e.g. by signing in again.
 */
export function tokenRejected(session: AuthState) {
  if (auth.get() !== session || session.status !== "signed-in") return;
  auth.set({ status: "signed-out", token: null, viewer: null, rejected: session.viewer });
  void del("token", authDb).catch(() => {});
}
