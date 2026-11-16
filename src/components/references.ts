import { gqlPartial } from "@/api/client";
import type { IssueStateReason } from "@/api/types";

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** What an issue or PR reference shows: its title and state. */
export interface Reference {
  kind: "issue" | "pull";
  title: string;
  state: string;
  stateReason?: IssueStateReason;
  isDraft?: boolean;
}

/** The issue or PR a github.com URL points to, or null for any other URL. */
export function parseReference(href: string): IssueRef | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)$/.exec(href);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

/** Most references fetched in one request. */
const BATCH_SIZE = 50;

type Waiter = { ref: IssueRef; resolve: (r: Reference | null) => void; reject: (e: unknown) => void };
let queue: Waiter[] = [];

/**
 * Loads an issue or PR's title and state, or null when it can't be seen. Calls made in the same
 * task share one request.
 */
export function fetchReference(ref: IssueRef): Promise<Reference | null> {
  return new Promise((resolve, reject) => {
    queue.push({ ref, resolve, reject });
    if (queue.length === 1) setTimeout(flush);
  });
}

function flush() {
  const waiters = queue;
  queue = [];
  for (let i = 0; i < waiters.length; i += BATCH_SIZE) fetchBatch(waiters.slice(i, i + BATCH_SIZE));
}

type Node = { __typename: "Issue" | "PullRequest"; title: string; state: string; stateReason?: IssueStateReason; isDraft?: boolean };

async function fetchBatch(waiters: Waiter[]) {
  const params = waiters.map((_, i) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`).join(", ");
  const parts = waiters.map(
    (_, i) => `i${i}: repository(owner: $o${i}, name: $r${i}) { issueOrPullRequest(number: $n${i}) {
      __typename
      ... on Issue { title state stateReason }
      ... on PullRequest { title state isDraft }
    } }`,
  );
  const vars = Object.fromEntries(waiters.flatMap(({ ref }, i) => [[`o${i}`, ref.owner], [`r${i}`, ref.repo], [`n${i}`, ref.number]]));
  try {
    const { data } = await gqlPartial<Record<string, { issueOrPullRequest: Node | null } | null>>(
      `query References(${params}) {\n${parts.join("\n")}\n}`,
      vars,
    );
    waiters.forEach(({ resolve }, i) => {
      const node = data[`i${i}`]?.issueOrPullRequest;
      if (!node) return resolve(null);
      const { __typename, ...rest } = node;
      resolve({ kind: __typename === "PullRequest" ? "pull" : "issue", ...rest });
    });
  } catch (e) {
    for (const { reject } of waiters) reject(e);
  }
}
