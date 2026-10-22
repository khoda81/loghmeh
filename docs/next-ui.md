# Next UI pass

The live adapter is connected and one real change is verified in Zen. These
refinements are now in 0.5.0:

- One active week with previous/next controls. Only that week is fetched for
  selected restaurants, with queued reads canceled when leaving it.
- No idle Ready/Saved pill labels or repeated restaurant/Reserved labels in
  calendar cards. Full restaurant names remain in tooltips and accessible names.
- Reservation bars follow date, meal, restaurant, and food order, independently
  of the active brush or save order. Pending removals hatch in place and their
  space collapses on confirmation.

Version 0.6.0 removes the calendar slogan, brush instructions, coverage summary,
and footer notices. Existing reservation cards show a hover/focus × and the
entire card stages removal; there is no separate remove button. Food previews
stay visible in the empty painting space and cannot cover a reservation. The
calendar fills the viewport with equal, fixed meal rows; each cell scrolls its
own contents. Empty menus leave blank cells rather than no-food labels. Removing a card
from another restaurant activates its Submit/Undo context without implicitly
saving the outgoing draft. Locked reservations retain their lock reason.

Still open from the earlier interaction ideas:

- Clicking a reservation bar selects its restaurant. An already-selected bar
  exposes an accessible remove control.

The backend handles each restaurant/week separately. Replacing across places
may require a confirmed cancellation before a new booking, and the replacement
can still fail. The UI must expose that partial result and retain remaining
intent. Unsupported extras, diet controls, and multiple portions should retain
their server lock/reason in both the calendar and bar controls.

The live API supplies current food prices and actual balance. Pending purchase
and recovery values remain estimates until confirmation. Missing food entries
do not establish whether a week is unpublished; empty live menus leave the cells
blank without inferring a publication state. The one-change live test does not establish general refund
rules or multi-change atomicity.
