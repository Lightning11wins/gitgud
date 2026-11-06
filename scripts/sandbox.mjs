// The sandbox repo that write tests use: GITGUD_SANDBOX (owner/name) from the environment or the repo's .env.
import { existsSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
if (!process.env.GITGUD_SANDBOX && existsSync(envFile)) process.loadEnvFile(envFile);

/** Returns the sandbox repo, or exits when GITGUD_SANDBOX isn't set. */
export function sandbox() {
  const repo = process.env.GITGUD_SANDBOX ?? "";
  const [owner, name, extra] = repo.split("/");
  if (!owner || !name || extra !== undefined) {
    console.error(`Failed to find the sandbox repo: GITGUD_SANDBOX must be owner/name (got "${repo}"). See docs/DEVELOPMENT.md.`);
    process.exit(1);
  }
  return { repo, owner, name };
}
