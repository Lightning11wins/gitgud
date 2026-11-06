# GitGud requirements

A fast replacement for GitHub's issue and PR web flows, backed by the GitHub API.

## Architecture
- Browser-only SPA. The server only serves static files and never sees tokens or user data.
- Each user pastes their own GitHub token. It's stored plainly in IndexedDB. Sign out wipes the token and the cache.
- All API calls go from the browser straight to api.github.com (GraphQL for bulk reads, REST where needed).
- Cache in IndexedDB, with `navigator.storage.persist()` requested.
- Stack: React + TypeScript + Vite, TanStack Virtual for long lists.
- Strict CSP, all assets self-hosted, all HTML sanitized.
- Served over HTTPS via VPN (Tailscale or work VPN). Ship the static build, a tiny static server, and setup notes for `tailscale serve` and Caddy.
- One shared server for every user.

## Performance
- Cached data renders instantly, then revalidates on page open and on tab focus (ETag/updatedAt so unchanged data is ~free).
- Never "load more": fetch every comment/thread/file automatically.
- Virtualized rendering for timelines, diffs, and file trees.
- Syntax highlighting in a Web Worker.
- Prefetch likely next data (e.g. hovered or listed items) without polling.
- Track API rate-limit usage in dev/testing and keep it low. Show the remaining quota in the UI.

## Routes
- Mirror github.com paths: `/:owner/:repo/pull/:n`, `/:owner/:repo/issues/:n`, `/:owner/:repo`, `/:owner/:repo/pulls`, `/:owner/:repo/issues`, etc.
- Paste-a-GitHub-URL box. An "Open on GitHub" link on every page.

## Home
- One dashboard merging issues and PRs: review requested, assigned, authored, mentioned, across all repos. Simple and quick to get into; may be redesigned later.

## Repo page
- Combined, filterable issues + PRs list for the repo (GitHub search syntax). Code/README links go to github.com.

## Issues
- Create (with templates if easy), edit title/body, comment, edit/delete comments, reactions.
- Labels, assignees, milestones.
- Close with reason (completed / not planned / duplicate), reopen.
- Sub-issues and issue types.

## PRs
- Conversation: full timeline, comments, review threads, reply, resolve/unresolve, reactions, edit/delete, approve/request changes/comment.
- Files changed: split diff only, syntax highlighting, expand context / full file, file tree sidebar (viewed state synced with GitHub, comment counts, name filter), inline and multi-line comments, suggestions, mark file viewed.
- Reviews use GitHub's real pending review (visible and submittable from github.com).
- Commits: list and per-commit diff.
- Checks: status, duration, and summary; clicking opens the logs on GitHub.
- Management: create PR (branch compare + template), edit title/body, labels, assignees, reviewers, milestone, draft/ready, merge (merge/squash/rebase), close/reopen, delete/restore head branch.

## Composer
- Drafts saved in IndexedDB so they survive reload or crash.
- Markdown preview via GitHub's `/markdown` API.
- @user and #ref autocomplete.
- Formatting toolbar (including suggestion).
- Pasting an image shows a notice with a button that opens the item on github.com to attach it there (the API has no upload endpoint).

## UI
- GitHub-like look, denser. Light/dark follows the system, with a manual override.
- Desktop only.
- Core keyboard shortcuts: j/k, `/` search, r reply, n/p next/prev file, Ctrl+Enter submit.

## Testing
- Writes only go to a new private sandbox repo (e.g. `Lightning11wins/gitgud-sandbox`).
- Read-only performance tests may use large public PRs.
