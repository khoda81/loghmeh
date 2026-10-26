# Loghmeh privacy

Effective date: 2026-10-23.

Loghmeh is an independent, open-source meal planner for the University of
Tehran dining service. It has no developer-operated backend, advertising,
analytics, tracking, or automatic error reporting.

## University dining requests

Live mode communicates directly with `https://dining2.ut.ac.ir` over HTTPS to
read eligible restaurants, menus, existing reservations, and wallet balances,
and to submit the reservation changes you make. These requests use your
existing browser login: the browser attaches the university's session cookies.
Reservation submissions include the selected foods, restaurant, group, and
university wallet identifier. The university receives and processes these
requests under its own policies.

Loghmeh does not ask for your university password or copy cookies into its own
storage. Sign-in happens on the university's website. A student identifier
read from dining is hashed locally to detect account changes; it is not sent
to the developer or an analytics service.

Live mode starts reading when you open the planner. Clicking Submit or changing
restaurant can send pending reservation changes to the university. These
changes can spend or refund your university dining balance. Closing the
planner stops its reads; uninstalling removes Loghmeh's local preferences.

## Local data

The selected restaurant palette and last viewed calendar week stay in the
extension's local browser storage. Live and sample mode remember their weeks
separately. Live menus, balances, account information, and unsubmitted choices
are kept in memory, not saved to local storage. Unsubmitted choices are lost
when the planner tab is closed.

The separate sample mode uses fictional data and may save its fictional
choices locally. It does not make university requests.

## Diagnostics and sharing

The Report view is generated locally. It includes the extension version,
operation names, request timings, result states, and counts. It excludes
passwords, cookies, account and wallet identifiers, balances, and food names.
It is not uploaded automatically. If you choose to share a report or create
a GitHub issue, the destination service receives what you submit; review it
before posting publicly.

Loghmeh sends no dining data to its developer and does not sell or share it
with advertisers or data brokers. Browser stores, the university's login
service, and GitHub have their own privacy policies when you use those services.

## Contact and changes

Source and support: <https://github.com/khoda81/loghmeh>.
For privacy questions, open an issue without posting personal account data.
Changes to this policy are recorded in that repository.
