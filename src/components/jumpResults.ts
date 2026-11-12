import type { QueryClient } from "@tanstack/react-query";
import { gqlPartial } from "@/api/client";
import type { IssueStateReason } from "@/api/types";
import type { OwnerData } from "@/features/owner/ownerData";
import type { ListData } from "@/features/repo/searchList";
import { repoPath, toAppPath } from "@/lib/githubUrl";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoHit {
  owner: string;
  name: string;
  visibility?: "PUBLIC" | "PRIVATE" | "INTERNAL";
  isFork?: boolean;
}

export interface OwnerHit {
  login: string;
  avatarUrl: string;
}

export interface SubjectHit {
  /** owner/name of the subject's repo. */
  repo: string;
  number: number;
  title: string;
  isPull: boolean;
  state: string;
  stateReason?: IssueStateReason;
  isDraft?: boolean;
}

export interface JumpHits {
  repos: RepoHit[];
  owners: OwnerHit[];
  subjects: SubjectHit[];
}

export type JumpRow = { path: string } & (
  | { kind: "jump"; label: string }
  | ({ kind: "repo" } & RepoHit)
  | ({ kind: "owner" } & OwnerHit)
  | ({ kind: "subject" } & SubjectHit)
);

const MAX_REPOS = 5;
const MAX_OWNERS = 3;
const MAX_SUBJECTS = 5;

/** The page that typed text names explicitly: `#123` (inside a repo), `owner/repo#123`, or a URL. Bare names may be half typed, so they aren't targets. */
export function jumpTarget(text: string, repo: RepoRef | null): { path: string; label: string } | null {
  const t = text.trim();
  const num = /^#?(\d+)$/.exec(t);
  if (num && repo) return { path: `/${repo.owner}/${repo.repo}/issues/${num[1]}`, label: `${repo.owner}/${repo.repo}#${num[1]}` };
  if (/^[\w.-]+(\/[\w.-]*)?$/.test(t)) return null;
  const path = toAppPath(t);
  return path ? { path, label: t } : null;
}

/** True when GitHub's search can add suggestions for `text`. Numbers and URLs only jump. */
export function isSearchable(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && !/^#?\d+$/.test(t) && !t.includes("://");
}

/**
 * Suggestions for the jump box, best first: the jump target, exact name matches, the current repo's
 * issues and PRs, then repos and owners. Within each group, `cached` hits that match `text` come
 * before `live` hits, which are already search results and show even when they don't match.
 */
export function jumpRows(text: string, repo: RepoRef | null, cached: JumpHits, live?: JumpHits): JumpRow[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const inRepo = (s: SubjectHit) => !!repo && s.repo.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase();
  const pick = <T>(hits: T[], liveHits: T[] | undefined, fields: (h: T) => string[], toRow: (h: T) => JumpRow) => {
    const scored = (list: T[]) => list.map((h) => ({ row: toRow(h), s: score(q, fields(h)) })).sort((a, b) => a.s - b.s);
    return [...scored(hits).filter((x) => x.s < Infinity), ...scored(liveHits ?? [])];
  };

  const target = jumpTarget(text, repo);
  const groups: [{ row: JumpRow; s: number }[], number][] = [
    [target ? [{ row: { kind: "jump", ...target }, s: 0 }] : [], 1],
    [
      pick(cached.subjects.filter(inRepo), live?.subjects, (s) => [s.title, `#${s.number}`], (s) => ({
        kind: "subject",
        path: `/${s.repo}/${s.isPull ? "pull" : "issues"}/${s.number}`,
        ...s,
      })),
      MAX_SUBJECTS,
    ],
    [pick(cached.repos, live?.repos, (r) => [r.name, `${r.owner}/${r.name}`], (r) => ({ kind: "repo", path: repoPath(r.owner, r.name), ...r })), MAX_REPOS],
    [pick(cached.owners, live?.owners, (o) => [o.login], (o) => ({ kind: "owner", path: `/${o.login}`, ...o })), MAX_OWNERS],
  ];

  const seen = new Set<string>();
  const rows = groups.flatMap(([hits, max]) =>
    hits
      .filter(({ row }) => {
        const key = row.path.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, max),
  );
  const exact = (x: { s: number }) => x.s % 3 === 0;
  return [...rows.filter(exact), ...rows.filter((x) => !exact(x))].map((x) => x.row);
}

/** How well `q` matches the best of `fields`, lower is better: exact, then prefix, then containing every word. Earlier fields win ties. */
function score(q: string, fields: string[]): number {
  const words = q.split(/\s+/);
  let best = Infinity;
  fields.forEach((field, i) => {
    const f = field.toLowerCase();
    const s = f === q ? 0 : f.startsWith(q) ? 1 : words.every((w) => f.includes(w)) ? 2 : Infinity;
    best = Math.min(best, i * 3 + s);
  });
  return best;
}

/** Repos, owners, and issues and PRs already in the query cache. */
export function cachedHits(client: QueryClient): JumpHits {
  const hits: JumpHits = { repos: [], owners: [], subjects: [] };
  for (const query of client.getQueryCache().getAll()) {
    const [root, a, b] = query.queryKey;
    const data = query.state.data;
    if (!data) continue;
    if (root === "owner") {
      const { owner, repos } = data as OwnerData;
      hits.owners.push({ login: owner.login, avatarUrl: owner.avatarUrl });
      for (const r of repos) hits.repos.push({ owner: owner.login, name: r.name, visibility: r.visibility, isFork: r.isFork });
    } else if ((root === "repo-list" || root === "repo") && typeof a === "string" && typeof b === "string") {
      hits.repos.push({ owner: a, name: b });
      if (root === "repo-list") {
        for (const i of (data as ListData).items) {
          const isPull = i.__typename === "PullRequest";
          hits.subjects.push({ repo: i.repository.nameWithOwner, number: i.number, title: i.title, isPull, state: i.state, stateReason: i.stateReason, isDraft: i.isDraft });
        }
      }
    }
  }
  return hits;
}

const JUMP_QUERY = `
query Jump($repos: String!, $owners: String!, $withOwners: Boolean!, $subjects: String!, $inRepo: Boolean!) {
  repos: search(type: REPOSITORY, query: $repos, first: ${MAX_REPOS}) {
    nodes { ... on Repository { name owner { login } visibility isFork } }
  }
  owners: search(type: USER, query: $owners, first: ${MAX_OWNERS}) @include(if: $withOwners) {
    nodes { ... on User { login avatarUrl(size: 40) } ... on Organization { login avatarUrl(size: 40) } }
  }
  subjects: search(type: ISSUE_ADVANCED, query: $subjects, first: ${MAX_SUBJECTS}) @include(if: $inRepo) {
    nodes {
      __typename
      ... on Issue { number title state stateReason }
      ... on PullRequest { number title state isDraft }
    }
  }
}`;

type Nodes<T> = { nodes: (T | null)[] } | null | undefined;
type JumpResponse = {
  repos: Nodes<{ name: string; owner: { login: string }; visibility: RepoHit["visibility"]; isFork: boolean }>;
  owners?: Nodes<{ login?: string; avatarUrl?: string }>;
  subjects?: Nodes<{ __typename: string; number?: number; title?: string; state?: string; stateReason?: IssueStateReason; isDraft?: boolean }>;
};

/** GitHub's search results for typed text: repos by name, users and organizations, and, inside `repo`, issues and PRs by title. */
export async function searchJump(text: string, repo: RepoRef | null): Promise<JumpHits> {
  const t = text.trim();
  const slash = t.indexOf("/");
  const { data } = await gqlPartial<JumpResponse>(JUMP_QUERY, {
    repos: slash < 0 ? `${t} in:name` : `user:${t.slice(0, slash)} ${t.slice(slash + 1)} in:name`,
    owners: t,
    withOwners: slash < 0,
    subjects: repo ? `repo:${repo.owner}/${repo.repo} (is:issue OR is:pr) ${t} in:title` : "",
    inRepo: !!repo,
  });
  const nodes = <T>(c: Nodes<T>) => (c?.nodes ?? []).filter((n): n is T => !!n);
  return {
    repos: nodes(data.repos).map((r) => ({ owner: r.owner.login, name: r.name, visibility: r.visibility, isFork: r.isFork })),
    owners: nodes(data.owners).flatMap((o) => (o.login ? [{ login: o.login, avatarUrl: o.avatarUrl ?? "" }] : [])),
    subjects: nodes(data.subjects).flatMap((s) =>
      s.number && repo
        ? [{ repo: `${repo.owner}/${repo.repo}`, number: s.number, title: s.title ?? "", isPull: s.__typename === "PullRequest", state: s.state ?? "", stateReason: s.stateReason, isDraft: s.isDraft }]
        : [],
    ),
  };
}
