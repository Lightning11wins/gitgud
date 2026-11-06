// Runs the conversation/issue/sidebar GraphQL documents against the live schema with the gh CLI token.
// Usage: node scripts/check-conversation-queries.ts
import { execFileSync } from "node:child_process";
import * as q from "../src/features/conversation/queries.ts";

function run(name: string, query: string, vars: Record<string, unknown>) {
  let out: string;
  try {
    out = execFileSync("gh", ["api", "graphql", "--input", "-"], { encoding: "utf8", input: JSON.stringify({ query, variables: vars }), stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? String(e);
  }
  const data = JSON.parse(out);
  if (data.errors) console.log(`FAIL ${name}:`, JSON.stringify(data.errors, null, 2));
  else console.log(`OK ${name}:`, JSON.stringify(data.data).slice(0, 300));
  return data.data;
}

run("issue timeline", q.ISSUE_TIMELINE_QUERY, { owner: "Lightning11wins", repo: "gitgud-sandbox", number: 1, types: q.ISSUE_ITEM_TYPES, withTotal: true });
run("pull timeline", q.PULL_TIMELINE_QUERY, { owner: "microsoft", repo: "vscode", number: 288294, types: q.PULL_ITEM_TYPES, withTotal: true, skip: 50 });
run("stamp", q.SUBJECT_STAMP_QUERY, { owner: "Lightning11wins", repo: "gitgud-sandbox", number: 1 });
