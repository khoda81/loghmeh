# Releasing

`bun run package` builds both browsers from `extension/`:

| Output | Use |
| --- | --- |
| `dist/loghmeh-<version>-firefox.zip`, `dist/firefox/` | addons.mozilla.org upload; `web-ext sign` source |
| `dist/loghmeh-<version>-chrome.zip`, `dist/chrome/` | Chrome Web Store upload; **Load unpacked** |

`extension/manifest.json` is the Firefox manifest. The Chrome manifest is derived
in `scripts/package.mjs`: a module service worker, the `offscreen` permission for
the page reader, and PNG icons from `extension/icons/` (rendered from `icon.svg`;
re-render them if the SVG changes).

## Cutting a release

1. Bump `version` in `extension/manifest.json` and `package.json` (CI checks they match).
2. Commit, then tag and push: `git tag v0.7.0 && git push origin v0.7.0`.
3. `.github/workflows/release.yml` tests, packages, and creates the GitHub release
   with both ZIPs attached. Store jobs run only when enabled (below).

## Store uploads from CI

Do the first submission to each store by hand: it creates the listing, the
privacy answers, and (for Chrome) the extension ID. Afterwards, enable the jobs
with repository variables and secrets (Settings → Secrets and variables → Actions).
Each job runs in a GitHub environment of the same name, so a required reviewer
can be added there to gate store submissions.

| Store | Variables | Secrets |
| --- | --- | --- |
| Firefox Add-ons (`firefox-add-ons`) | `PUBLISH_FIREFOX=true` | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` from addons.mozilla.org → Developer Hub → Manage API Keys |
| Chrome Web Store (`chrome-web-store`) | `PUBLISH_CHROME=true`, `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID` | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` ([key guide](https://github.com/fregante/chrome-webstore-upload-keys)) |

Both jobs submit for review; neither waits for approval. A store rejects a
version number it has already received, so a failed review needs a version bump.

The Firefox add-on ID (`browser_specific_settings.gecko.id`) becomes permanent
with the first AMO submission. Do not change it afterwards.
