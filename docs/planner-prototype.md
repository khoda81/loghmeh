# Weekly restaurant-painting prototype

Version 0.2.0, 2026-10-22. This surface uses fictional data throughout.
The existing read-only probe is still the only university networking client.

## Interaction

The sticky toolbar contains a balance bar, restaurant color pills, a nested
restaurant picker, week shortcuts, and today's known meals. Weeks scroll
vertically in both directions; meals within each week are arranged in a
Saturday-first, seven-day grid. Smaller screens can scroll the week sideways.

Restaurant selection is also the request boundary. Changing a pill captures
and queues the outgoing restaurant's draft, then activates the new brush
immediately. Explicit submission handles the active restaurant. A pill's own
state reports queued/loading reads, pending changes, queued/saving writes,
confirmed success, or an error with retry. Reads arrive incrementally.

Single-food slots paint immediately. Two-food slots open a chooser. Confirmed
reservations and drafts can stack across restaurants. The sample policy uses
one student meal and one supplementary entitlement per slot; this is fictional
and must be replaced with parsed account policies before any real write.
The current meal highlight also uses sample time windows, not verified dining
service hours.

Balance is stored in integer rials and displayed in explicitly labeled toman.
Already-paid bookings are not subtracted again. Pending spending is segmented
by restaurant. The bar's scale stays fixed while editing and rebases only when
the simulated server confirms a new balance. Round 1/2/5-series ticks maintain
at least 72px between labels. The sample service models full-price refunds;
actual refund behavior remains unverified.

## State and request ownership

- `planner-model.mjs`: independent confirmed menus/bookings, draft intent,
  captured in-flight revisions, derived totals, and sample rule checks.
- `planner-controller.mjs`: one request queue, foreground writes before reads,
  active restaurant reads before other restaurants, and per-restaurant status.
- `planner-demo.mjs`: deterministic sample menus, artificial latency, a local
  balance and booking ledger, and optional one-shot failures. No network API.
- `planner.mjs`: DOM rendering, infinite-scroll observation, local demo state
  persistence, the picker, and the food chooser.

Only selected places and relevant weeks are requested. Leaving a week cancels
queued reads for it; running reads complete. The current week remains queued
in the background so the Today strip checks all chosen places. Returning to a
loaded week reuses its snapshot. No scan of unselected restaurants is implied.

Writes capture exact draft revisions and operate per restaurant and week.
Edits made while a response is pending survive it. If one weekly batch succeeds
and another fails, the earlier batch stays confirmed and the rest remains a
draft. Failed writes are not retried in the background; retry or a subsequent
restaurant switch is an explicit trigger. Undo is disabled during a save.
Demo preferences, snapshots, drafts, and the sample server ledger persist in
origin-local storage under a dated, versioned demo key.

## Verification

All 18 Node tests pass (11 planner tests and seven existing transport tests),
and all 14 existing browser parser checks pass. Node checks cover date boundaries, tick spacing, unchanged booking costs,
refresh preservation, submission on restaurant switch, rejection and retry,
edits during writes, request serialization, cancellation of offscreen queued
reads, entitlement and budget conflicts, wrong-week responses, current-week
background scanning, partial success across weeks, and local state recovery.
The existing transport tests and browser parser suite remain applicable to
the separate read-only probe.

The in-app browser was used to verify painting a two-choice meal, stacking
restaurants with separate sample entitlements, automatic submission on a pill
change, a forced rejection preserving the draft and balance, explicit retry,
adding a fourth restaurant through nested group search, per-restaurant loading,
over-budget feedback and disabled submission, undo, successful balance rebasing,
and persistence across reload. Forward scrolling appended multiple future weeks;
Home/PageUp prepended multiple earlier weeks with the anchor retained. A 390px
iframe viewport verified the narrow layout and horizontal week scrolling.
Native pointer opening/closing of simulation controls preserved calendar scroll.
The local app preview also runs with `style-src 'self'` and `connect-src 'none'`;
restaurant colors and the budget segments work under those restrictions.

## Before connecting real reservations

The backend uses a session week cursor. The live adapter must navigate it
serially, verify returned dates, and coordinate with other dining tabs. The
stateless date addressing of this demo is not evidence that the backend offers
the same API. Submission encoding, business-result detection, cross-restaurant
replacement, refund rules, and ambiguous timeout reconciliation still need
verification against an explicitly chosen real change. No real write was made
while building this prototype.

Calendar scrolling is open-ended; published sample menus stop after next week.
Later weeks remain visible with a distinct unpublished state. This prototype
does not virtualize previously rendered calendar weeks or scan all restaurants
for hidden reservations. Live network integration and the target Zen UI test
are separate follow-ups to the browser-verified simulation.
