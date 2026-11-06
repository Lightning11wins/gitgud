# Agent notes

Read `docs/ARCHITECTURE.md` before changing code, and `docs/DEVELOPMENT.md` before running browser scripts.

- Before finishing: `npx tsc -b`, `npx vitest run`, and `npx vite build --outDir "$TMPDIR/dist"` (keeps `dist/` untouched for a running server).
- UI changes: screenshot light and dark with `scripts/shot.mjs`, and run `scripts/audit-affordances.mjs` after header or shared CSS changes.
- Write to GitHub only in `Lightning11wins/gitgud-sandbox`. Never post, comment, or open issues anywhere else.
- Commands that reach GitHub need network access to `api.github.com`, `github.com`, and `avatars.githubusercontent.com`.
- The product name is "GitGud" in anything users see; `gitgud` is for identifiers.
- Write docs, comments, and UI text without em dashes.
