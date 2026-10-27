# LearnQuest Auth, Email-Link, and Production Topology Repair

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `58c1b15` (ahead of `origin/main` by 2)  
**Working tree:** Intentionally uncommitted. No commit, push, reset, clean,
stash, or branch switch was performed.  
**Scope:** Failed/nonexistent-account sign-in, the MongoDB configuration crash,
Google login/registration separation, removal of numeric OTP flows, single-use
email action links through Brevo, failed-login session-expiry handling, and the
Vercel ↔ Render production proxy/session topology.

---

## 1. Executive summary

The reported failures were reproduced in tests and fixed at their source. The
implementation is complete for the local, testable scope. Live Google, Brevo,
MongoDB Atlas, Vercel, and Render behavior remains owner-side verification
because no credentials or dashboard access were available in this environment.

| Area | Result | Evidence |
|---|---|---|
| Nonexistent-account / wrong-password login | **Fixed** | Backend returns a generic `401 INVALID_CREDENTIALS`; frontend stays on the sign-in screen and displays the server message. Regression test added. |
| `Cannot read properties of undefined (reading 'mongodb')` | **Fixed** | The login response is no longer assigned to the configuration state. Session/config responses are validated at the network boundary before use. |
| Google registration intent | **Fixed** | Sign-in and registration are separate intents; login never auto-creates an account. |
| Numeric OTP behavior | **Removed** | OTP module deleted; OTP routes return 404; UI, API client, email templates, and current docs contain no numeric-code flow. |
| Password reset and email verification | **Replaced** | Opaque, purpose-bound, HMAC-digested, expiring, atomically single-use links delivered by Brevo. |
| Failed login replaced by “session expired” | **Fixed** | The HTTP transport no longer emits the global expiry event for expected 401s from sign-in/recovery endpoints or when no session context exists. |
| Production callback/proxy topology | **Configured** | `frontend/vercel.json` proxies `/api/*` to `https://learnquest-hhiv.onrender.com`; production callback is `https://learn-quest-one.vercel.app/api/auth/google/callback`; `TRUST_PROXY_HOPS=2`. |
| Node pin | **Configured, not runtime-verified** | Repository pins `24.22.1`; local validation ran on Node `24.11.0`. |

Final local gates:

| Gate | Result |
|---|---|
| Backend tests | **72 / 72 passed** (9 files) |
| Frontend tests | **283 / 283 passed** (35 files) |
| Backend typecheck | **Passed** |
| Frontend typecheck | **Passed** |
| Backend lint | **0 errors / 76 warnings** |
| Frontend lint | **0 errors / 4 warnings** |
| Backend production build | **Passed** |
| Frontend production build | **Passed** |
| `npm audit` (backend) | **0 vulnerabilities** |
| `npm audit` (frontend) | **0 vulnerabilities** |
| Isolated health smoke | **HTTP 200**, `ok:true`, `version:0.3.0`, setup-required true with integrations disabled |

No test was skipped or weakened. The full frontend run prints jsdom's `window.scrollTo` “Not implemented”
message; it does not fail a test.

---

## 2. Reported symptoms and root causes

### 2.1 Nonexistent account looked like a broken deployment

The backend already rejected unknown identifiers with a generic
`401 Invalid username/email or password.` The frontend, however, assigned the
`/api/auth/login` response to the same state slot used for `/api/auth/config`.
The login response has no `configured` object. When rendering subsequently read
`setup?.configured.mongodb`, the `setup` object existed but `configured` did
not, producing the exact error:

```text
Cannot read properties of undefined (reading 'mongodb')
```

The fix was twofold:

1. The login response is retained only as an authentication result; it no
   longer overwrites configuration state.
2. Configuration and session responses are structurally validated. A partial
   or incompatible response raises an actionable “incompatible configuration”
   error instead of being used as if it were complete.

### 2.2 Google login silently registered unknown identities

The callback treated every verified Google identity as a registration. A person
who followed **Sign in with Google** with an unknown Google account therefore
received a new pending account instead of being told that no LearnQuest account
existed.

The callback now carries an explicit `login` or `register` intent through the
OAuth state:

- **login** + unknown Google subject → `#/auth?error=google_account_not_found`;
  nothing is created.
- **register** + unknown subject → pending account and onboarding.
- **register** + existing completed account → `google_account_exists`; the
  person is asked to use sign-in instead.
- **login** + an account that has not completed onboarding → resumes the
  onboarding session rather than pretending the account is complete.

### 2.3 Every 401 looked like an expired session

The shared HTTP layer dispatched `lq:auth-expired` for every HTTP 401. A normal
wrong-password response therefore cleared the sign-in state and replaced the
form with the global account error, hiding the server's message.

The transport now emits the expiry event only when all of the following hold:

- the response is a 401;
- a session/CSRF context exists in this tab;
- the request is not one of the session-less auth endpoints
  (`/auth/login`, `/auth/forgot`, `/auth/password/reset`,
  `/account/email/confirm`).

A failed login now remains on the sign-in screen with
`Invalid username/email or password.` A genuine 401 from an authenticated
endpoint still expires the session normally.

### 2.4 Numeric OTP was both weaker and at odds with the desired UX

Numeric codes required attempt counters, resend cooldowns, and code-specific
storage, while still being guessable relative to an opaque token. The entire
numeric flow was removed rather than relabeled. Current email actions use
128-bit random tokens with an HMAC digest as the only stored representation.

---

## 3. Implemented design

### 3.1 Email action token lifecycle

New module: `backend/src/auth/actionTokens.ts`.

- **Opaque token:** 32 random bytes (`randomToken(32)`) encoded for a URL.
- **Stored representation:** HMAC-SHA-256 digest only; the raw token exists in
  the email link and the consuming request, never in MongoDB.
- **Purpose binding:** `password_reset` and `email_change` are separate
  purposes and cannot be substituted.
- **Account binding:** records store the account email at issue time. A reset
  token stops working if the account email has changed; an email-change token
  is bound to both the old and new normalized addresses.
- **Expiry:** default 30 minutes (`EMAIL_ACTION_TTL_MIN`), TTL-indexed.
- **Atomic single use:** consumption is a MongoDB compare-and-set
  (`findOneAndUpdate` with `consumedAt: null` and `expiresAt > now`). Concurrent
  requests cannot both succeed.
- **Prior-link invalidation:** issuing a new link marks every outstanding link
  for that account and purpose as consumed.
- **Abuse controls:** per-IP 15-minute request limit (`8` by default), a
  60-second resend cooldown, and a generic recovery response for unknown
  accounts.
- **Non-destructive rollout:** legacy `lq_challenges` and `lq_reset_grants`
  documents are left untouched; new links use only `lq_action_tokens`.

### 3.2 Password reset

1. `POST /api/auth/forgot` accepts a username or email.
2. The response is identical whether or not an account exists.
3. A known active account receives a professional HTML + plain-text Brevo
   email containing a fragment URL:
   `https://<app>/#/reset-password?token=...`.
4. Merely opening the link does not consume the token or change the password.
5. The browser captures the token from the fragment, replaces the address bar
   with `#/reset-password`, and keeps the token only in memory.
6. Pressing **Set new password** sends an explicit
   `POST /api/auth/password/reset`.
7. Success updates the Argon2id hash, revokes **all** sessions, sends a security
   notice, and returns `204`.

### 3.3 Email change

1. An authenticated, recently reauthenticated
   `POST /api/account/email/change` validates the new address and issues a
   `email_change` token to the **new** address.
2. The old address remains active until confirmation.
3. `POST /api/account/email/confirm` is public and token-only, mounted before
   the account auth middleware. It atomically consumes the token, verifies the
   account binding, updates the address, revokes all sessions, and notifies the
   previous address.
4. The link is a fragment URL (`#/verify-email?token=...`) and is exchanged
   only by the explicit button POST, so mail scanners that issue GETs cannot
   change an account.

### 3.4 Brevo email templates

`backend/src/email/brevo.ts` now sends `sendActionEmail` with:

- a responsive, accessible HTML template and a complete plain-text fallback;
- the action link and expiry, with no code entry;
- purpose-specific copy for password reset versus email verification;
- security guidance for unexpected messages;
- a separate plain-text security notice for password reset and email change;
- no secrets or internal identifiers in the message.

The sender name/address come only from configuration. No sender value or API
key was invented or printed.

### 3.5 Frontend behavior

- Strict response validators for configuration, session, and password login.
- Login intent and registration intent buttons are visually and semantically
  distinct; Google remains the only registration path.
- Recovery screen sends email links instead of requesting codes.
- Reset and verification screens capture the fragment token, strip it from
  history immediately, and require an explicit POST.
- The store routes `#/reset-password` and `#/verify-email` before normal
  authenticated routing, so a public action link does not require a session.
- Failed login stays on the form; success enters the app; invalid/partial
  auth responses are errors, never authenticated state.
- The previous configuration dereference was removed and setup access is
  optional-chained and validated.

### 3.6 Production topology and cookies

- `frontend/vercel.json` rewrites `/api/:path*` to
  `https://learnquest-hhiv.onrender.com/api/:path*`. The Vercel project root is
  `frontend/`, so this is the file Vercel reads.
- `VITE_API_BASE_URL` stays empty in production; the browser uses the Vercel
  origin and first-party `/api` requests.
- `APP_ORIGIN` and `CORS_ORIGIN` are
  `https://learn-quest-one.vercel.app`.
- `GOOGLE_REDIRECT_URI` is
  `https://learn-quest-one.vercel.app/api/auth/google/callback`.
- Production cookie: `__Host-lq_session` with `Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`, and no `Domain`.
- `TRUST_PROXY_HOPS=2` represents only the browser → Vercel edge → Render edge
  → Express chain. It is not an instruction to trust arbitrary forwarding
  headers beyond that count.
- Render Blueprint pins Node `24.22.1`, while local validation used Node
  `24.11.0`. The remote runtime is not proven by local commands.

---

## 4. Security properties verified by tests

- Google login cannot create an account; registration cannot silently sign in
  a completed account.
- Google state is single-use, PKCE-bound, and nonce/issuer/audience/expiry
  checked; the onboarding session is bound to the verified Google subject.
- Wrong password and unknown identifier produce the same generic 401.
- Password reset links are single-use, expiring, purpose-bound, invalidated by
  a newer request, and rejected after reuse.
- Reset and email-change tokens are stored only as HMAC digests.
- Email-change confirmation is public but token-only and revokes all sessions.
- Old email receives a security notice after a change.
- CSRF is required for authenticated mutations; origin checks reject untrusted
  browser origins.
- Production cookies use the `__Host-` contract; CORS never accepts a wildcard.
- Legacy `/api/auth/otp/verify` and `/api/auth/verify-otp` return 404.
- Account-scoped collections and cascade deletion remain isolated between
  users.

The backend suite covers these properties with in-memory fakes. It does not
prove MongoDB's server behavior or Brevo's delivery.

---

## 5. Changed and added files

Primary implementation files:

- Added `backend/src/auth/actionTokens.ts`
- Deleted `backend/src/auth/otp.ts`
- Updated `backend/src/auth/accounts.ts`, `crypto.ts`, `google.ts`,
  `sessions.ts`
- Updated `backend/src/config/env.ts`, `db/mongo.ts`, `email/brevo.ts`,
  `middleware/errors.ts`, `routes/account.ts`, `routes/auth.ts`,
  `services/userData.ts`, `store.ts`
- Updated `backend/.env.example`, `render.yaml`
- Updated `frontend/src/app/store.tsx`,
  `frontend/src/features/account/Account.tsx`,
  `frontend/src/features/auth/AuthScreens.tsx`,
  `frontend/src/services/api/authApi.ts`,
  `frontend/src/services/api/http.ts`, `frontend/index.html`
- Updated `frontend/.env.example`; added `frontend/vercel.json`
- Updated `frontend/tests/account-ui.test.tsx`
- Added `backend/tests/deployment-config.test.ts`,
  `backend/tests/email-template.test.ts`,
  `frontend/tests/auth-repair.test.tsx`
- Updated `backend/tests/multiuser.test.ts`
- Updated `README.md`, `HOW_TO_USE_LEARNQUEST.md`,
  `docs/DEPLOYMENT_MULTIUSER.md`, and this report.

The pre-existing untracked prompt file
`LEARNQUEST_MAX_EFFORT_AUTH_REPAIR_PROMPT_2026-10-27.txt` was preserved. The
existing `backend/.env` was not read, printed, or modified; the health smoke was
run from an isolated temporary working directory so dotenv did not load it.

---

## 6. Verification evidence

### 6.1 Backend

```text
npm test
Test Files  9 passed (9)
Tests       72 passed (72)

npm run typecheck
tsc --noEmit -p tsconfig.json
(no output, exit 0)

npm run lint
0 errors, 76 pre-existing-style warnings

npm run build
tsc -p tsconfig.json
(no output, exit 0)

npm audit --audit-level=low
found 0 vulnerabilities
```

### 6.2 Frontend

```text
npm test
Test Files  35 passed (35)
Tests       283 passed (283)

npm run typecheck
tsc --noEmit -p tsconfig.json
(no output, exit 0)

npm run lint
0 errors, 4 warnings

npm run build
tsc --noEmit -p tsconfig.json && vite build
built successfully; no >500 kB chunk warning

npm audit --audit-level=low
found 0 vulnerabilities
```

The targeted regression test
`frontend/tests/auth-repair.test.tsx` passed 11/11, including:

- a session/config response without configuration does not throw
  `reading 'mongodb'`;
- a partial authenticated response is rejected;
- a password login without configuration fields succeeds without overwriting
  setup;
- a failed password login stays on the sign-in screen with the server message;
- a successful-looking login without a profile is rejected;
- Google buttons send `login` and `register` intents separately;
- recovery is described as an email link, not a numeric code;
- reset and email-verification tokens are captured from the fragment, stripped
  from history, and posted explicitly;
- a login 401 does not expire the session even with a stale CSRF token, while
  an authenticated endpoint 401 still emits `lq:auth-expired`.

### 6.3 Isolated health smoke

The built backend was started from a temporary working directory with all
integrations deliberately unset, so no production `.env` or external service
was used. `GET /api/health` returned:

```json
{
  "ok": true,
  "version": "0.3.0",
  "setupRequired": true,
  "authEnabled": false,
  "configured": {
    "mongodb": false,
    "google": false,
    "brevo": false,
    "session": false,
    "emailLinks": false,
    "youtube": false
  },
  "missing": [
    "MONGODB_URI",
    "SESSION_SECRET",
    "EMAIL_ACTION_HMAC_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "BREVO_API_KEY",
    "BREVO_SENDER_EMAIL"
  ]
}
```

This proves the process starts, the route responds, and configuration
reporting is value-free. It does not prove a configured production deployment.

### 6.4 Environment

```text
Node  v24.11.0
npm   11.6.1
Git   main @ 58c1b15 (ahead of origin/main by 2)
Pin   backend/.node-version = 24.22.1
```

---

## 7. Not verified in this environment

The following require real credentials, dashboards, or a browser session that
were not available. They must not be reported as passed:

| Item | Status | Why |
|---|---|---|
| Live Google OAuth sign-in/register/callback | **Not verified live** | No Google client credentials or registered redirect URI in this environment |
| Brevo delivery and rendering in real clients | **Not verified live** | No Brevo API key or verified sender; tests use a fake email service |
| MongoDB Atlas connectivity, indexes, TTL behavior | **Not verified live** | No database access; tests use in-memory adapters |
| Vercel `/api` rewrite to Render | **Not verified live** | No Vercel deployment access |
| Render `__Host-lq_session` cookie behavior | **Not verified live** | Requires the deployed proxy/service and a browser |
| Render Node `24.22.1` runtime | **Not verified** | Local runtime is `24.11.0` |
| Real-browser history/fragment behavior | **Covered by jsdom tests only** | No real browser automation was run in this pass |
| Mail-scanner GET safety in a real mailbox | **Covered by design/tests** | The exchange is an explicit POST; no live scanner was tested |

---

## 8. Owner-side deployment checklist

1. **Render environment**
   - Confirm `NODE_VERSION` is absent or exactly `24.22.1` (Dashboard values
     override `render.yaml`).
   - Set `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
     `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `YOUTUBE_API_KEY` only in the
     dashboard.
   - Confirm `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET` are present and
     stable. Existing `OTP_HMAC_SECRET` is accepted only as a fallback.
   - Confirm:
     - `APP_ORIGIN=https://learn-quest-one.vercel.app`
     - `CORS_ORIGIN=https://learn-quest-one.vercel.app`
     - `API_ORIGIN=https://learnquest-hhiv.onrender.com`
     - `GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback`
     - `TRUST_PROXY_HOPS=2`
2. **Google Cloud**
   - Register exactly
     `https://learn-quest-one.vercel.app/api/auth/google/callback`.
   - Add test users while the consent screen is in testing mode.
3. **Brevo**
   - Verify the sender address/domain.
   - Send a real password-reset email and an email-change email to controlled
     inboxes. Confirm HTML and plain-text rendering, link expiry, single use,
     prior-link invalidation, and the security notices.
4. **Vercel**
   - Project root `frontend/`; build `npm run build`; output `dist`.
   - Keep `VITE_API_BASE_URL` empty in Production and confirm
     `frontend/vercel.json` is deployed.
   - Confirm `https://learn-quest-one.vercel.app/api/health` reaches Render.
5. **Browser checks**
   - Confirm the `Set-Cookie` response has `__Host-lq_session`, `Secure`,
     `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`.
   - Sign in with Google, reload, and confirm `/api/account/data` still
     succeeds (first-party cookie, not just the OAuth redirect).
   - Try a nonexistent account and a wrong password; confirm the sign-in screen
     remains visible with the generic error and no MongoDB crash.
   - Try Google sign-in with an unregistered identity; confirm no account is
     created.
   - Complete registration, password reset, and email change end to end.
   - Confirm old reset/verification links fail after a new one is issued and
     after use.
6. **Rollback / data notes**
   - Legacy `lq_challenges` and `lq_reset_grants` were intentionally left
     untouched. They are no longer used by new flows and can be retired later
     after the owner confirms no rollback is needed.
   - Rotating `SESSION_SECRET` signs out all sessions. Rotating
     `EMAIL_ACTION_HMAC_SECRET` invalidates pending action links.
   - No database migration is required for the new token collection; indexes
     and the TTL are created on the first successful Mongo connection.

---

## 9. Final repository state

- No commit, push, reset, clean, stash, or branch switch was performed.
- `backend/.env` was not read, printed, or modified.
- The pre-existing untracked prompt file was preserved.
- `git status --short --branch` is captured in the session's final report
  output; the branch remains `main`, ahead of `origin/main` by 2.

**Verdict:** `LOCAL REPAIR VERIFIED — LIVE DEPLOYMENT CHECKS OWNER-SIDE`
