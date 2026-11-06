import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRules, originFromRules, parseOrigin, RESERVED_OWNERS as EXTENSION_RESERVED } from "../../extension/rules.js";
import { RESERVED_OWNERS, toAppPath } from "./githubUrl";
import { updateSettings } from "./settings";

vi.stubGlobal("location", { origin: "http://localhost" });

const ORIGIN = "https://gitgud.example:4483";

/** Applies the rules like Firefox does for a top-level navigation, returning the redirect target or null. */
function redirect(url: string, initiator?: string): string | null {
  let best: { priority: number; target: string | null } | null = null;
  for (const rule of buildRules(ORIGIN)) {
    const { condition, action } = rule;
    const host = initiator && new URL(initiator).hostname;
    if (host && condition.excludedInitiatorDomains.some((d) => host === d || host.endsWith("." + d))) continue;
    const match = new RegExp(condition.regexFilter).exec(url);
    if (!match || (best && best.priority >= rule.priority)) continue;
    const target = action.type === "redirect" ? action.redirect.regexSubstitution.replace(/\\(\d)/g, (_, i) => match[i]) : null;
    best = { priority: rule.priority, target };
  }
  return best?.target ?? null;
}

const SUPPORTED = [
  "https://github.com/cli/cli/issues",
  "https://github.com/cli/cli/pulls?q=is%3Aopen",
  "https://github.com/cli/cli/issues/12",
  "https://github.com/cli/cli/issues/new",
  "https://github.com/cli/cli/pull/34",
  "https://github.com/cli/cli/pull/34#issuecomment-56",
  "https://github.com/cli/cli/pull/34/files",
  "https://github.com/cli/cli/pull/34/commits/abc123",
  "https://github.com/cli/cli/pull/34/checks/",
  "https://github.com/cli/cli/compare/main...dev",
  "https://github.com/cli/cli/issues/12?notification_referrer_id=NT_1#issuecomment-56",
];

const UNSUPPORTED = [
  "https://github.com/",
  "https://github.com/cli",
  "https://github.com/cli/cli",
  "https://github.com/cli/cli/blob/main/README.md",
  "https://github.com/cli/cli/actions",
  "https://github.com/cli/cli/pull/34/changes",
  "https://github.com/notifications",
  "https://github.com/settings/profile",
  "https://github.com/orgs/cli/issues",
  "https://gist.github.com/cli/cli/issues/1",
  "https://github.com.evil.example/cli/cli/issues/1",
];

describe("extension rules", () => {
  beforeEach(() => updateSettings({ repoTab: "all" }));

  it("redirects pages GitGud shows to the same path", () => {
    for (const url of SUPPORTED) {
      const u = new URL(url);
      expect(redirect(url, "https://mail.google.com/")).toBe(ORIGIN + u.pathname + u.search + u.hash);
      expect(toAppPath(url)).not.toBeNull();
    }
  });

  it("redirects navigations with no initiator", () => {
    expect(redirect(SUPPORTED[2])).toBe(`${ORIGIN}/cli/cli/issues/12`);
  });

  it("leaves other pages on GitHub", () => {
    for (const url of UNSUPPORTED) expect(redirect(url, "https://mail.google.com/"), url).toBeNull();
  });

  it("leaves navigations from GitHub and GitGud on GitHub", () => {
    for (const from of ["https://github.com/cli/cli", "https://gist.github.com/x", ORIGIN + "/cli/cli/pull/34"])
      expect(redirect(SUPPORTED[4], from)).toBeNull();
  });

  it("skips the same reserved paths as the app", () => {
    expect(new Set(EXTENSION_RESERVED)).toEqual(RESERVED_OWNERS);
  });

  it("round-trips the saved origin", () => {
    expect(originFromRules(buildRules(ORIGIN))).toBe(ORIGIN);
    expect(originFromRules([])).toBeNull();
    expect(parseOrigin(" https://gitgud.example:4483/cli/cli ")).toBe(ORIGIN);
    expect(parseOrigin("javascript:alert(1)")).toBeNull();
    expect(parseOrigin("gitgud.example")).toBeNull();
  });
});
