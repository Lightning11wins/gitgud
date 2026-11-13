import "fake-indexeddb/auto";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { App } from "@/App";
import { clearCache, queryClient, readRecent } from "@/api/queryClient";
import { auth } from "@/auth/token";
import { drafts } from "@/lib/drafts";
import { fakeGitHub, type FakeGitHub } from "./fakeGitHub";
import { VIEWER } from "./world";

/**
 * Runs each test against a fresh fake GitHub, signed in, with empty caches. Call at the top of a
 * test file; the returned getter gives the current test's fake.
 */
export function useFakeGitHub(): () => FakeGitHub {
  let gh: FakeGitHub;
  beforeEach(() => {
    gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.fetch);
    auth.set({ status: "signed-in", token: "test-token", viewer: VIEWER });
  });
  afterEach(async () => {
    cleanup();
    await clearCache();
    await drafts.clearAll();
    vi.unstubAllGlobals();
  });
  return () => gh;
}

/** Renders the app at `path`. */
export function openApp(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

/** Moves to `path` in the running app, like clicking an in-app link. */
export async function navigate(path: string) {
  await act(async () => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

/** Waits for pending IndexedDB writes, such as persisted queries, to land. */
export async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
}

/**
 * Simulates reloading the tab at `path`: the in-memory cache is dropped and the app starts again from
 * what IndexedDB holds, as `main.tsx` does.
 */
export async function reload(path: string) {
  await settle();
  cleanup();
  queryClient.clear();
  const recent = await readRecent();
  recent.apply();
  return openApp(path);
}
