# Loghmeh · لقمه

A calmer meal planner for University of Tehran dining. Pick your usual
restaurants as colors, preview foods inside a weekly calendar, and keep your
choices when the server rejects a request.

Independent, unofficial Firefox / Zen extension. **Version 0.4.0 · MIT.**

![The weekly planner with fictional menus and pending balance changes](docs/assets/planner-demo.jpg)

## Use in Zen / Firefox

1. Clone this repository.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**.
3. Select `extension/manifest.json` from your checkout.
4. Open **Loghmeh** from the browser toolbar. It connects using that browser's
   dining login. If signed out, use **Open dining login**, sign in normally,
   then **Reconnect dining**.
5. Add your usual restaurants from the nested picker. Hover a slot and click
   a food to select it; keyboard focus reveals the same choices.

**The extension planner uses real dining data. Submit and changing restaurants
submit the outgoing restaurant's pending changes.** The sample-menu link opens
an isolated simulation if you want to explore the interactions first.

After updating source, click **Reload** in `about:debugging`, then open a new
Loghmeh tab. Temporary installation ends when removed or the browser restarts.
The only host permission is `https://dining2.ut.ac.ir/*`.

## What it does

- Scroll Saturday-first weeks, with Jalali and Gregorian dates and today in
  Asia/Tehran. Menus arrive incrementally, with a status for each restaurant.
- Check current reservations while planning next week. Coverage refers to
  your selected places; Loghmeh does not claim to have scanned every place.
- See known paid food below zero and available balance above zero. Pending
  spending and refunds use opposite hatching. Pending amounts are estimates;
  confirmed balances come from dining. Amounts are displayed in toman.
- Submit by restaurant. A rejected or uncertain request keeps its draft.
  Read-back checks what was actually accepted, including partial success.
- Reuse your normal browser login. Loghmeh does not ask for passwords, export
  cookies, register a new SSO client, or run a backend server.

Live writes currently support ordinary single-portion foods and one wallet.
Extras, diet controls, multiple portions, and multiple-wallet spending need
further support; unsupported changes stay disabled. Use one dining interface
at a time because the university API shares a week cursor.

Live restaurant preferences stay local. Real menu snapshots, balances, account
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
A user-chosen real write is still pending.
No real reservation was changed during implementation testing.

There are 43 passing Node tests and 19 passing browser parser checks. The
write serializer and reconciliation logic are tested with fictional HTTP
responses; this does not establish live refunds or batch atomicity. See
[live API notes](docs/live-api.md) and the earlier
[probe verification record](docs/verification.md).

## Develop and preview

Node 22+ and Python 3 are sufficient. No dependencies or install step.

```sh
npm test
npm run check
npm run preview
```

Open <http://localhost:4173/extension/planner.html>. **Localhost always uses
fictional data and cannot reuse your dining login.** The extension's explicit
sample mode is `planner.html?demo=1` and keeps separate local sample state.

Useful local checks:

- `/tests/browser.html` — DOM parser checks.
- `/tests/browser-live-planner.html` — the live client/background/parser stack
  with fictional HTTP responses; no university requests. Add `?reject=1` to
  exercise business rejection.
- `/tests/browser-mobile.html` — 390px responsive preview.
- `/extension/probe.html` — the separate read-only connection probe.

`npm run package` builds `dist/loghmeh-0.4.0.zip`, also loadable as a temporary
add-on. Packages contain only `extension/`. Captures, outputs, private checks,
and local credentials are ignored and excluded.

The background script owns navigation, preflight, writes, and read-back in a
single queue. The UI owns confirmed state separately from draft intent and
in-flight revisions. Details: [live integration](docs/live-api.md) and
[prototype design](docs/planner-prototype.md).

## License

[MIT](LICENSE). This project is not affiliated with the University of Tehran.
