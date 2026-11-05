// Validates shared GraphQL selection sets against the live schema using the gh CLI token.
import { execFileSync } from "node:child_process";
import { ISSUE_ONLY_FIELDS, PULL_ONLY_FIELDS, REVIEW_THREAD_FIELDS, SUBJECT_META_FIELDS } from "../src/api/types.ts";

const query = `query {
  repository(owner: "cli", name: "cli") {
    issue(number: 1) { ${SUBJECT_META_FIELDS} ${ISSUE_ONLY_FIELDS} }
    pullRequest(number: 10000) { ${SUBJECT_META_FIELDS} ${PULL_ONLY_FIELDS} reviewThreads(first: 2) { nodes { ${REVIEW_THREAD_FIELDS} } } }
  }
}`;
const out = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], { encoding: "utf8" });
const data = JSON.parse(out);
console.log(data.errors ? JSON.stringify(data.errors, null, 2) : "OK: " + data.data.repository.pullRequest.title);
