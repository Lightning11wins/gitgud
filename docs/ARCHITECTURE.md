# Architecture

gitgud is a static React SPA. Every user's token, cache, and drafts live in their own browser. The browser calls `api.github.com` directly; the server only serves files.

See `REQUIREMENTS.md` for the product spec.

## Layout

```
src/
  api/          client.ts (gql, rest, restAll, gqlAll, mapLimit), queryClient.ts (cache), keys.ts, types.ts, rateLimit.ts
  auth/         token storage + login screen
  components/   shared UI: Layout, Avatar, Button styles, StateBadge, IssueLabel, RelativeTime, Markdown,
                Popover, Dialog, SelectMenu, Spinner, ErrorBanner
  lib/          store (tiny observable), hotkeys, drafts, theme, time, githubUrl
  styles/       base.css (Primer-like tokens + primitives), markdown.css
  features/
    dashboard/  home page
    repo/       /:owner/:repo issue+PR list
    issue/      issue page, new issue page
    conversation/ timeline + comment rendering (issues and PR conversation tab)
    composer/   Composer (markdown editor)
    sidebar/    labels / assignees / milestone / issue type / sub-issues sidebar
    pull/       PR page shell, header, tabs, merge box, commits, checks, compare/new PR
    diff/       Files changed: split diff, file tree, highlighting worker
    review/     review threads, pending review, submit review
server/serve.mjs  static server with CSP and compression
```

## Data and caching

- All server data goes through TanStack Query. `queryClient` persists every query to IndexedDB per query, so pages render instantly from cache, then revalidate on mount and on window focus.
- Use the shared query keys in `api/keys.ts`. After a mutation, update the cache optimistically with `queryClient.setQueryData` where it's cheap, then `invalidateQueries` on the affected keys.
- Prefer GraphQL (`gql`) for reads: one request fetches what REST needs several for. Use `gqlAll` to follow connections to the end. Never show a "load more" button; fetch everything.
- REST (`rest`, `restAll`) is fine where GraphQL lacks something (PR files with patches, file contents, `/markdown`). `restAll` fetches pages in parallel.
- For expensive queries, use `probeThenLoad` from `api/queryClient.ts`: a 1-point probe (e.g. `updatedAt`) skips the full reload when nothing changed.
- `bodyHTML` / `body_html` is GitHub-rendered HTML. Render it only through `components/Markdown.tsx`, which sanitizes it with DOMPurify. Never use `dangerouslySetInnerHTML` elsewhere.
- Every request is counted in `window.__gitgudApiStats` and the rate limit is shown in the header. Keep request counts low: no polling, and no fetching per item in a list.
- A 401 from GitHub returns to the sign-in screen at the same URL. Signing in as the same user keeps the cache and drafts; another user starts clean.
- Save drafts with `drafts.setSoon` (debounced); `drafts.clear` and sign-out cancel pending writes.

## Performance rules

- Long lists must stay smooth with thousands of items. Use `content-visibility: auto` with `contain-intrinsic-size` for things users search with Ctrl+F (timelines, diffs), or `@tanstack/react-virtual` where Ctrl+F doesn't matter or the DOM would be enormous.
- Keep heavy work off the main thread (syntax highlighting runs in a Web Worker).
- Memoize rows (`memo`) and keep props stable so one comment changing doesn't re-render the whole page.

## UI conventions

- Look like GitHub (Primer), but denser. Use the CSS variables in `styles/base.css`; never hard-code colors. Both light and dark themes must work.
- Icons come from `@primer/octicons-react`.
- Class primitives: `.btn` (`.primary`, `.danger`, `.invisible`, `.sm`, `.xs`, `.icon`), `.input`, `.box`, `.box-header`, `.box-row`, `.label`, `.counter`, `.tabs`, `.flash`, `.row`, `.grow`, `.muted`, `.truncate`.
- Put feature CSS in a `.css` file next to the feature and import it from the feature's entry component.
- Keyboard: `useHotkey` from `lib/hotkeys.ts`. Core keys: `j`/`k` move, `/` jump box, `r` reply, `n`/`p` next/prev file, Ctrl+Enter submit, Esc cancel.
- Routes mirror github.com paths (see `App.tsx`). The header has an "Open on GitHub" link for every page.
- Error messages start with "Failed to ..." and include the offending value.

## Shared contracts

- `features/composer/Composer.tsx`: `Composer` props are the contract (draftKey, owner, repo, onSubmit, actions, ...). Drafts persist in IndexedDB.
- `features/conversation/Timeline.tsx`: `Timeline({ owner, repo, number, kind: "issue" | "pull", subject })` renders the conversation (comments, events, and, for PRs, reviews with their threads) plus the bottom comment box.
- `features/sidebar/MetadataSidebar.tsx`: `MetadataSidebar({ subject: SubjectMeta, owner, repo, children? })` renders and edits assignees, labels, milestone, issue type, and sub-issues. `children` is extra sections (e.g. reviewers for PRs). After edits it invalidates `keys.issue` or `keys.pull`.
- `features/review/threads.ts`: `useReviewThreads` / `fetchReviewThreads`: every review thread and comment for a PR (`keys.reviewThreads`).
- `features/review/ReviewThread.tsx`: `ReviewThreadView({ thread, owner, repo, number })` renders one thread with reply, resolve, edit, delete, reactions.
- `features/review/ReviewSubmit.tsx`: `ReviewSubmitButton({ owner, repo, number, pullId })`: the "Review changes" / "Finish your review" button and popover.
- `features/review/pending.ts`: the viewer's pending review on GitHub (`keys.pendingReview`).
- `features/diff/FilesChanged.tsx`: `FilesChanged({ owner, repo, number })` for a PR, `CommitFiles({ owner, repo, sha })` for a single commit, and `CompareFiles({ owner, repo, base, head })` for the new-PR page.
- `api/prefetch.ts`: pages call `registerPrefetcher` at module load; list rows call `prefetchSubject` on hover.
- `features/pull/PullPage.tsx` owns `/:owner/:repo/pull/:number/*` and fetches PR metadata into `keys.pull`.
