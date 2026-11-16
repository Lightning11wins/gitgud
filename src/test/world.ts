import type { FakeGitHub } from "./fakeGitHub";

export interface FakeLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

/** An issue in the fake repository. Tests edit these fields to change what GitHub answers. */
export interface FakeIssue {
  id: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  stateReason: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;
  createdAt: string;
  updatedAt: string;
  labels: FakeLabel[];
  /** Timeline nodes, oldest first. */
  timeline: Record<string, unknown>[];
}

export const VIEWER = { login: "octo", name: "Octo Cat", avatarUrl: "https://avatars.githubusercontent.com/u/1", url: "https://github.com/octo" };
const ACTOR = { __typename: "User", login: VIEWER.login, avatarUrl: VIEWER.avatarUrl, url: VIEWER.url };

let clock = Date.parse("2026-01-01T00:00:00Z");
/** A timestamp later than every earlier one, like GitHub's clock moving on. */
export function tick(): string {
  clock += 60_000;
  return new Date(clock).toISOString();
}

export function comment(id: string, body: string): Record<string, unknown> {
  return {
    __typename: "IssueComment",
    id,
    databaseId: Number(id.replace(/\D/g, "")) || 1,
    author: ACTOR,
    authorAssociation: "OWNER",
    body,
    bodyHTML: `<p>${body}</p>`,
    createdAt: tick(),
    lastEditedAt: null,
    url: `https://github.com/acme/app/issues/1#issuecomment-${id}`,
    isMinimized: false,
    minimizedReason: null,
    viewerCanUpdate: true,
    viewerCanDelete: true,
    viewerCanReact: true,
    viewerCanMinimize: true,
    viewerDidAuthor: true,
    reactionGroups: [],
  };
}

/**
 * A fake `acme/app` repository with issues, answering the list, issue page, and timeline queries from
 * one shared state, so a change made through one query shows in the others like on GitHub.
 */
export function fakeRepo(gh: FakeGitHub, owner = "acme", name = "app") {
  const issues: FakeIssue[] = [];
  const labels: FakeLabel[] = [];
  const slug = `${owner}/${name}`;
  const find = (number: number) => {
    const issue = issues.find((i) => i.number === number);
    if (!issue) throw new Error(`Failed to find fake issue #${number}`);
    return issue;
  };
  const touch = (issue: FakeIssue) => (issue.updatedAt = tick());

  const row = (i: FakeIssue) => ({
    __typename: "Issue",
    id: i.id,
    number: i.number,
    title: i.title,
    url: `https://github.com/${slug}/issues/${i.number}`,
    state: i.state,
    stateReason: i.stateReason,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    author: { login: VIEWER.login, avatarUrl: VIEWER.avatarUrl },
    repository: { nameWithOwner: slug },
    labels: { nodes: i.labels },
    assignees: { nodes: [] },
    comments: { totalCount: i.timeline.filter((t) => t.__typename === "IssueComment").length },
    linkedPrs: { totalCount: 0, nodes: [] },
  });

  const meta = (i: FakeIssue) => ({
    ...row(i),
    body: "",
    bodyHTML: "",
    lastEditedAt: null,
    viewerCanUpdate: true,
    viewerDidAuthor: true,
    locked: false,
    author: ACTOR,
    authorAssociation: "OWNER",
    milestone: null,
    reactionGroups: [],
    repository: { id: "R_1", nameWithOwner: slug, viewerPermission: "ADMIN" },
    issueType: null,
    subIssues: { totalCount: 0, nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    parent: null,
    closedByPullRequestsReferences: { totalCount: 0, nodes: [] },
    participants: { totalCount: 0, nodes: [] },
    issueFieldValues: { nodes: [] },
    viewerCanSetFields: false,
  });

  /** Issues matching the `is:open` / `is:closed` part of a search, newest update first. */
  const search = (q: string) =>
    issues
      .filter(() => /\bis:issue\b/.test(q) || !/\bis:pr\b/.test(q))
      .filter((i) => (/\bis:open\b/.test(q) ? i.state === "OPEN" : /\bis:closed\b/.test(q) ? i.state === "CLOSED" : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const page = <T,>(all: T[], first: number, after: string | null) => {
    const start = after ? Number(after) : 0;
    const nodes = all.slice(start, start + first);
    const end = start + nodes.length;
    return { nodes, pageInfo: { hasNextPage: end < all.length, endCursor: nodes.length ? String(end) : after } };
  };

  gh.gql("SearchList", ({ q, first, after }) => {
    const all = search(q);
    const { nodes, pageInfo } = page(all, first, after);
    return { search: { issueCount: all.length, pageInfo, nodes: nodes.map(row) } };
  });
  gh.gql("SearchChecks", ({ q, first, after }) => {
    const { nodes, pageInfo } = page(search(q), first, after);
    return { search: { pageInfo, nodes: nodes.map((i) => ({ id: i.id })) } };
  });
  gh.gql("RepoCounts", () => {
    const count = (state: string) => ({ issueCount: issues.filter((i) => i.state === state).length });
    return {
      repository: { nameWithOwner: slug, description: "A fake repository", isPrivate: false },
      iOpen: count("OPEN"),
      iClosed: count("CLOSED"),
      pOpen: { issueCount: 0 },
      pClosed: { issueCount: 0 },
    };
  });
  gh.gql("IssueMeta", ({ number }) => ({ repository: { issueOrPullRequest: meta(find(number)) } }));
  gh.gql("SubjectStamp", ({ number }) => ({ repository: { issueOrPullRequest: { updatedAt: find(number).updatedAt } } }));
  gh.gql("IssueTimeline", ({ number, after, skip, withTotal }) => {
    const all = find(number).timeline;
    const start = (after ? Number(after) : 0) + (skip ?? 0);
    const nodes = all.slice(start, start + 100);
    const end = start + nodes.length;
    const timelineItems = {
      nodes,
      pageInfo: { hasNextPage: end < all.length, endCursor: nodes.length ? String(end) : after },
      filteredCount: all.length - (after ? Number(after) : 0),
    };
    const counts = withTotal ? { total: { filteredCount: all.length }, movable: { filteredCount: 0 } } : {};
    return { repository: { issue: { timelineItems, ...counts } } };
  });
  gh.gql("RepoLabels", () => ({ repository: { labels: { nodes: labels, pageInfo: { hasNextPage: false, endCursor: null } } } }));
  gh.gql("UpdateIssueMeta", ({ input: { id, labelIds } }) => {
    const issue = issues.find((i) => i.id === id)!;
    if (labelIds) issue.labels = labelIds.map((l: string) => labels.find((x) => x.id === l)!);
    touch(issue);
    return { updateIssue: { issue: { id } } };
  });
  gh.gql("UpdateIssueTitle", ({ id, title }) => {
    const issue = issues.find((i) => i.id === id)!;
    issue.title = title;
    touch(issue);
    return { updateIssue: { issue: { id } } };
  });

  return {
    issues,
    find,
    touch,
    /** Adds a label to the repository, for issues to use. */
    addLabel(name: string): FakeLabel {
      const label = { id: `L_${name}`, name, color: "d73a4a", description: null };
      labels.push(label);
      return label;
    },
    /** Adds an open issue with a fresh `updatedAt`, so it sorts first. */
    addIssue(fields: Partial<FakeIssue> = {}): FakeIssue {
      const number = issues.length + 1;
      const now = tick();
      const issue: FakeIssue = {
        id: `I_${number}`,
        number,
        title: `Issue ${number}`,
        state: "OPEN",
        stateReason: null,
        createdAt: now,
        updatedAt: now,
        labels: [],
        timeline: [],
        ...fields,
      };
      issues.push(issue);
      return issue;
    },
  };
}
