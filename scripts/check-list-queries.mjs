// Validates the repo list GraphQL queries against the live schema using the gh CLI token, and prints each PR's check summary.
// Usage: node scripts/check-list-queries.mjs [search]
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const q = process.argv[2] ?? "is:pr is:open repo:cli/cli sort:created-desc";
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const { LIST_QUERY, CHECKS_QUERY, summarizeChecks } = await server.ssrLoadModule("/src/features/repo/searchList.ts");
await server.close();

function run(name, query) {
  let out;
  try {
    out = execFileSync("gh", ["api", "graphql", "--input", "-"], { encoding: "utf8", input: JSON.stringify({ query, variables: { q, first: 10 } }) });
  } catch (e) {
    out = e.stdout;
  }
  const data = JSON.parse(out);
  console.log(name, data.errors ? JSON.stringify(data.errors, null, 1) : "OK", out.length, "bytes");
  return data.data?.search.nodes ?? [];
}

const items = run("list", LIST_QUERY);
const checks = new Map(run("checks", CHECKS_QUERY).filter((n) => n.id).map((n) => [n.id, summarizeChecks(n.statusCheckRollup)]));
for (const n of items) {
  const c = checks.get(n.id);
  console.log(`#${n.number}`, c ? `${c.state} ${c.passed}/${c.total}` : c === null ? "no checks" : "missing from checks");
}
