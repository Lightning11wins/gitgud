# Architecture

GitGud is a static React SPA. Every user's token, cache, and drafts live in their own browser. The browser calls `api.github.com` directly; the server only serves files.

See `REQUIREMENTS.md` for the product spec.

## Layout

```
src/
  api/          client.ts (gql, gqlPartial, rest, restAll, gqlAll, mapLimit), queryClient.ts (cache), keys.ts, types.ts, rateLimit.ts, warmUp.ts
  auth/         token storage + login screen
  components/   shared UI: Layout, Avatar, Button styles, StateBadge, IssueLabel, RelativeTime, Markdown,
                Popover, Dialog, SelectMenu, Spinner, ErrorBanner
  lib/          store (tiny observable), hotkeys, drafts, theme, settings, time, githubUrl
  styles/       base.css (Primer-like tokens + primitives), markdown.css
  features/
    dashboard/  home page
    owner/      /:owner user or organization repo list
    repo/       /:owner/:repo issue+PR list
    issue/      issue page, new issue page
    conversation/ timeline + comment rendering (issues and PR conversation tab)
    composer/   Composer (markdown editor)
    sidebar/    labels / assignees / milestone / issue type / issue fields / sub-issues sidebar
    pull/       PR page shell, header, tabs, merge box, commits, checks, compare/new PR
    diff/       Files changed: split diff, file tree, highlighting worker
    review/     review threads, pending review, submit review
server/serve.mjs  static server with CSP and compression
```

## Data and caching

- All server data goes through TanStack Query. `queryClient` persists every query to IndexedDB per query, so pages render instantly from cache, then revalidate on mount and on window focus. Data under 10 seconds old counts as fresh, so a page opened right after a prefetch doesn't refetch it.
- Use the shared query keys in `api/keys.ts`. After a mutation, update the cache optimistically with `queryClient.setQueryData` where it's cheap, then `invalidateQueries` on the affected keys.
- Prefer GraphQL (`gql`) for reads: one request fetches what REST needs several for. Use `gqlAll` to follow connections to the end. Never show a "load more" button; fetch everything.
- REST (`rest`, `restAll`) is fine where GraphQL lacks something (PR files with patches, file contents, `/markdown`). `restAll` fetches pages in parallel.
- For expensive queries, use `probeThenLoad` from `api/queryClient.ts`: a 1-point probe (e.g. `updatedAt`) skips the full reload when nothing changed.
- `bodyHTML` / `body_html` is GitHub-rendered HTML. Render it only through `components/Markdown.tsx`, which sanitizes it with DOMPurify. Never use `dangerouslySetInnerHTML` elsewhere.
- Every request is counted in `window.__gitgudApiStats`; a header meter shows how much of each rate limit is used, turns yellow when one runs low and red when one runs out, and links to Settings for the numbers. A setting hides the meter until a limit runs low. Keep request counts low: no polling beyond conditional REST requests (see `useCheckPolling`), and no request per item in a list. To load several items, batch them as aliases in one GraphQL request (see `fetchIssuesBatch`).
- Each issue and PR is cached in several queries (list rows, its page's metadata). `api/subjects.ts` copies the newest version of each into the others as queries update, keeping their fetch times.
- At startup, `readRecent` in `api/queryClient.ts` loads the most recent list queries from IndexedDB before any page asks for them, so lists and seeded pages are ready on first render.
- Show what's cached while the rest loads. A kind list (Issues, Pull requests) borrows rows from the mixed list, and the mixed list merges both kind lists (`StandIn` in `features/repo/searchList.ts`). An issue or PR page shows its header from a cached list row (`SubjectSeed`) until its metadata arrives.
- Reserve space for content that loads late (skeletons, `Spinner show`, `Timeline commentCount`), so nothing below it moves. `lib/clickGuard.ts` drops a click on a control that slid under a still pointer within the last 600ms.
- `features/pull/checkPolling.ts` watches a PR's pending checks while its page is visible: it polls the head commit's check runs and statuses over REST every 15 seconds (every minute after 10 quiet minutes). Each request sends the last ETag, and GitHub doesn't count 304s against the rate limit. A changed ETag reloads only the rollup (1 GraphQL point); once nothing is pending, the whole PR reloads.
- `api/warmUp.ts` starts the REST and GraphQL rate limit windows: it reads `/rate_limit` (free) at load and at each reset, and sends one request to any limit with no window running. A setting turns it off.
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
- Tab bars: `.tabs` is the container; each tab needs `.tab` (and `.active`). Other children, like buttons, keep their own styles.
- Every `<Spinner>` needs a `label` saying what's loading; it shows on hover. Spinners fade in after a delay, so quick loads show nothing.
- Every page sets its browser tab title with `useTitle` from `lib/useTitle.ts`.
- Nothing may look clickable unless it is: link color, underline, pointer cursor, and hover effects only go on elements that act. `scripts/audit-affordances.mjs` checks this.

## GitHub API quirks

- Classic tokens without `read:project` fail any query that selects ProjectV2 timeline events. `features/conversation/timeline.ts` retries without them and remembers that for the session.
- Fine-grained tokens can't be granted the Checks permission, so check runs may be missing; the Checks tab says so.
- Fine-grained tokens don't see "mentioned this" events from repositories outside their grant, even public ones. When a timeline holds such hidden items, GitHub undercounts it and can end a page early with `hasNextPage: false`; `fetchItems` in `features/conversation/timeline.ts` keeps paging until an empty page when the counts disagree.
- References from other issues and commits don't change a subject's `updatedAt`, so cached timelines resume from their end cursor every 10 minutes anyway.
- Repo lists use `search(type: ISSUE_ADVANCED)`. With the same filters and sort, the issues in the All list are a prefix of the Issues list (same for PRs), so `kindSubset` in `features/repo/searchList.ts` shows them as placeholder data while a tab loads.
- Selecting check runs in the list query slows it by about 1.5s, so list rows get their check counts from `CHECKS_QUERY`, the same search run alongside each page with the same cursor. Rows whose check runs the token can't read show no count.
- Issue rows select `closedByPullRequestsReferences` in the list query itself; it adds about 8% to first rows, cheaper than a second search on issue-only pages.
- GraphQL connections page serially at about 1.8s per 100 nodes regardless of fields selected. Owner pages refresh by fetching the first page and merging with the cache.
- Issue fields (Priority, Effort, ...) show in the sidebar when pinned to the issue's type. Tokens without organization admin access see no pins (`pinnedFields` is empty, without an error), so `shownFields` in `features/sidebar/data.ts` then shows every field.
- The "had recent pushes" banners read `/repos/{owner}/{repo}/activity`, which is current. The Events API lags by minutes and leaves private repos out of user feeds.
- The first request from headless Chromium can fail CORS preflight behind some proxies; it's an environment problem, not an app bug.

## Shared contracts

- `features/composer/Composer.tsx`: `Composer` props are the contract (draftKey, owner, repo, onSubmit, actions, ...). Drafts persist in IndexedDB.
- `features/conversation/Timeline.tsx`: `Timeline({ owner, repo, number, kind: "issue" | "pull", subject })` renders the conversation (comments, events, and, for PRs, reviews with their threads) plus the bottom comment box.
- `features/sidebar/MetadataSidebar.tsx`: `MetadataSidebar({ subject: SubjectMeta, owner, repo, children? })` renders and edits assignees, labels, milestone, issue type, issue fields, and sub-issues. `children` is extra sections (e.g. reviewers for PRs). After edits it invalidates `keys.issue` or `keys.pull`.
- `features/review/threads.ts`: `useReviewThreads` / `fetchReviewThreads`: every review thread and comment for a PR (`keys.reviewThreads`).
- `features/review/ReviewThread.tsx`: `ReviewThreadView({ thread, owner, repo, number })` renders one thread with reply, resolve, edit, delete, reactions.
- `features/review/ReviewSubmit.tsx`: `ReviewSubmitButton({ owner, repo, number, pullId })`: the "Review changes" / "Finish your review" button and popover.
- `features/review/pending.ts`: the viewer's pending review on GitHub (`keys.pendingReview`).
- `features/diff/FilesChanged.tsx`: `FilesChanged({ owner, repo, number })` for a PR, `CommitFiles({ owner, repo, sha })` for a single commit, and `CompareFiles({ owner, repo, base, head })` for the new-PR page.
- `api/prefetch.ts`: speculative loads. Pages register what to load for an issue or PR (`registerPrefetcher`) or an in-app path (`registerPathPrefetcher`) at module load. `installLinkPrefetch` prefetches any link hovered or focused for 150ms, or pressed; other controls use `intentHandlers`. `speculate` skips repeats within a minute and runs loads in lanes: presses at once, hovers two at a time, background warming one at a time. It stops while any rate limit has under 20% left or the setting is off.
- `features/repo/warmRows.ts`: after a list loads, fetches the top rows' metadata in one batched request per kind.
- `features/pull/PullPage.tsx` owns `/:owner/:repo/pull/:number/*` and fetches PR metadata into `keys.pull`.
