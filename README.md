# gitgud

A fast client for GitHub issues and pull requests. It runs entirely in the browser: each person pastes their own GitHub token, and the token, cache, and drafts stay in that browser. The server only serves static files.

- Pages render instantly from a local cache (IndexedDB), then refresh in the background.
- Every comment, thread, and file loads automatically. There's no "Load more".
- Long timelines and big diffs stay smooth; syntax highlighting runs in a Web Worker.
- Unsent comments survive reloads and crashes.
- URLs mirror github.com: swap `github.com` for your gitgud host in any issue or PR link, or paste a GitHub URL into the jump box (`/`).

## Run it

Requires Node 20+.

```sh
npm install
npm run build
npm run serve -- --host 0.0.0.0 --port 8080
```

`npm run dev` starts a dev server with hot reload.

## Serve over HTTPS

Browsers only enable persistent storage and some clipboard features on secure origins, and plain HTTP would let anyone on the network inject script and steal tokens. `localhost` counts as secure; anything else needs HTTPS.

**Tailscale:** run the server on localhost, then expose it on your tailnet with an automatic certificate:

```sh
npm run serve -- --port 8080
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

**Caddy** (work VPN or LAN, with a real domain or Caddy's internal CA):

```
gitgud.example.internal {
  tls internal
  reverse_proxy 127.0.0.1:8080
}
```

`server/serve.mjs` sets a strict Content-Security-Policy and other security headers, so a reverse proxy only needs to pass responses through.

## Tokens

A classic token with `repo` and `read:org` scopes covers everything. A fine-grained token works with read/write access to Contents, Issues, and Pull requests, plus read access to Metadata, Actions, and Commit statuses; check runs may be missing, since fine-grained tokens can't be granted the Checks permission. `gh auth token` prints the GitHub CLI's token.

Signing out erases the token, cache, and drafts from the browser.

## Limits

- GitHub's API has no attachment upload, so pasting an image into a comment offers a link to attach it on github.com instead.
- CI logs open on github.com.
- Files changed shows split view only.

## Development

- `docs/ARCHITECTURE.md`: layout, data and caching rules, shared contracts.
- `REQUIREMENTS.md`: product spec.
- `npm run typecheck`, `npm test`.
- `scripts/shot.mjs <path> out.png`: screenshots a page in headless Chromium, signed in with your `gh` token, and prints console errors and API request counts. Set `PLAYWRIGHT_BROWSERS_PATH` if Playwright's default browser cache isn't writable.
- `scripts/*-flows.mjs`: end-to-end flows against a private sandbox repo (`scripts/seed-sandbox.sh` seeds one).
