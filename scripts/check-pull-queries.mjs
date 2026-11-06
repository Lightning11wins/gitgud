// Validates the pull feature's GraphQL queries against the live schema using the gh CLI token.
// Usage: node scripts/check-pull-queries.mjs [owner repo number]
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const [owner = "cli", repo = "cli", number = "12000"] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const api = await server.ssrLoadModule("/src/features/pull/api.ts");
const run = (name, query, vars) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  let out;
  try {
    out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = e.stdout;
  }
  const data = JSON.parse(out);
  console.log(name, data.errors ? JSON.stringify(data.errors, null, 1) : "OK", out.length, "bytes");
  return data;
};
const vars = { owner, repo, number: Number(number) };
run("pull+checks", api.pullQuery(true), vars);
run("pull", api.pullQuery(false), vars);
run("commits", api.commitsQuery(true), vars);
await server.close();
