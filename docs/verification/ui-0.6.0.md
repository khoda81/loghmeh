# Calendar checks · 0.6.0

Checked on 2026-10-23 with fictional menus and the live-stack HTTP fixture.
No university reservation was changed during these checks.

- Removed the brush instructions, slogan, coverage summary, and footer notices.
  Reservation cards contain no nested remove button. Their whole button stages
  cancellation, with an accessible name and a hover/focus-only × hint.
- Clicking another restaurant's reservation activates its Submit/Undo context
  while retaining the outgoing draft. The fixture verified a cancellation by
  read-back; the controller test confirms there is no implicit save on removal.
- At a 1280 × 720 viewport, the document height stayed 720px and the grid ended
  at 704px. All 14 cells measured 165.9px high. A cell with 232px of content
  scrolled by 66.4px while the document and other cells remained at scroll zero.
- Switching restaurant pills preserved every cell's measured height. Food
  options remain visible without hover; cells with no offers contain no text.
- The 390px responsive fixture fits the calendar within its viewport, with
  horizontal week scrolling and independent vertical scrolling inside cells.
- All 51 Node tests and 20 browser parser checks pass. This verifies the new
  layout in Chromium; the earlier user-run Zen report remains the evidence for
  the real session and reservation API.
