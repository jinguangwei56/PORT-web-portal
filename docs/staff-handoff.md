# Staff administration handoff

`assets/r11/staff-handoff.js.txt` loads after the existing account and customer
modules. Account invitations, approval, rejection, activation and administrator
password reset buttons direct the user to the fixed OPS staff page. These
buttons do not send a legacy management request, claim success or transfer any
token, user identifier, password or return URL.

OPS and MARKET have separate browser sessions. Completing OPS MFA does not
upgrade the MARKET token or automatically continue a pending MARKET action.
The administrator completes the operation directly in OPS.

The existing team view and customer handover functions remain in place. Only
account-management controls receive a handoff entry. The old invitation-code
panel explains that its registration entry is retired; it does not claim that
any code has been revoked. New employees use the company invitation email to
set up their account. The old anonymous registration form no longer contains
name, email, invitation-code or password inputs, and submits no request.

Ordinary password changes continue through the existing password handler. Its
front-end hint, native input constraints and pre-request validation match the
server policy: 10–72 characters with upper/lowercase letters and digits. Server
errors, including a password update whose profile synchronization remains
pending, are preserved rather than changed into success messages.

Password recovery also uses OPS. The verified `/zh/forgot-password` route sends
the user through the OPS email callback and password-setting flow. The loader
disables the old closed-over recovery timer and its mail countdown with exact,
single-match patches. The handoff module replaces the old button's stored
`onclick`, removes inputs and submission logic from any already-created
`recoverForm`, and blocks late legacy recovery submissions in capture phase.
It sends no recovery email and performs no direct Auth password write.

Only the old recovery-specific storage keys are removed. An identified old
recovery URL is cleared locally; no fragment, token or query is added to the
fixed OPS destination. Ordinary MARKET login sessions and business state remain
untouched. The normal logged-in password handler is retained.

Verification:

```sh
node --test tests/customer-linkage.test.mjs tests/staff-handoff.test.mjs
node scripts/check-loader.mjs
```

All 22 module tests and the actual loader assembly/30-script compile passed.
Tests cover blocked legacy requests, no false success, fixed token-free links,
registration input removal, preserved password errors and untouched customer
handover. Recovery tests use the actual old form function and stored button
handler, verify late-submit interception, session-preserving cleanup and loader
failure on missing or duplicate patch markers. Hosted browser acceptance
remains a deployment gate; the local cloud
browser preview URL is blocked by browser policy and was not bypassed.
