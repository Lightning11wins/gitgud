# Development

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Browser scripts

The scripts in `scripts/` drive the app in headless Chromium, signed in with the `gh` CLI's token. Each starts its own Vite dev server. Usage is in each file's header.

Launch Chromium with `launchBrowser` from `scripts/browser.mjs`. Behind a proxy with credentials (`HTTPS_PROXY`), it routes through a local relay that adds them, because Playwright turns off the HTTP cache when it answers proxy auth itself. Without the cache, nothing revalidates with ETags and API costs read too high.

Setup: `pnpm exec playwright install chromium`. If the default browser cache isn't writable, set `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers` (gitignored). Scripts must live inside the repo so `playwright` resolves.

| Script | Purpose | Writes to GitHub |
|---|---|---|
| `shot.mjs <path> [out.png]` | Screenshot a page; prints console errors and API request counts. An `out.pdf` prints the page instead | No |
| `audit-affordances.mjs` | Find elements that look clickable but do nothing, and in-app links that 404. Exits 1 on findings | No (blocked) |
| `audit-alignment.mjs` | Find icons and avatars that sit off-center from the text beside them. Exits 1 on findings | No (blocked) |
| `conversation-flows.mjs write <outDir>` | Issue flows: create, comment, edit, react, metadata, sub-issues, close/reopen | Creates and closes a new sandbox issue each run |
| `conversation-flows.mjs perf <outDir>` | Cold and warm load timings for `PATHS` | No |
| `diff-flows.mjs [--write]` | Files changed: tree, expand context, Load diff, viewed, keys, line and range comments | Viewed state (restored); with `--write`, review comments, then discards the pending review |
| `review-flows.mjs` | Pending review, reply, resolve, reactions | Yes, and restores what it changes |
| `pull-flows.mjs <scenario> <outDir>` | `read`, `sandbox` (reviewers, title, draft), `merge`, `compare` | `merge` creates and merges a throwaway PR into sandbox `main` |
| `prefetch-flows.mjs [owner/repo]` | List stand-ins, hover prefetch, seeded PR page, and the click guard; `VERBOSE=1` logs each request | No |
| `diff-perf.mjs <path>` | Files changed benchmark on a production build: load milestones, scrolling into unrendered chunks, interaction and typing latency. Medians over `--runs`; `--cpu 4` throttles, `--json`/`--baseline` compare, `--trace dir` saves Chrome traces and a main-thread breakdown | No (stubbed) |
| `check-*-queries` | Validate GraphQL documents against the live schema | No |

## Sandbox repo

Write tests only touch your own sandbox repo, named by `GITGUD_SANDBOX=owner/name` in the environment or in a `.env` file at the repo root (gitignored). Scripts that need it exit when it isn't set. Public repos are read-only test data (for example `cli/cli` and `microsoft/vscode`). To make a new sandbox, create the branches `big-refactor`, `small-fix`, and `draft-work`, then run `scripts/seed-sandbox.sh`.

Fixtures the scripts expect:

- PR #15: 64 changed files, including `src/inventory.ts`, the large `src/big.json` (hidden behind Load diff), and the deleted `src/server.go`.
- Issue #14: a long timeline. Issue #1: a short one.
- PRs #17 and #18: drafts.

## Known issues

- A timeline can miss a commit when one commit was dropped and another added without a force push.
- The close-with-comment retry state doesn't survive a reload.
- A saved body draft wins over a `?body=` URL parameter.
- The TanStack persister logs an unhandled rejection after a failed refetch.
- An owner page for a huge org loads slowly the first time (microsoft's 8,434 repos take about 3 minutes; GraphQL pages can't be fetched in parallel). Later visits take one request.
