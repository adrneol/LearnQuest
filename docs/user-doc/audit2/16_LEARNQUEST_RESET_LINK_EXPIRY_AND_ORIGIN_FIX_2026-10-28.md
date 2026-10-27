# Report 16 — LearnQuest Reset-Link Expiry and Public-Origin Fix (2026-10-28)

## Scope and execution policy

This is the single final report for this run. Report 16 did not exist
beforehand, so it was created here. The existing archive index was updated in
place; no duplicate report, progress report, or second index was created.
Report 15 was read in full and left unchanged.

`#max` is a harness/session setting, not a repository setting. It was preserved
for follow-up invocations wherever the harness supports it. No source or
deployment setting was changed merely to alter model behavior.

No secret was printed. This report contains no database URI, password, API key,
session token, reset token, HMAC secret, email address, account identifier, or
raw provider response. No commit, push, reset, clean, stash, branch switch,
migration, account deletion, live database cleanup, or destructive operation
was performed. Nothing was deployed.

## Baseline and preserved work

The run began with the working tree described in Report 15, including its
uncommitted Account-page, recovery-notice, email-pipeline, and test changes.
Those changes were preserved. The only pre-existing untracked files were the
two prompt text files, Report 15, and `backend/tests/token-security.test.ts`.

`HEAD` remained `b279079 bad fix 6` on `main`. No existing source, test,
environment, credential, or report content was reverted.

## Direct answer: was the expired token accepted?

**No. The link only opened the reset form. There is no server request on page
opening, and no password-change path accepts an expired token.**

The hash route is handled entirely in the browser:

- `readEmailActionRoute()` parses `#/reset-password?token=...` and captures the
  opaque token from the fragment.
- `stripEmailActionToken()` immediately removes the token from browser history.
- Before this repair, `PasswordResetScreen` rendered the password form as soon
  as it had a token. It did not ask the server whether the token was still
  valid.

Only `POST /api/auth/password/reset` can consume a reset token. Its
authoritative database compare-and-set includes all of these conditions:

```text
tokenHash = HMAC(raw token)
purpose = password_reset
consumedAt = null
expiresAt > server UTC now
```

The update sets `consumedAt` in the same atomic operation. A GET cannot change
the token or the password. Therefore the reported behaviour is consistent with
the page merely showing a form; it is not evidence that the server accepted an
expired credential.

This was reproduced deterministically:

- issued a token with a 10-minute TTL;
- advanced the clock 37 minutes;
- submitted the token to the reset endpoint;
- received `400 INVALID_RESET_TOKEN`;
- confirmed the token record was still physically present with
  `consumedAt: null`;
- confirmed the password hash and password version were unchanged.

The user's exact pair of observations — **10-minute expiry** and
**`http://localhost:5173` link** — matches the local environment, not the
production blueprint:

| Local environment (sanitized) | Production blueprint |
|---|---|
| `NODE_ENV=development` | `NODE_ENV=production` (now explicit) |
| `APP_ORIGIN=http://localhost:5173` | `APP_ORIGIN=https://learn-quest-one.vercel.app` |
| `OTP_TTL_MIN=10` (legacy alias, current variable unset) | `EMAIL_ACTION_TTL_MIN=30` |

The only configuration in this workspace that yields both reported values is
the local environment; the production blueprint yields neither. The observed
email is therefore consistent with a local development send, not a Render
production send. Using a local development instance to send mail to a user
produces a link that is intentionally local-only; it must never be used for
production mail. The production path is now additionally fail-closed.

## Expiry defect and repair

### What was already correct

The token layer already had the essential security properties:

- 32 random bytes (`base64url`) from `crypto.randomBytes`;
- only an HMAC-SHA256 digest persisted;
- purpose, account, and email binding;
- server-side UTC expiry in the atomic consumption filter;
- atomic single-use compare-and-set;
- rejection of consumed, expired, wrong-purpose, wrong-account, and malformed
  tokens;
- password version increment and session revocation after a successful reset;
- invalidation of all outstanding email actions after reset.

No evidence was found that the server accepted an expired reset token. The
previous tests did not, however, prove the exact reported sequence or the
page-load behaviour.

### Defects fixed

1. **Expired links rendered a usable-looking form.** A token 37 minutes old
   still displayed “Choose a new password”; the user could only learn the
   truth after choosing a password and submitting. This is the actual
   expiry-related defect.
2. **No safe way to check a link without consuming it.** The frontend had no
   read-only server validation, and did not distinguish “expired/invalid”
   from “database unavailable”.
3. **Production startup did not force the email-action TTL to be read and
   validated.** An invalid TTL could survive startup and fail only on the
   first recovery request.
4. **Production origin validation was split between lazy getters and startup
   checks.** A production process without an explicit `APP_ORIGIN` could still
   resolve the development fallback in a code path that did not run the
   startup assertion.

### Exact semantics after the fix

- `inspectEmailActionToken()` is read-only. It looks up the digest and purpose,
  rejects consumed records, and uses server UTC time to report `valid`,
  `expired`, or `invalid`. It never writes.
- `POST /api/auth/password/reset/validate` returns `200 { valid: true }` only
  for an unexpired, unconsumed, purpose/account/email-bound reset token. It
  returns `EXPIRED_RESET_TOKEN` or `INVALID_RESET_TOKEN` without consuming the
  token. Database failure returns the normal sanitized `503`, not a false
  invalid/expired claim.
- The reset page now shows four separate states: checking, valid form,
  expired/invalid, and service-unavailable. It never shows the password form
  until the server has validated the link.
- `POST /api/auth/password/reset` remains the only consuming operation. The
  filter still contains `consumedAt: null` and `expiresAt > now`; the update is
  atomic. A defensive JavaScript expiry check also rejects a malformed or
  legacy expiry value even if a database filter matched it.
- A failed database write before consumption leaves the token unconsumed. A
  failure after the atomic consume may burn the token, but the response is
  `503` and no password change or success screen is reported. A retry then
  receives the normal invalid-token response.
- Successful reset still increments `passwordVersion`, hashes with Argon2id,
  revokes every session, invalidates all outstanding emailed actions, clears the
  cookie, and sends the security notice.

## One configured expiry source

`EMAIL_ACTION_TTL_MIN` (with documented legacy fallback `OTP_TTL_MIN`) is the
single source of truth for:

- the stored `expiresAt`;
- the email's “expires in N minutes” copy;
- the reset-page expiry statement;
- the confirmation screen;
- the forgot-password response message and resend cooldown policy.

`assertProductionConfig()` now reads the TTL and resend interval at startup, so
an invalid value fails closed immediately. The production blueprint pins
`EMAIL_ACTION_TTL_MIN=30`; the local environment intentionally resolves to 10
through the legacy alias. No token lifetime was extended to make the symptom
disappear. The local 10-minute policy was left unchanged.

Regression coverage proves that the stored expiry delta equals the configured
TTL, that the email copy states the same value, that the exact expiry boundary
fails, and that a token 37 minutes old fails while its record remains present.

## Public-origin defect and repair

### Root cause

`emailActionUrl()` already constructed links from `env.appOrigin`; it did not
use a hardcoded localhost URL or a request header. The observed localhost link
came from the local `APP_ORIGIN` configuration. The production blueprint
already contained the correct public origin.

The configuration layer was nevertheless too permissive for a
security-sensitive public URL:

- `APP_ORIGIN` fell back to `http://localhost:5173` whenever it was unset;
- production rejection of that fallback depended on the startup assertion;
- URL credentials, empty queries, and fragments were not uniformly rejected;
- the blueprint did not explicitly set `NODE_ENV=production`, so production
  fail-closed mode depended on a platform default.

### Configuration validation after the fix

`originEnv()` now:

- requires `APP_ORIGIN` and `API_ORIGIN` to be explicitly configured in
  production (no localhost fallback);
- requires HTTPS in production;
- rejects localhost, `localhost`-suffixed names, loopback IPv4 and IPv6
  (`127.0.0.1`, `::1`), the unspecified addresses (`0.0.0.0`, `::`),
  `.local`, `.internal`, the metadata hostname, private IPv4 ranges
  (`10/8`, `172.16/12`, `192.168/16`), link-local IPv4 (`169.254/16`),
  IPv6 unique-local (`fc00::/7`), and IPv6 link-local (`fe80::/10`) in
  production;
- rejects URL credentials;
- rejects any path, query, or fragment, including a bare `?` or `#`;
- rejects schemes other than HTTP/HTTPS;
- canonicalizes a trailing slash only after the value passes validation.

`emailActionUrl()` uses only `env.appOrigin`; request `Host`,
`X-Forwarded-Host`, `Origin`, and client-supplied origins are never consulted.
The link is built before the token record is inserted, so a misconfigured
origin cannot leave a usable token without a deliverable email. Both reset and
email-change links use the same configured origin and keep the token in the
fragment.

The email builder adds a second, independent production check. `buildActionEmail()`
passes every action URL through `assertActionUrl()` in
`backend/src/email/brevo.ts`, which:

- requires HTTPS in production;
- rejects any URL whose exact `URL.origin` differs from `env.appOrigin`, even
  when the substitute host is public and HTTPS;
- requires the token to remain in the fragment.

Thus a caller cannot bypass origin validation by constructing its own action
URL. The builder refuses to render or send the message instead.

`render.yaml` now sets `NODE_ENV=production` alongside the existing public
values:

```text
APP_ORIGIN=https://learn-quest-one.vercel.app
API_ORIGIN=https://learnquest-hhiv.onrender.com
CORS_ORIGIN=https://learn-quest-one.vercel.app
GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback
EMAIL_ACTION_TTL_MIN=30
```

Regression coverage includes local localhost development, the public
production origin, missing production origin, localhost/private/HTTP
production origins, IPv4 and IPv6 loopback/private/link-local addresses,
invalid URLs, unapproved schemes, credentials, paths, queries, fragments,
reset and email-change hash routes, malicious request headers, and rejection
of a foreign HTTPS origin by the email builder.

## Database-unavailable behaviour

The reset page now distinguishes:

- page opening (no server call);
- link validation (read-only POST);
- form submission (explicit POST and atomic consume);
- password change committed (only after `204`);
- session revocation (part of the successful server transition).

If the database is unavailable:

- validation returns the sanitized retryable `503` and the page shows
  “We could not check this reset link … Nothing was changed,” with a retry
  action;
- submission returns `503 DATABASE_UNAVAILABLE`;
- the frontend shows that the password was **not** changed and keeps the form
  only for a possible retry;
- no success screen is shown and no queued password update is created;
- if the token has expired by the time service returns, the user is shown the
  expired state and a request-new-link action.

A regression test simulates a database failure at the atomic consumption step
and proves `503`, unchanged password hash, unchanged password version, and an
unconsumed token.

## Verification results

All commands were run from the stated directory under the supported Node
`24.22.1` runtime. Counts below are from this run.

### Targeted regressions

| Check | Command | Result |
|---|---|---|
| Backend expiry/origin/deployment/recovery tests | `vitest run tests/reset-token-expiry.test.ts tests/origin-config.test.ts tests/deployment-config.test.ts tests/multiuser.test.ts` | **4 files, 75 tests passed** |
| Frontend reset-link and cross-tab tests | `vitest run tests/auth-repair.test.tsx tests/auth-sync.test.tsx` | **2 files, 26 tests passed** |

### Full suites

| Check | Result |
|---|---|
| Full backend | **22 files, 181 tests passed** (18.28 s) |
| Full frontend | **41 files, 337 tests passed** (54.33 s) |

One intermediate frontend full run exposed a race in the existing cross-tab
notice ref: a passive effect had not flushed when a storage sign-out arrived in
two integration tests. The ref is now updated with a layout effect and the two
tests pass; no assertion was weakened.

### Typecheck, lint, build

| Check | Result |
|---|---|
| Backend typecheck (`tsc --noEmit`) | Passed |
| Frontend typecheck (`tsc --noEmit`) | Passed |
| Backend lint | **0 errors, 84 existing `no-explicit-any` warnings** |
| Frontend lint | **0 errors, 4 existing hook-dependency warnings** |
| Backend production build (`tsc`) | Passed |
| Frontend production build (Vite 6.4.4) | Passed (2253 modules) |

The changed files introduced no new lint errors. No security assertion or test
was skipped or weakened.

### New regression files

- `backend/tests/reset-token-expiry.test.ts` — fake-clock expiry boundary,
  37-minute rejection with the record present, replay, three-way concurrent
  consumption, purpose mismatch, read-only inspection, legacy TTL alias, and
  one-source email copy.
- `backend/tests/origin-config.test.ts` — local/production origins, missing
  origin, localhost/private/HTTP rejection (including IPv4 and IPv6
  loopback/private/link-local forms), malformed origins, startup TTL
  validation, exact-origin email-builder rejection, and blueprint checks.
- Additions to `backend/tests/multiuser.test.ts` — route-level expiry with the
  record present, non-consuming validation, database-unavailable truthfulness,
  hostile `Host`/`X-Forwarded-Host` isolation, and password-version/hash
  assertions.
- Additions to `frontend/tests/auth-repair.test.tsx` — expired-link state,
  unavailable-service state, and no form/submit before validation.

## MongoDB verification

The existing read-only diagnostic was run twice from `backend/` under Node
`24.22.1`:

```text
npm run diagnose:mongo -- --probe-tls
```

Both attempts returned:

```json
{
  "classification": "TLS_FAILURE",
  "connected": false,
  "ping": false,
  "retryable": true,
  "tlsAlert": "internal_error"
}
```

The database name still matches `learnquest`; the failure is at the TLS
handshake. No credential, URI, network, TLS-verification, or storage-mode
setting was changed. No live write, migration, cleanup, or account operation
was attempted. The TLS environment differs from Report 15, which recorded a
successful connection earlier on the same day; this run therefore does not
claim live MongoDB verification.

All expiry, atomic-consumption, concurrency, and database-failure tests use the
in-memory adapter and the same repository logic as production. This proves the
application semantics, not a live Atlas transaction during this run.

## Live deployment check

Safe read-only checks on 2026-10-28:

| URL | Result |
|---|---|
| `https://learnquest-hhiv.onrender.com/api/health` | `200`, version `0.2.0` |
| `https://learnquest-hhiv.onrender.com/api/ready` | `404` |
| `https://learnquest-hhiv.onrender.com/api/auth/config` | `404` |
| `https://learn-quest-one.vercel.app/api/health` | `404` |
| `https://learn-quest-one.vercel.app/api/auth/config` | `404` |
| `https://learn-quest-one.vercel.app/` | `200` (static frontend) |

The live Render service is still the old pre-auth build. It cannot expose the
new validation endpoint, the current expiry configuration, or the public
origin status. The Vercel deployment still does not serve the repository's
`/api` proxy routes. **No local fix has been claimed as deployed.** No reset
email was sent and no unknown user was contacted.

The current public origin is a configuration value, not a secret:
**`APP_ORIGIN=https://learn-quest-one.vercel.app`**. The live Render dashboard
value cannot be read from this repository; the blueprint value is correct.

## Local versus live

| Area | Local working tree | Live deployment |
|---|---|---|
| Expiry enforcement | Filtered atomic consume plus read-only validation; tested | Old backend has no auth routes |
| Expiry UI | Checking/valid/expired/invalid/unavailable states | Old frontend has no reset route |
| Email TTL | Local `OTP_TTL_MIN=10` alias; production blueprint 30 | Not verifiable; old build |
| Public origin | Validated `env.appOrigin`; no header trust | Render config not inspectable; blueprint correct |
| MongoDB | TLS handshake failure this run | Readiness/config endpoints not deployed |
| Email delivery | Not attempted in this run | Report 15's Brevo IP restriction still owner-side |

## Remaining owner actions

1. **Deploy the current backend and frontend.** The live Render service reports
   `0.2.0`; `/api/ready` and `/api/auth/config` are absent, and the Vercel `/api`
   proxy returns `404`. Verify after deploy that `/api/health` stays `200`,
   `/api/ready` becomes `200` only with a real database ping, and
   `/api/auth/config` returns the matching public origin and TTL.
2. **Confirm Render dashboard values.** Ensure the existing service (not only
   the blueprint) has `NODE_ENV=production`,
   `APP_ORIGIN=https://learn-quest-one.vercel.app`,
   `API_ORIGIN=https://learnquest-hhiv.onrender.com`,
   `CORS_ORIGIN=https://learn-quest-one.vercel.app`,
   `GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback`,
   and the intended `EMAIL_ACTION_TTL_MIN` (blueprint: `30`). Do not paste
   secrets into the repository or logs.
3. **Do not send production mail from a local development instance.** The
   reported localhost/10-minute email matches the local environment. Local
   development may keep `http://localhost:5173`; production must use the
   public origin.
4. **Investigate the current MongoDB TLS failure externally.** The read-only
   diagnostic shows a TLS alert before authentication. Do not disable TLS
   verification or change credentials to work around it. Live expiry testing
   remains pending until the connection succeeds.
5. **Address the Brevo source-IP authorization from Report 15.** No provider
   request was repeated in this run. After the IP/allowlist issue is corrected,
   use one controlled owner message and verify the public-origin link and the
   configured expiry before announcing recovery as working.
6. **Verify the reset flow after deployment:** open an expired link and confirm
   the expired state without a password form; request a new link; confirm it
   starts with the public origin; submit once; confirm the success screen and
   that old sessions are rejected.

## Final Git status

No commit, push, reset, clean, stash, branch switch, deployment, or destructive
database operation was performed. `backend/dist/` and `frontend/dist/` are
build outputs ignored by Git. Existing uncommitted Report 15 work remains
intact.

```text
## main...origin/main [ahead 7]
 M backend/src/auth/actionTokens.ts
 M backend/src/config/env.ts
 M backend/src/email/brevo.ts
 M backend/src/routes/auth.ts
 M backend/tests/deployment-config.test.ts
 M backend/tests/email-delivery.test.ts
 M backend/tests/multiuser.test.ts
 M docs/user-doc/audit2/README.md
 M frontend/src/app/App.tsx
 M frontend/src/app/store.tsx
 M frontend/src/features/account/Account.tsx
 M frontend/src/features/auth/AuthScreens.tsx
 M frontend/src/services/api/authApi.ts
 M frontend/src/services/api/http.ts
 M frontend/tests/account-route.test.tsx
 M frontend/tests/auth-repair.test.tsx
 M frontend/tests/auth-sync.test.tsx
 M render.yaml
?? LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_AUDIT_PROMPT_2026-10-28.txt
?? LEARNQUEST_RESET_LINK_EXPIRY_AND_ORIGIN_FIX_PROMPT_2026-10-28.txt
?? backend/tests/origin-config.test.ts
?? backend/tests/reset-token-expiry.test.ts
?? backend/tests/token-security.test.ts
?? docs/user-doc/audit2/15_LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_REPAIR_2026-10-28.md
?? docs/user-doc/audit2/16_LEARNQUEST_RESET_LINK_EXPIRY_AND_ORIGIN_FIX_2026-10-28.md
```

## Final assessment

- **Expired token acceptance:** not reproduced and not present in the server
  path. Opening the link only rendered the form; no GET consumes a token. The
  server rejects a 37-minute-old token while its record remains in the store.
- **Expiry defect fixed:** the reset page now validates read-only before
  showing the form, distinguishes expired/invalid/unavailable states, and
  reports database failure truthfully without a success screen.
- **Single expiry source:** stored expiry, email copy, UI copy, and confirmation
  text all derive from `EMAIL_ACTION_TTL_MIN`, with the legacy alias preserved.
  Production startup validates the value.
- **Origin defect fixed:** production requires an explicit public HTTPS
  `APP_ORIGIN`, rejects localhost/private/loopback/link-local/malformed values,
  never trusts request headers, uses the configured origin for reset and
  email-change links, and independently refuses to build an email whose action
  URL does not exactly match that origin.
- **Tests and quality:** targeted and full suites, typechecks, lint, and
  production builds pass; no assertions were weakened.
- **Live limits:** MongoDB currently fails TLS; Render/Vercel are stale; no
  deployment or live email was performed. Those blockers are owner-side.
