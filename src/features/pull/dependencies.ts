import { useQuery } from "@tanstack/react-query";
import { gql, gqlPartial } from "@/api/client";
import { gqlQuery } from "@/api/operation";

/** PR numbers a body names with "Depends on #N", in order, without repeats. */
export function dependencyNumbers(body: string): number[] {
  return [...new Set([...body.matchAll(/\bdepends on #(\d+)\b/gi)].map((m) => Number(m[1])))];
}

export interface DependencyPull {
  number: number;
  headRefName: string;
  isCrossRepository: boolean;
  /** `compare.behindBy` counts the branch's commits that the base branch lacks. */
  headRef: { id: string; compare: { behindBy: number } | null } | null;
}

/** What the PR's changes without its dependencies are compared against: a dependency, or why there's none to compare with. */
export type DependencyBase = { pull: DependencyPull } | { problem: string };

type Found = { __typename: "PullRequest"; state: "OPEN" | "CLOSED" | "MERGED" } & DependencyPull;

/**
 * The PR to compare against, given the numbers a PR into `base` depends on in `owner/repo`: the one whose branch
 * contains the others'. Numbers of issues and of merged PRs don't count; null when no others are left.
 */
export async function fetchDependencyBase(owner: string, repo: string, base: string, numbers: number[]): Promise<DependencyBase | null> {
  const params = numbers.map((_, i) => `$n${i}: Int!`).join(", ");
  const parts = numbers.map(
    (_, i) => `d${i}: issueOrPullRequest(number: $n${i}) { __typename ... on PullRequest {
      number state headRefName isCrossRepository headRef { id compare(headRef: $base) { behindBy } }
    } }`,
  );
  const vars = Object.fromEntries(numbers.map((n, i) => [`n${i}`, n]));
  const { data } = await gqlPartial<{ repository: Record<string, Found | { __typename: "Issue" } | null> | null }>(
    gqlQuery("Dependencies", `$owner: String!, $repo: String!, $base: String!, ${params}`, `repository(owner: $owner, name: $repo) { ${parts.join("\n")} }`),
    { owner, repo, base, ...vars },
  );
  const deps: DependencyPull[] = [];
  for (const [i, n] of numbers.entries()) {
    const d = data.repository?.[`d${i}`];
    if (!d) return { problem: `#${n} doesn't exist in ${owner}/${repo}` };
    if (d.__typename !== "PullRequest" || d.state === "MERGED") continue;
    if (d.isCrossRepository) return { problem: `#${n}'s branch is on a fork` };
    if (!d.headRef) return { problem: `#${n}'s branch was deleted` };
    deps.push(d);
  }
  if (deps.length < 2) return deps[0] ? { pull: deps[0] } : null;

  // A branch that contains the others has the most commits beyond the base.
  const ahead = (d: DependencyPull) => d.headRef?.compare?.behindBy ?? 0;
  const top = deps.reduce((a, b) => (ahead(b) > ahead(a) ? b : a));
  const others = deps.filter((d) => d !== top);
  const compared = await gql<{ repository: Record<string, { compare: { status: string } | null } | null> }>(
    gqlQuery(
      "DependencyStack",
      `$owner: String!, $repo: String!, $top: String!, ${others.map((_, i) => `$b${i}: String!`).join(", ")}`,
      `repository(owner: $owner, name: $repo) { ${others.map((_, i) => `c${i}: ref(qualifiedName: $b${i}) { compare(headRef: $top) { status } }`).join("\n")} }`,
    ),
    { owner, repo, top: top.headRefName, ...Object.fromEntries(others.map((d, i) => [`b${i}`, d.headRefName])) },
  );
  const stacked = others.every((_, i) => ["AHEAD", "IDENTICAL"].includes(compared.repository[`c${i}`]?.compare?.status ?? ""));
  return stacked ? { pull: top } : { problem: `No dependency's branch contains all the others (${deps.map((d) => `#${d.number}`).join(", ")})` };
}

export function useDependencyBase(owner: string, repo: string, base: string, numbers: number[]) {
  return useQuery({
    queryKey: ["dependency-base", owner, repo, base, numbers],
    queryFn: () => fetchDependencyBase(owner, repo, base, numbers),
    enabled: numbers.length > 0,
  });
}
