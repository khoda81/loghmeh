# Releasing

`bun run package` builds `extension/` with Vite into `dist/build/` and packages both browsers:

| Output | Use |
| --- | --- |
| `dist/loghmeh-<version>-firefox.zip`, `dist/firefox/` | addons.mozilla.org upload; `web-ext sign` source |
| `dist/loghmeh-<version>-chrome.zip`, `dist/chrome/` | Chrome Web Store upload; **Load unpacked** |
| `dist/loghmeh-<version>-source.zip` | addons.mozilla.org source upload (the build is bundled); `web-ext sign --upload-source-code` |

`extension/manifest.json` is the Firefox manifest. The Chrome manifest is derived
in `scripts/package.ts`: a module service worker, the `offscreen` permission for
the page reader, and PNG icons from `extension/icons/` (rendered from `icon.svg`;
re-render them if the SVG changes).

## Cutting a release

1. Bump `version` in `extension/manifest.json` and `package.json` (CI checks they match).
2. Commit with jj and push the `main` bookmark, then tag and push the release:

   ```sh
   jj tag set v0.7.0 -r main
   jj git push --tag v0.7.0 --dry-run
   jj git push --tag v0.7.0
   ```
3. `.github/workflows/release.yml` tests, packages, and creates the GitHub release
   with the Firefox, Chrome, and source ZIPs attached. Mozilla's validator must
   also pass without warnings on the built Firefox package.
   Store jobs run only when enabled (below).

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
version number it has already received. A successful CI submission means that
the version was sent for review, not that it is already approved or public.

For the first release, submit through the store dashboard, push the version tag
with the store variables still disabled, then configure credentials and enable
the store for future tags. This avoids uploading the same version twice.

Mozilla's metadata and private reviewer instructions live in
`store/amo-metadata.json`. They describe the fictional sample mode and the
university-account requirement; never put university login credentials there.
The public privacy policy is [PRIVACY.md](../PRIVACY.md).

To retry just one store after correcting a credential or another transient
failure, dispatch the workflow at the **existing version tag**, for example:

```sh
gh workflow run release.yml --repo khoda81/loghmeh --ref v0.7.0 -f store=firefox
```

Use `store=chrome` for Chrome or `store=both` for both. The workflow checks the
tag against the manifest again and reuses an existing GitHub release. Do not
retry a store that has already accepted that version. Until Chrome developer
registration is complete, leave `PUBLISH_CHROME` unset or `false`; Chrome ZIPs
are still attached to GitHub releases.

Keep API credentials only in GitHub Actions secrets, preferably scoped to the
matching environment. Do not add them to source, release notes, or workflow
inputs. Both publishing CLIs run with Bun (`bunx --bun`).

The Firefox add-on ID (`browser_specific_settings.gecko.id`) becomes permanent
with the first AMO submission. Do not change it afterwards.

## First submission record — 2026-10-23

- [GitHub release v0.6.0](https://github.com/khoda81/loghmeh/releases/tag/v0.6.0)
  was built by the release workflow, with Firefox and Chrome ZIPs attached.
- Firefox version 0.6.0 was submitted to Mozilla and entered review. The
  [listing](https://addons.mozilla.org/firefox/addon/loghmeh/) becomes available
  after approval. Add-on ID: `loghmeh@khoda81.github.io`; AMO numeric ID:
  `3105314`; submitted version ID: `6611919`.
- The owner added `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` as encrypted repository
  secrets. `PUBLISH_FIREFOX=true` enables future version-tag submissions. The
  `firefox-add-ons` environment accepts `v*` tags only.
- Store publishing was deliberately skipped for the already submitted first
  tag. Packaging and GitHub publication passed in CI; the next new version
  exercises the authenticated AMO upload job.
- Chrome Web Store registration was deferred. `PUBLISH_CHROME=false`; its
  GitHub ZIP and disabled workflow remain ready for later setup.
