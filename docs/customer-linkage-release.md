# Customer linkage consumer

Base repository: `jinguangwei56/PORT-web-portal`, branch `main`.
Reviewed base commit: `faa20ec38303d1288cd9a22634a9ee9eb1c51fe4`.
The tree contains no `AGENTS.md` or package/build configuration.

The customer-progress portion changes only two production files:

- `app-r11-1.html`: bump the module cache version and append the new module after
  the current customer-detail/session implementations.
- `assets/r11/customer-linkage.js.txt`: wrap the existing `openCustomer` entry
  point and append a live business summary inside the actual customer modal.

No other business module needs to change. Preserve the exact bytes of the split
`assets/formal/p*.txt` sources: several fragments split JavaScript string tokens
at EOF and cannot acquire newlines before concatenation.

## Backend and rollout

The module posts `p_crm_customer_id` to
`/rest/v1/rpc/fonkon_market_customer_summary` with the existing employee session
JWT and public client key. The server must enforce reviewed company linkage and
CRM ownership/capabilities; the browser is not an authorization boundary.

If the RPC is not deployed, the customer card shows that linkage is not enabled.
If the actor is unauthorized, it shows a generic refusal without server details.
If no reviewed records exist, it shows an empty state without guessing a company
association. No automatic mapping or production data write occurs.

The module bypasses the legacy GET cache. Its POST uses `cache: no-store`, does
not write local/session storage, and consumes only text/status/progress/date
fields. All dynamic content is rendered with `textContent`. It has no document,
bank account, financial amount or internal-note rendering path.

Changing customer, closing the modal, clearing a session, switching user,
cross-tab session changes and page hide remove the summary. Generation and actor
checks prevent a delayed response from appearing in another customer's modal or
after logout. Requests time out after 15 seconds and can be retried.

## Verification performed

Run from the repository root with Node 22 or later:

```sh
node --test tests/customer-linkage.test.mjs
node scripts/check-loader.mjs
```

All 11 tests passed, including wrong-customer payload rejection, customer switch
races, logout with a late response, user switch, cross-tab logout, plain-text XSS
handling, response field suppression, forbidden and unavailable states. The
loader check runs the actual loader assembly and compiles all 29 resulting
scripts, confirming that the new consumer is included. The subsequent staff
handoff module brings the assembled application to 30 scripts; see
`docs/staff-handoff.md` for that separate change and its tests.

Cloud browser verification of the local preview URL was blocked by the browser
URL policy (`ERR_BLOCKED_BY_CLIENT`). No workaround was attempted; browser
rendering and end-to-end hosted JWT/RPC behavior are not marked verified.

## Browser acceptance through the approved preview channel

1. On a controlled preview deployment, open `tests/customer-linkage-browser.html`.
   It uses synthetic local responses and never connects to the real customer
   database. Open customer A under normal, empty, denied and not-enabled modes.
   Confirm the sample HTML-like cargo label renders as literal text.
2. Select the delayed mode, open A, then open B or use the test logout button.
   The A response must never appear under B or after logout.
3. Open the real `app-r11-1.html` on the same controlled preview. Sign in through
   the normal employee flow and open an authorized customer. Check the existing
   detail card and the new progress section together.
4. With isolated test database accounts, validate authorized owner versus other
   salesperson and customer identities; verify denial in both UI and RPC.
   Do not invent or attach production company relationships for this check.
