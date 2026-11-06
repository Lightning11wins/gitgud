// Validates the repo list GraphQL query against the live schema using the gh CLI token, and prints each PR's check summary.
// Usage: node scripts/check-list-queries.mjs [search]
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const q = process.argv[2] ?? "is:pr is:open repo:cli/cli sort:created-desc";
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const { LIST_QUERY, summarizeChecks } = await server.ssrLoadModule("/src/features/repo/searchList.ts");
await server.close();
let out;
try {
  out = execFileSync("gh", ["api", "graphql", "--input", "-"], { encoding: "utf8", input: JSON.stringify({ query: LIST_QUERY, variables: { q, first: 10 } }) });
} catch (e) {
  out = e.stdout;
}
const data = JSON.parse(out);
console.log("list", data.errors ? JSON.stringify(data.errors, null, 1) : "OK", out.length, "bytes");
for (const n of data.data?.search.nodes ?? []) {
  const c = summarizeChecks(n.statusCheckRollup);
  console.log(`#${n.number}`, c ? `${c.state} ${c.passed}/${c.total}` : "no checks");
}
