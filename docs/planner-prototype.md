# Weekly restaurant-painting prototype

This records the 0.3.0 prototype, 2026-10-22, which uses fictional data.
Version 0.4.0 adds the separate [live API adapter](live-api.md); the localhost
preview and explicit sample mode still use this simulation.

The interaction details below describe that earlier prototype. Version 0.5.0
replaces infinite scrolling with one active week and previous/next controls,
removes the background Today scan, and orders balance segments chronologically.
Pending cancellations stay in place until confirmation closes their space.
Pills no longer show idle status text, and calendar cards use restaurant color
with full names retained in tooltips and accessible labels. Current behavior is
summarized in the [README](../README.md) and [live integration](live-api.md).

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

Hovering a slot reveals ghost foods for the active restaurant. Clicking a food
paints it directly; choosing another replaces that restaurant's food in the slot.
There is no separate food picker or change-food button. Keyboard focus reveals
the same choices and survives asynchronous renders. Touch devices show the
choices inline. Confirmed reservations and drafts can stack across restaurants. The sample policy uses
one student meal and one supplementary entitlement per slot; this is fictional
and must be replaced with parsed account policies before any real write.
The current meal highlight also uses sample time windows, not verified dining
service hours.

Balance is stored in integer rials and displayed in explicitly labeled toman.
Known paid reservations occupy the negative side; zero to the available balance
is empty. Already-paid bookings are not charged again. Opposite hatch directions
identify pending purchases and refunds. Swaps expose both gross amounts, using
two lanes when they overlap, rather than hiding an equal-price change in a net
zero. Failed saves retain their hatching.

Food rectangles use fixed funding coordinates, with an extent of available
balance plus known paid reservations. Normal purchases/refunds preserve that
extent. A cached layout keeps surviving rectangles at exactly the same position,
width, and lane on confirmation, while zero and the round ruler move. New intent
may repack the rectangles; discovering previously unknown reservations may
expand the known extent. Additions follow save order and removals reverse it,
including weekly batches, so partial confirmations keep paid food below zero.
Overspending keeps the scale and marks the right edge red. Round 1/2/5-series
ticks maintain at least 72px between labels. The sample service models full-price
refunds; actual refund behavior remains unverified.

## State and request ownership

- `planner-model.mjs`: independent confirmed menus/bookings, draft intent,
  captured in-flight revisions, derived totals, and sample rule checks.
- `planner-controller.mjs`: one request queue, foreground writes before reads,
  active restaurant reads before other restaurants, and per-restaurant status.
- `planner-demo.mjs`: deterministic sample menus, artificial latency, a local
  balance and booking ledger, and optional one-shot failures. No network API.
- `signed-balance.mjs`: fixed food geometry, pending spending/recovery lanes,
  and the signed ruler. Model intent and commit revisions distinguish edits
  from confirmations, including newer edits to captured writes.
- `planner.mjs`: DOM rendering, inline ghost choices, infinite-scroll observation,
  local demo persistence, and the nested restaurant picker.

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

All 29 Node tests pass (11 planner, 11 signed-ledger, and seven transport).
The existing browser parser suite has 14 checks. Node checks cover date boundaries,
signed tick spacing, unchanged booking costs,
refresh preservation, submission on restaurant switch, rejection and retry,
edits during writes, request serialization, cancellation of offscreen queued
reads, entitlement and budget conflicts, wrong-week responses, current-week
background scanning, partial success across weeks, and local state recovery.
The existing transport tests and browser parser suite remain applicable to
the separate read-only probe.

The in-app browser was used in 0.2.0 to verify painting a two-choice meal, stacking
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


The 0.3.0 browser check verified hover-revealed two-food choices and direct
replacement without a menu, keyboard focus and Enter selection, direct removal,
and separate purchase/refund hatches. A simulated 36,000-toman purchase moved zero
88.8125px with zero movement or width change across all ten food rectangles.
A 35,000-to-25,000-toman replacement moved zero -24.67499px; all surviving
rectangles retained their horizontal and vertical geometry. These pixel values
apply to the tested viewport. The screenshot in `outputs/inline-ledger-0.3.0.jpg`
captures the inline choices and both pending hatch lanes.
A forced refund rejection retained its pending amount and hatch; Undo cleared
both. The 390px iframe check confirmed the signed ruler and restaurant palette
still fit, with horizontal scrolling confined to the palette and weekly grid.
This checks narrow layout, not a physical touch device or the target Zen browser.

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
