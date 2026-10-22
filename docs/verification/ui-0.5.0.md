# UI refinement checks · 0.5.0

Checked on 2026-10-22. University writes were not used for this refinement;
the earlier user-run Zen check remains the evidence for the real backend.

- 50 Node tests passed, including active-week request scope, cancellation of
  obsolete queued reads during rapid navigation, safe completion of an already
  running read, cached return, and drafts surviving week navigation without
  submitting. Existing live submission/reconciliation tests also pass.
- 20 browser DOM parser checks passed.
- The browser's live-stack HTTP fixture initially recorded one connection and
  one menu read for the displayed week. Next-week navigation replaced the grid.
  Returning reused the snapshot, and adding a restaurant read only that place
  for the displayed week. Refresh recorded one connection and two menu reads,
  both for the active week and its two selected restaurants.
- One fictional purchase was submitted and read back. Its rectangle retained
  its position and width while its hatch cleared and the ruler moved. Removing
  it hatched its existing position; after confirmation its space closed and
  the following chronological reservation shifted into that space.
- The demo showed exactly one week, 14 meal slots, no restaurant-name labels
  inside cards, no Reserved text inside cards, and empty idle pill statuses.
  Full restaurant names remain in pill tooltips, including during loading.
- The desktop calendar and a 390px iframe were inspected visually. The narrow
  layout keeps week controls visible and scrolls the palette/calendar sideways.
  This checks responsive Chromium rendering, not physical touch or a new Zen run.

The README screenshot uses fictional demo menus and pending changes. Live
refund amounts remain estimates until dining confirms them. The balance strip
orders all known reservations from visited weeks by date, meal, restaurant,
and food. Pending segments stay in that chronological order rather than being
grouped at zero; hatching identifies their unconfirmed state.
