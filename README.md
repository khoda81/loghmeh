# Loghmeh · لقمه

A Firefox / Zen dining client, beginning with a small authenticated read test.
This is a connection probe, not the reservation UI yet.

## Try the probe in Zen

1. Open `about:debugging#/runtime/this-firefox` in **Zen**.
2. Choose **Load Temporary Add-on…**, then select
   `/home/mahdi/Projects/loghmeh/extension/manifest.json`.
3. Open **Loghmeh** from the browser's extensions menu / toolbar.
4. If shown, click **Allow dining access**. The only host permission is
   `https://dining2.ut.ac.ir/*`.
5. Click **Check connection**. If signed out, use **Open dining login**, finish
   the normal SSO login, return to Loghmeh, and check again.
6. Select a group and restaurant, then click **Read menu**.

Success means the extension shows **Session reused** and
**Authenticated menu read passed**. The **Connection report** contains a
sanitized result that can be copied into this chat.

The extension uses **Zen's own session**, not the session from the browser in
this chat. The first test targets the normal browser cookie store. If your
dining login is in a Firefox container, report whether the probe can reuse it;
container-aware transport is not verified yet.

Temporary installation lasts until removal or a browser restart. Firefox's
permission wording grants site access broadly, but this prototype's request
allowlist contains only:

| Operation | Method and path |
| --- | --- |
| Discover groups | `GET /Reserves` |
| Discover restaurants | `POST /Reserves/GetRestaurantByPersonGroup` |
| Read a menu | `POST /Reserves/GetReservePage` |

After a source update, click **Reload** for Loghmeh in `about:debugging`, then
close and reopen its tab to load the updated parser. The Connection report
shows the running version; the wrapped-label fix is included in **0.1.1**.

There is no reservation submission, cancellation, rating, payment, next-week,
or previous-week request in this version. Reading a menu uses the dining
session's current week. Its API contains a stateful week cursor; the probe
does not advance it. It sends no credentials or account data to any other
service. It doesn't read raw cookies, ask for passwords, persist account
data, or run analytics. Requests happen only after your actions.

If a menu read fails, the last successful menu remains visible. Login and
generic error pages are failures, not empty menus. Mobile and desktop copies
of the same food are deduplicated. The connection report excludes food names,
account balances, account identifiers, cookie values, and server HTML.

## Development

No dependencies or installation step are needed. Node 22+ and Python 3 are
sufficient.

```sh
npm test
npm run check
npm run preview
```

Preview: `http://127.0.0.1:4173/extension/probe.html`.
Browser parser checks: `http://127.0.0.1:4173/tests/browser.html`.
Expired-session preview: add `?scenario=expired` to the probe URL.

**The localhost preview uses fictional fixtures and never calls dining.**
It cannot verify Zen authentication. This distinction also appears in the
on-screen notice and exported report.

```sh
npm run package
```

This writes `dist/loghmeh-auth-probe-0.1.1.zip`, also loadable as a temporary
add-on. The Firefox manifest uses an event background script; a future Chrome
package can share the UI and transport with a different background manifest.

## Scope and next gate

The first milestone is **verified in Zen** as of 2026-10-22: the user confirmed
logged-out detection and existing-session reuse, then successfully read a real
menu with 44 checkbox nodes deduplicated into 22 foods. See
[verification status](docs/verification.md) for the evidence and test coverage.
The next milestone is the actual reservation UX, based on the user's design.
No live reservation changes should be added to this probe.

The preceding investigation documented the dining HTML endpoints, hidden
limits, duplicate markup, custom write serialization, and stateful week cursor.
The write contract remains unverified with an actual reservation change.

References: [Firefox host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions),
[background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
[temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).
