import type { QueryKey } from "@tanstack/react-query";

/** Query keys shared across features. Invalidate these after mutations. */
export const keys = {
  viewer: () => ["viewer"] as const,
  dashboard: (section: string) => ["dashboard", section] as const,
  owner: (login: string) => ["owner", login] as const,
  repoList: (owner: string, repo: string, query: string) => ["repo-list", owner, repo, query] as const,
  /** Check summaries for the pull requests in the list at `list`. */
  listChecks: (list: QueryKey) => ["list-checks", ...list] as const,
  repoMeta: (owner: string, repo: string) => ["repo", owner, repo] as const,
  /** Repo header and open/closed counts for the list filter `base`. */
  repoCounts: (owner: string, repo: string, base: string) => ["repo-header", owner, repo, base] as const,
  issue: (owner: string, repo: string, number: number) => ["issue", owner, repo, number] as const,
  pull: (owner: string, repo: string, number: number) => ["pull", owner, repo, number] as const,
  timeline: (owner: string, repo: string, number: number) => ["timeline", owner, repo, number] as const,
  reviewThreads: (owner: string, repo: string, number: number) => ["review-threads", owner, repo, number] as const,
  pullFiles: (owner: string, repo: string, number: number) => ["pull-files", owner, repo, number] as const,
  pendingReview: (owner: string, repo: string, number: number) => ["pending-review", owner, repo, number] as const,
  commits: (owner: string, repo: string, number: number) => ["commits", owner, repo, number] as const,
  checks: (owner: string, repo: string, ref: string) => ["checks", owner, repo, ref] as const,
  labels: (owner: string, repo: string) => ["labels", owner, repo] as const,
  assignable: (owner: string, repo: string) => ["assignable", owner, repo] as const,
  milestones: (owner: string, repo: string) => ["milestones", owner, repo] as const,
};
