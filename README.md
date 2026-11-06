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
npm run serve
```

Then open http://localhost:8080. `npm run dev` starts a dev server with hot reload.

## Share it on a network

Bind to all interfaces and anyone who can reach the machine can use it, including over Tailscale or a work VPN:

```sh
npm run serve -- --host 0.0.0.0 --port 8080
```

Each address is its own browser origin, so `http://10.0.0.5:8080` and `http://gitgud.lan:8080` keep separate tokens and caches. Pick one address and share that.

### Plain HTTP or HTTPS

Plain HTTP works, with two costs:

- **Security:** tokens never reach the server, but the app's code does travel over the network. Anyone who can tamper with traffic between a browser and the server could inject script that reads the token. A VPN only encrypts the leg to its gateway. Use plain HTTP only on a network you trust.
- **Features:** browsers can evict the cache under disk pressure (it can't be marked persistent), and copy buttons may not work.

`localhost` counts as secure without HTTPS.

### HTTPS

With a certificate for the server's hostname, for example from your work's internal CA or [mkcert](https://github.com/FiloSottile/mkcert):

```sh
npm run serve -- --host 0.0.0.0 --port 8443 --cert cert.pem --key key.pem
```

On Tailscale, `tailscale serve` provides a certificate automatically:

```sh
npm run serve -- --port 8080
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

A reverse proxy like Caddy or nginx also works. The server sets a strict Content-Security-Policy and other security headers, so the proxy only needs to pass responses through.

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
