# Loghmeh · لقمه

A calmer meal planner for University of Tehran dining. Pick your usual
restaurants as colors, preview foods inside a weekly calendar, and keep your
choices when the server rejects a request.

Independent, unofficial extension for Firefox / Zen 142+ and Chrome / Chromium 116+.
**Version 0.6.0 · MIT.** Packages are attached to each
[GitHub release](https://github.com/khoda81/loghmeh/releases).

![The weekly planner with fictional menus and pending balance changes](docs/assets/planner-demo.jpg)

## Use in Zen / Firefox

1. Download the Firefox ZIP from a release and unzip it, or clone this repository
   and run `bun install --frozen-lockfile && bun run build`.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**.
3. Select the unzipped `manifest.json` (or `dist/build/manifest.json` from your checkout).
4. Open **Loghmeh** from the browser toolbar. It connects using that browser's
   dining login. If signed out, use **Open dining login**, sign in normally,
   then **Reconnect dining**.
5. Add your usual restaurants from the nested picker. The scrollable restaurant
   list shows full names, wrapping long ones. Food options stay visible;
   click one to select it. Hovering an existing reservation shows ×; clicking the
   card stages its removal; clicking it again keeps the reservation. Keyboard
   focus provides the same actions.

**The extension planner uses real dining data. Submit and changing restaurant
pills submit the outgoing restaurant's pending changes.** Clicking a reservation
stages its cancellation and activates that restaurant for Submit/Undo; other
drafts stay pending. A note beside Submit says when a pill switch would save.
The sample-menu link opens
an isolated simulation if you want to explore the interactions first.

After updating source, run `bun run build` again (or keep `bun run build --watch`
running), click **Reload** in `about:debugging`, then open a new Loghmeh tab. Temporary installation ends when removed or the browser restarts.

If Loghmeh was installed directly from source before the TypeScript migration,
use **Load Temporary Add-on…** again and select
`dist/build/manifest.json`. **Reload** keeps the original installation folder;
it does not switch to the build output. The source folder contains
`background.ts`, not the `background.js` Firefox loads. A “Loading failed for
the module …/background.js” error and an unresponsive toolbar button can mean
the old source folder is still installed.

The only host permission is `https://dining2.ut.ac.ir/*`.
The browser's data-use prompt covers the university session, dining content,
and reservation/wallet requests. [Privacy policy](PRIVACY.md).

## Use in Chrome / Chromium

1. Download the Chrome ZIP from a release and unzip it, or run `bun run package`
   and use `dist/chrome/`.
2. Open `chrome://extensions`, turn on **Developer mode**, and choose
   **Load unpacked** with that folder.
3. Open **Loghmeh** from the extensions menu. The rest works as in Firefox.

Chrome parses dining pages in a hidden offscreen document because its
background service worker has no HTML parser; this adds the `offscreen`
permission. The Chrome build is verified against fictional dining responses
only; a real signed-in session has not yet been checked in Chrome.

## What it does

- View one Saturday-first week, with previous/next controls, Jalali and
  Gregorian dates, and today's column highlighted in Asia/Tehran. The current
  meal gets a stronger border and a Now label (lunch before 16:00, dinner after;
  this is a clock cue, not a serving-window guarantee). Your last viewed week
  is remembered locally, separately for live and sample mode. Only that week is requested for
  selected restaurants; menus arrive incrementally beside their loading pills.
  Returning to a loaded week reuses its snapshot in the open tab. The calendar
  fills the viewport; each meal cell scrolls independently and keeps its height
  when restaurant content changes. Short screens scroll the page instead of
  shrinking the cells below one card.
- Use **This week** to see current reservations. Only selected places are checked;
  no other week is scanned in the background.
- See known paid value below zero and available balance above zero on the ruler. Pending
  spending and refunds use opposite hatching. Pending amounts are estimates;
  confirmed balances come from dining. Food segments follow date, meal, place,
  and food order, with pending cancellations hatched in place until confirmed.
  The bar includes known reservations from visited weeks. Amounts use toman.
- Submit by restaurant. A rejected or uncertain request keeps its draft.
  Read-back checks what was actually accepted, including partial success.
- Reuse your normal browser login. Loghmeh does not ask for passwords, export
  cookies, register a new SSO client, or run a backend server.

Live writes currently support ordinary single-portion foods and one wallet.
Extras, diet controls, multiple portions, and multiple-wallet spending need
further support; unsupported changes stay disabled. Use one dining interface
at a time because the university API shares a week cursor.

Live restaurant preferences and the viewed week stay local. Real menu snapshots, balances, account
identifiers, and drafts are not persisted. Keep the planner tab open to retain
pending choices; it warns before closing with a draft. The **Report** button
provides diagnostics without passwords, cookies, balances, food names, or
account identifiers.

## Verification status

The original session/menu probe was verified in the user's Zen setup. The new
live parser was checked against freshly loaded authenticated current/next-week
responses on 2026-10-22, including existing reservations and lock/quantity data.
**The 0.4.0 planner's live reads are verified in Zen:** 46 restaurants discovered,
current/next-week menus loaded, and four existing reservations recognized.
The user also verified one intended real change through Loghmeh, with
read-back confirming it. [Sanitized write report](docs/verification/zen-write-2026-10-22.json).
Version 0.4.1 adds automatic recovery of a lost background connection handle.
The real change was made by the user in Zen. No disposable reservation was
created by the implementation tests.

Version 0.5.0's single-week navigation, incremental loading, cached return,
active-week refresh, and chronological balance hatches were checked in the
browser against fictional HTTP responses. [UI verification notes](docs/verification/ui-0.5.0.md).
Version 0.6.0 removes the calendar instructions, coverage summary, slogan, and
footer notices. Reservation cards are direct removal buttons; food options stay
visible in the empty painting space. Fixed calendar rows fill the remaining
viewport and each cell scrolls independently. Slots with no foods stay blank.
The cross-restaurant cancellation flow was checked in the browser's HTTP fixture
and a dedicated controller test. [Calendar verification notes](docs/verification/ui-0.6.0.md).

There are 62 passing Bun tests and 20 passing browser parser checks. The
write serializer and reconciliation logic are tested with fictional HTTP
responses; one live change is verified. General refund behavior and batch
atomicity remain unverified. See
[live API notes](docs/live-api.md) and the earlier
[probe verification record](docs/verification.md).

## Develop and preview

The editable source lives in `src/`, with TypeScript and a Svelte 5 UI. Vite
builds the loadable extension into `dist/build/`; load its manifest in Firefox.
Bun 1.4.2 or newer runs the build, tests, type checks, preview server, and ZIP
packager. CI uses the version pinned in `packageManager`. Install the development
dependencies from the committed Bun lockfile:

```sh
bun install --frozen-lockfile
bun test
bun run check     # svelte-check, TypeScript, and manifest checks
bun run preview   # builds dist/preview/ and serves it on port 4173
bun run dev       # Vite dev server with hot reload, same URLs, no extension CSP
```

Node and Python installations are not required.

Open <http://localhost:4173/src/planner.html>. **Localhost always uses
fictional data and cannot reuse your dining login.** The extension's explicit
sample mode is `planner.html?demo=1` and keeps separate local sample state.

Useful local checks:

- `/tests/browser.html` — DOM parser checks.
- `/tests/browser-live-planner.html` — the live client/background/parser stack
  with fictional HTTP responses; no university requests. Add `?reject=1` to
  exercise business rejection.
- `/tests/browser-mobile.html` — 390px responsive preview.
- `/src/probe.html` — the separate read-only connection probe.

`bun run package` builds `dist/loghmeh-0.6.0-firefox.zip` and
`dist/loghmeh-0.6.0-chrome.zip`, plus unpacked `dist/firefox/` and `dist/chrome/`.
Packages contain the unminified build and the MIT license; Chrome gets a derived
manifest. `dist/loghmeh-0.6.0-source.zip` holds the sources that addons.mozilla.org
reviews alongside a bundled add-on. Releases are cut from version tags: see [releasing](docs/releasing.md). Captures, outputs, private checks,
and local credentials are ignored and excluded.

The background script owns navigation, preflight, writes, and read-back in a
single queue. The UI owns confirmed state separately from draft intent and
in-flight revisions. Details: [live integration](docs/live-api.md) and
[prototype design](docs/planner-prototype.md).

## License

[MIT](LICENSE). This project is not affiliated with the University of Tehran.
