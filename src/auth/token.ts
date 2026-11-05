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
    else auth.set({ status: "signed-out", token: null, viewer: null });
  } catch {
    auth.set({ status: "signed-out", token: null, viewer: null });
  }
}

/** Validates `token` against the API, then stores it. Throws with a readable message on failure. */
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
  await Promise.all([set("token", token, authDb), set("viewer", viewer, authDb)]);
  auth.set({ status: "signed-in", token, viewer });
  // Best effort: keep the cache from being evicted under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export async function signOut() {
  await Promise.all([del("token", authDb), del("viewer", authDb)]);
  const [{ clearCache }, { drafts }] = await Promise.all([import("@/api/queryClient"), import("@/lib/drafts")]);
  await Promise.all([clearCache(), drafts.clearAll()]);
  auth.set({ status: "signed-out", token: null, viewer: null });
}
