# Agent notes

Read `docs/ARCHITECTURE.md` before changing code, and `docs/DEVELOPMENT.md` before running browser scripts.

- Before finishing: `pnpm exec tsc -b`, `pnpm exec vitest run`, and `pnpm exec vite build --outDir "$TMPDIR/dist"` (keeps `dist/` untouched for a running server).
- UI changes: screenshot light and dark with `scripts/shot.mjs`, and run `scripts/audit-affordances.mjs` and `scripts/audit-alignment.mjs` after header or shared CSS changes.
- Write to GitHub only in the sandbox repo named by `GITGUD_SANDBOX` (see `docs/DEVELOPMENT.md`). If it isn't set, ask. Never post, comment, or open issues anywhere else.
- Commands that reach GitHub need network access to `api.github.com`, `github.com`, and `avatars.githubusercontent.com`.
- The product name is "GitGud" in anything users see; `gitgud` is for identifiers.
- Write docs, comments, and UI text without em dashes.
