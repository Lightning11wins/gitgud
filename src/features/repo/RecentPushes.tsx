import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { GitBranchIcon } from "@primer/octicons-react";
import { gql, rest } from "@/api/client";
import { keys } from "@/api/keys";
import { auth } from "@/auth/token";
import { useStore } from "@/lib/store";
import { minuteTick } from "@/lib/time";
import { RelativeTime } from "@/components/RelativeTime";

/** How long after a push its branch gets a banner. */
const RECENT_MS = 60 * 60 * 1000;

interface Push {
  branch: string;
  date: string;
}

interface Activity {
  ref: string;
  timestamp: string;
  activity_type: string;
}

/** The viewer's newest push to each branch in the last hour, newest first. */
async function fetchViewerPushes(owner: string, repo: string, login: string): Promise<Push[]> {
  const activity = await rest<Activity[]>(`/repos/${owner}/${repo}/activity?per_page=100&time_period=day&actor=${encodeURIComponent(login)}`);
  const latest = new Map<string, Push>();
  for (const a of activity) {
    const branch = a.ref.replace(/^refs\/heads\//, "");
    const pushed = a.activity_type === "push" || a.activity_type === "force_push" || a.activity_type === "branch_creation";
    if (pushed && a.ref.startsWith("refs/heads/") && Date.now() - new Date(a.timestamp).getTime() < RECENT_MS && !latest.has(branch)) {
      latest.set(branch, { branch, date: a.timestamp });
    }
  }
  return [...latest.values()];
}

type BranchState = {
  target: { oid: string } | null;
  associatedPullRequests: { nodes: { state: string; headRefOid: string }[] };
} | null;

/** The branches in `branches` that still exist, aren't the default branch, and have no pull request for their newest commit. */
async function fetchPrless(owner: string, name: string, branches: string[]): Promise<{ defaultBranch: string; branches: Set<string> }> {
  const args = branches.map((_, i) => `$b${i}: String!`).join(", ");
  const fields = branches
    .map((_, i) => `b${i}: ref(qualifiedName: $b${i}) { target { oid } associatedPullRequests(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { state headRefOid } } }`)
    .join("\n");
  const data = await gql<{ repository: { defaultBranchRef: { name: string } | null } & Record<string, BranchState> }>(
    `query PrlessBranches($owner: String!, $name: String!, ${args}) { repository(owner: $owner, name: $name) {
      defaultBranchRef { name }
      ${fields}
    } }`,
    { owner, name, ...Object.fromEntries(branches.map((b, i) => [`b${i}`, `refs/heads/${b}`])) },
  );
  const defaultBranch = data.repository.defaultBranchRef?.name ?? "";
  const prless = branches.filter((b, i) => {
    const ref = data.repository[`b${i}`] as BranchState;
    const oid = ref?.target?.oid;
    return b !== defaultBranch && oid && !ref.associatedPullRequests.nodes.some((pr) => pr.state === "OPEN" || pr.headRefOid === oid);
  });
  return { defaultBranch, branches: new Set(prless) };
}

/** Recent pushes by `login` to branches that have no pull request yet, with the default branch to compare them against. */
async function fetchRecentPushes(owner: string, repo: string, login: string): Promise<{ defaultBranch: string; pushes: Push[] }> {
  const pushes = await fetchViewerPushes(owner, repo, login);
  if (!pushes.length) return { defaultBranch: "", pushes };
  const prless = await fetchPrless(owner, repo, pushes.map((p) => p.branch));
  return { defaultBranch: prless.defaultBranch, pushes: pushes.filter((p) => prless.branches.has(p.branch)) };
}

/** GitHub's "had recent pushes" banners: one per branch the viewer pushed in the last hour that has no pull request yet. */
export function RecentPushes({ owner, repo }: { owner: string; repo: string }) {
  useStore(minuteTick);
  const login = useStore(auth).viewer?.login;
  const { data } = useQuery({ queryKey: keys.recentPushes(owner, repo), queryFn: () => fetchRecentPushes(owner, repo, login!), enabled: !!login });
  const shown = data?.pushes.filter((p) => Date.now() - new Date(p.date).getTime() < RECENT_MS) ?? [];
  if (!shown.length) return null;
  return (
    <div className="recent-pushes">
      {shown.map((p) => (
        <div key={p.branch} className="flash warn recent-push">
          <GitBranchIcon size={16} />
          <span className="grow">
            <strong>{p.branch}</strong> had recent pushes <RelativeTime date={p.date} />
          </span>
          <Link className="btn sm primary" to={`/${owner}/${repo}/compare/${data!.defaultBranch}...${p.branch}`}>
            Compare &amp; pull request
          </Link>
        </div>
      ))}
    </div>
  );
}
