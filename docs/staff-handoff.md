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

Verification:

```sh
node --test tests/customer-linkage.test.mjs tests/staff-handoff.test.mjs
node scripts/check-loader.mjs
```

All 17 module tests and the actual loader assembly/30-script compile passed.
Tests cover blocked legacy requests, no false success, fixed token-free links,
registration input removal, preserved password errors and untouched customer
handover. Hosted browser acceptance remains a deployment gate; the local cloud
browser preview URL is blocked by browser policy and was not bypassed.
