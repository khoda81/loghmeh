# Live dining integration

Version 0.4.1. Loghmeh uses Firefox's existing dining session. It does not
implement SSO, request a password, export cookies, or run a proxy server.

## Endpoints

All requests target `https://dining2.ut.ac.ir` with browser credentials,
manual redirects, no response cache, and a fixed operation allowlist.

| Operation | Method | Path |
| --- | --- | --- |
| Bootstrap | GET | `/Reserves` |
| Restaurant discovery | POST | `/Reserves/GetRestaurantByPersonGroup` |
| Selected session week | POST | `/Reserves/GetReservePage` |
| Current week | POST | `/Reserves/GetCurrentReservePage` |
| Next week | POST | `/Reserves/GetNextReservePage` |
| Previous week | POST | `/Reserves/GetPreReservePage` |
| Apply changes | POST | `/Reserves/Index` |

Restaurant lists are JSON; the other responses are HTML. Returned scripts
are parsed as inert data and never inserted or evaluated. The connection
probe still has access to only its original three read operations.

## Cursor and snapshots

There is one server week cursor, rather than a date-addressed menu API. The
background session serializes discovery, menu reads, cursor navigation, saves,
and read-back across all Loghmeh tabs. It derives dates from the returned
seven-day Persian header, verifies consecutive Saturday-first days, and checks
every navigation step. Only selected restaurants are loaded. UI requests for
visible weeks take precedence over the current-week background scan.

A menu read starts by asking for the session's selected week. If already at
the target it does not advance again. Large cursor distances reset to current
week before bounded navigation; a request never walks more than eight weeks.
The calendar can scroll further, but those loads return a range error.

The original website and other clients do not participate in this queue.
Use one reservation interface at a time. Encoded records retain their exact
server date/time fields, and the adapter verifies the target week and actual
reservation states before reporting success.

## Submission and reconciliation

The page's own serializer establishes this record structure:

```text
<opaque server checkbox prefix><t|f>fco<new count>pco<previous count>options|<extras>|diet:<0|1>
```

The adapter keeps the entire server prefix, including template time fields.
It sends changed records as repeated `DataId[]` form keys, plus `type=Index`,
`personGroupId`, `restId`, and `firstEWalletId`. That array-key spelling follows
jQuery's default form encoding and was accepted in the user's verified one-change live save.

Before transmission the adapter rechecks the signed-in account and wallet,
reloads the target week, and verifies each food's price, quantity, and lock.
It reads back after the POST even when the response is lost. An HTTP 200 or
a returned script is never treated as proof that a reservation was accepted.
Matching actual reservation states and an actual returned balance establish
the result. Partial acceptance confirms only the matching changes; the rest
stays in the draft. A retry preflights again, so already-applied changes are
reconciled without repeating their purchase.

If read-back also fails, the outcome is unknown and the draft stays intact.
No transmitted write or cursor-advance operation is automatically retried.
Version 0.4.1 can automatically recover a missing background context and resume
a request only when the context lookup failed before any HTTP operation. It
rechecks the account identity and eligibility first; concurrent recoveries
coalesce. Unknown write outcomes do not trigger this recovery. The user can
refresh/retry, which begins with another state read.

Ordinary one-portion foods with one wallet are supported. Foods with extras,
diet controls, multiple portions, or missing quantity metadata are displayed
with changes disabled. Multiple-wallet spending is read-only. This avoids
silently changing options the planner does not yet represent.

The live catalogue has no invented entitlement groups. The backend remains
authoritative for limits. Known reservations cover checked restaurants only,
not an exhaustive global account ledger. Pending balance effects are estimates;
the confirmed balance always comes from dining. Full refunds and exact serving
hours are not assumed. The exact current-meal highlight remains demo-only.

## Authentication and local state

Account identity is hashed in memory to detect a different sign-in before a
write; raw identifiers are neither returned to the UI nor saved. Local storage
holds the live restaurant palette only. Real menus, balances, account fields,
and reservation drafts are not persisted. Drafts survive failed requests and
reconnection in the open tab; closing a tab with pending changes warns first.
An account/catalogue change leaves old drafts in that tab and requires a new
tab for the new context.

The Report button exports only operation names, timing, result codes, week
dates, and counts. It excludes credentials, cookies, balances, food names,
account identifiers, wallet identifiers, and raw server HTML.

## Verification

- 46 Node tests cover transport boundaries, the shared queue, exact opaque
  serialization, cursor validation, business rejection, lost-response
  reconciliation, partial success, changed accounts/prices/quantities, and
  the existing planner and signed ledger behavior.
- 19 browser parser checks pass against fictional fixtures.
- On 2026-10-22 the renewed authenticated dining page was used to load current
  and next-week menus. The new parser recognized the account, one wallet, a
  readable balance, and both real weeks: 22 unique foods each, four existing
  reservations next week, and 18 editable next-week options.
- The full planner/client/background/session/parser stack has a local HTTP
  contract fixture, separate from the real account and demo adapter.

The user verified the new 0.4.0 planner in Zen and supplied a sanitized
[report](verification/zen-planner-2026-10-22.json): login expiration was recognized,
reconnection discovered 46 restaurants in 1946ms, current-week reading took
3201ms, and next-week reading took 7892ms with four reserved foods and four
locked foods. An unpublished following week correctly contained no foods.
The report records session/menu verification, with write verification false.
The user subsequently made one intended real change in Zen. The
[write report](verification/zen-write-2026-10-22.json) records an attempted save
with one applied change verified after read-back in 21,560ms. It also records
a lost background context before the first attempt, followed by reconnection.
This verifies one real write and its state reconciliation. Other write variants,
general refund behavior, and server batch atomicity remain unverified. No
disposable real reservation was created by the agent. Raw captures and private
parser checks remain ignored locally and are excluded from the public repository
and extension package.
