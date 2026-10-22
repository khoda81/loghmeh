# Next UI pass

The live adapter is connected and one real change is verified in Zen. These
requested refinements were held while testing the actual API:

- Remove a conflicting food directly without first changing the active brush.
- Order reservation bars by date, with a stable meal/place/food tie-breaker.
- Hatch a pending removal at its existing position. On confirmation collapse
  that space in place; pending removals do not need to sit beside zero.
- Clicking a reservation bar selects its restaurant. An already-selected bar
  exposes an accessible remove control.

The backend handles each restaurant/week separately. Replacing across places
may require a confirmed cancellation before a new booking, and the replacement
can still fail. The UI must expose that partial result and retain remaining
intent. Unsupported extras, diet controls, and multiple portions should retain
their server lock/reason in both the calendar and bar controls.

The live API supplies current food prices and actual balance. Pending purchase
and recovery values remain estimates until confirmation. Missing food entries
do not establish whether a week is unpublished; empty live menus say only that
no food was returned. The one-change live test does not establish general refund
rules or multi-change atomicity.
