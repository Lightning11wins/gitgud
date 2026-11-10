# GitGud Redirect

A Firefox extension that opens GitHub issue, pull request, and compare links in GitGud. Links clicked on github.com or in GitGud stay on GitHub, as do pages GitGud doesn't show, like code and Actions.

After installing, open the extension's preferences in `about:addons` and enter your GitGud URL. It's saved in the redirect rule, not in this code.

## Build and sign

Signing makes a private, unlisted `.xpi` that release Firefox installs permanently. Get an API key at https://addons.mozilla.org/developers/addon/api/key/ and bump `version` in `manifest.json` for each new upload.

```sh
pnpm dlx web-ext lint -s extension
pnpm dlx web-ext sign -s extension -a extension/dist --channel unlisted \
  --ignore-files README.md rules.d.ts \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

Install the signed file by opening it in Firefox. To try changes without signing, load `manifest.json` from `about:debugging#/runtime/this-firefox`.

The redirect rules are in `rules.js` and tested by `src/lib/extensionRules.test.ts`. When GitGud gains a route, add it to `GITHUB_PAGE`.
