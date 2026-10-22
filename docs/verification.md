# Connection probe verification

Date: 2026-10-22, Asia/Tehran. Current version: 0.1.1.

## Completed

- Seven Node transport tests passed: request allowlist, credentialed reads,
  expired-session redirects, server failures without retries, serialization
  and recovery after failures, timeout cancellation, and safe error reporting.
- Fourteen DOM parser checks passed in the in-app browser. They cover recognition
  of authenticated/login/error pages, restaurant data, duplicate food copies,
  wrapped and explicitly associated labels, missing and ambiguous labels,
  disagreement between copies, empty and incomplete weeks, and inert scripts.
- Browser interaction with the fixture preview passed: connection discovery,
  reading one menu, displaying two deduplicated choices from four checkbox
  nodes, and preserving reserved/disabled states.
- The expired-session preview displayed an error and kept menu reads disabled.
- The preview's report correctly left `sessionVerified` and `menuVerified`
  false. Fictional data must not count as an authenticated test.
- JavaScript syntax and the Firefox manifest checks passed. The manifest
  requests one dining host, with no raw-cookie API or storage permission.
- The temporary-install ZIP was built. No dependencies were downloaded.

## Verified in Zen

The user installed the extension and supplied the sanitized
[connection report](verification/zen-session-2026-10-22.json) on 2026-10-22.
They confirmed that logged-out detection worked and that the probe worked
after signing in.

- An unauthenticated bootstrap was recognized as `login-required` in 100 ms.
- An authenticated bootstrap returned HTTP 200 in 421 ms and discovered eight
  groups. The report records `sessionVerified: true`.
- Three restaurant reads returned HTTP 200 in 44, 30, and 26 ms, with 3, 23,
  and 3 restaurants respectively.

This verifies reuse of the user's dining session in their tested Zen setup.
Container-specific behavior has not been tested separately.

## Menu-label regression fixed in 0.1.1

The user's [subsequent Zen report](verification/zen-menu-label-failure-2026-10-22.json)
contains two successful HTTP 200 menu responses (3065 ms and 754 ms), both
rejected by the 0.1.0 parser with `A food entry is missing its label.`

The parser assumed that a label was the checkbox's next element sibling.
Previously captured dining responses show a `reserveFoodFoodDiv` containing
the checkbox and another div containing the food label. The label's `for`
also omits the checkbox's UUID suffix, so standard label association alone
does not resolve it.

Version 0.1.1 supports that structure, proper explicit label association, and
direct sibling labels. Scoped lookup rejects missing or ambiguous labels
without borrowing a label from a different food. The fictional fixture now
preserves the server's wrapper, mismatched `for`, and nested count label.
It reproduced the original failure before the fix and passes afterward.

The corrected parser was also run locally against two previously captured
dining responses in the in-app browser, without executing their scripts or
making university requests. Both parsed successfully: each had seven dates,
44 checkbox nodes, and 22 unique foods. One contained four reserved foods,
which remained recognized. These are earlier captures, not the user's latest
Zen responses.

## Authenticated menu milestone verified in Zen

After the wrapped-label fix, the user repeated the read in Zen and pasted
the extension's rendered result on 2026-10-22:

```text
Authenticated menu read passed. 44 checkbox nodes → 22 unique options.
22 food options
0 already reserved
22 locked by dining
1405/07/25 → 1405/08/01
```

The pasted table contained 22 rows with dates, meals, food names, prices, and
reservation/locked states. This is user-supplied output from the real extension,
not a fixture preview or an agent-observed Zen session. An additional exported
Connection report was not supplied for this successful read.

The first read-only milestone is complete: existing-session authentication,
logged-out detection, group and restaurant discovery, and one authenticated
menu read are verified in the user's Zen setup. Container-specific behavior,
week navigation, aggregation across restaurants, and reservation writes remain
outside this milestone. The next step is the user's reservation UI design.

The test does not submit or cancel reservations, navigate weeks, send ratings,
or process payments. The only network targets allowed by the request builder
are the three reads listed in the README. No broad SSO host permission is used;
the login action opens the official dining entry point in a normal tab.
