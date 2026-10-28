# Report 17 - LearnQuest Authentication, Reset Navigation, Session/Cookie Security, Email Pipeline, and Node.js Runtime Final Audit (2026-10-28)

## Scope and execution policy

This is the single final report for this run. It continues Reports 15 and 16 and
the existing audit history. The archive index was updated in place. No
secondary report, progress file, or second index was created.

`#max` is a harness/model setting, not a repository setting. It was preserved
for follow-up invocations where the harness supports it. The CLI did not
confirm that `#max` was active, so this report makes no claim that it was.

No secret was printed. This report contains no password, database URI, API key,
session token, reset token, cookie value, HMAC secret, email address, account
identifier, authorization header, or raw provider response. No commit, push,
reset, clean, stash, branch switch, migration, account deletion, live database
cleanup, or destructive database operation was performed. Nothing was
deployed, and no real user password was reset.

## Executive summary

1. **The post-reset "Back to sign in" button is fixed.** The defect was not a
   styling problem or a missing route. The reset route was stored once in React
   state, and the button changed only the URL fragment with
   `window.location.assign('/#/auth')`. A same-document fragment change does
   not re-run the initial route parser, so the reset screen stayed mounted. The
   button now performs an in-app transition that clears reset/account state and
   renders the canonical sign-in screen. The reset token-bearing history entry
   is replaced, and no automatic sign-in occurs.
2. **Session and cookie behavior is defensible in source and covered by
   regression tests.** Production cookie construction uses a host-only `__Host-` cookie with
   `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`. The browser
   talks to the Vercel origin, whose `/api` rewrite proxies to Render, so the
   cookie remains first-party. CSRF is session-bound, origin checks are exact,
   rotation and revocation are server-side, and account routes derive identity
   only from the authenticated session.
3. **Two session-state defects were found and fixed.** The session-status
   endpoint did not apply the password-version and expired-onboarding checks
   used by protected routes, and the client treated every 401 from an
   authenticated path as a session expiry, including a wrong current password.
   Both paths now distinguish a rejected session from an ordinary domain error.
4. **The reset/action-token design remains strong.** Tokens are high-entropy,
   stored only as HMAC digests, purpose/account/email-bound, server-expiry
   enforced, atomically single-use, and never consumed by GET. Password reset
   revokes all sessions and invalidates outstanding email actions. Tests cover
   replay, expiry, wrong-purpose, wrong-account, concurrency, and database
   failure.
5. **The complete Brevo path is implemented and tested, but delivery is not
   verified.** The last controlled live provider request in Report 15 reached
   Brevo and was rejected with HTTP 401 `unauthorized` because the source IP
   was not on the key's authorized-IP list. No new provider request was made in
   this run because no owner-authorized controlled recipient or confirmed
   allowlist change was available. Provider acceptance is not claimed, and
   delivery is not claimed.
6. **The Node.js baseline is current.** Official Node.js release information
   was consulted at execution time. Node.js 24.22.1 LTS, released 2026-10-21,
   is the latest LTS security release and is the required baseline. Backend and
   frontend engines now require `>=24.22.1 <25`; the backend `.node-version` and
   Render blueprint request `24.22.1`. All builds, tests, and typechecks in this
   run used Node 24.22.1. The deployed Render runtime and Vercel build runtime
   could not be verified.
7. **Production is stale.** Render still reports `0.2.0` and lacks
   `/api/ready` and `/api/auth/config`. Vercel's `/api` routes return 404 and
   the live HTML asset hash does not match the current build. The local fixes,
   current cookie configuration, current reset route, and current email path
   are not live.
8. **No real-browser automation was run.** Verification used jsdom
   integration/component tests plus read-only HTTP checks. Production cookie
   behavior, the actual Vercel rewrite, and real inbox delivery remain
   owner-side checks after deployment.

## Baseline and preserved work

- Branch: `main`.
- `HEAD`: `e741852 partial fix`.
- The branch was ahead of `origin/main` by 8 commits before this run.
- The run preserved the pre-existing untracked prompt file
  `LEARNQUEST_AUTH_SESSION_EMAIL_RUNTIME_FINAL_AUDIT_PROMPT_2026-10-28.txt`.
- No existing source, test, environment, credential, database, or report
  content was reverted.
- The source changes from this run remain uncommitted.

## 1. The broken "Back to sign in" button

### 1.1 Reproduction and root cause

The reset-success screen was already rendered only after the backend confirmed
the password change. The defect was in leaving that screen.

The route was parsed once during provider initialization:

```tsx
const [actionRoute] = useState<EmailActionRoute | null>(
  () => readEmailActionRoute(),
);
```

The reset screen's exit handler then used:

```tsx
const exit = () => {
  window.location.assign('/#/auth');
};
```

`window.location.assign` to the same document with only a different fragment is
a same-document navigation. It changes `window.location.hash`; it does not
reload the document or re-run the initial state initializer. The provider had
no `hashchange` listener that updated `actionRoute`. Therefore the conditional
`if (mode === 'cloud' && actionRoute)` remained true and the reset screen
stayed visible. The button looked dead because the application state never
changed.

This also explains why a callback-only or CSS-only test would not catch the
defect: the callback did run, but the route state it changed was not the state
driving the screen.

### 1.2 Exact UI/routing fix

`actionRoute` is now mutable. A single `leaveEmailAction(destination)` function
performs the complete transition:

- invalidates in-flight authentication and cloud-data requests by advancing the
  auth epoch and cloud-load generation;
- cancels a pending save timer;
- clears the cloud user reference, CSRF token, account data, authenticated user,
  readiness/error state, session notice, session-scoped keys, and the local
  focus timer;
- replaces the current history entry with `#/auth` for sign-in or
  `#/auth?mode=forgot` for "request a new link";
- sets `actionRoute` to `null`, which unmounts the reset screen and lets the
  normal authentication screen render.

The success screen remains visible until the user activates the button. The
button is a real `<button>` with an accessible name, so mouse, keyboard, and
assistive-technology activation use the same path.

The history replacement removes the token-bearing reset entry. It also means a
Back navigation cannot reopen the dead reset screen from that entry. A direct
navigation or refresh at `#/auth` is handled by the normal route parser, which
returns `null` for `actionRoute` and renders the sign-in screen.

### 1.3 User-visible regression evidence

`frontend/tests/auth-repair.test.tsx` now contains the full acceptance test:

1. Open a reset link with a token in the fragment.
2. Let the server validate the link.
3. Submit a new password.
4. Confirm the `Password reset complete` success state appears only after the
   reset request succeeds.
5. Confirm the reset form is gone and the success screen is preserved until the
   user acts.
6. Click `Back to sign in`.
7. Confirm the real `Sign in` heading appears, the success screen and reset form
   are gone, the URL hash is `#/auth`, and the reset token is absent from the
   URL and rendered body.
8. Confirm no login request was made by navigation alone.
9. Enter the new password in the normal sign-in form and confirm the
   authenticated application content appears.

The same file also covers:

- expired link -> `Request a new reset link` -> `#/auth?mode=forgot` with the
  expired-screen removed;
- a fresh `#/auth` page load renders the sign-in screen, independent of reset
  screen state;
- real session-expiry codes trigger the expiry event, while wrong-password
  `INVALID_CREDENTIALS` responses from password change, re-authentication,
  email change, and account deletion do not;
- the reset page does not verify an email or change a password on page load.

Final targeted result: `tests/auth-repair.test.tsx` - 27 tests passed.

### 1.4 What is and is not proven

Proven locally in jsdom:

- the exact success-screen button click reaches the sign-in screen;
- the reset state and token are removed from the visible URL;
- navigation does not authenticate the browser;
- the new password works through the normal sign-in form;
- a fresh `#/auth` load renders sign-in.

Not proven in a real browser:

- actual Back/Forward behavior across a full browser session;
- actual refresh behavior in a deployed Vercel document;
- assistive-technology behavior beyond semantic button/heading assertions.

The design deliberately replaces the reset entry rather than pushing a new one,
so Back should not restore the token-bearing screen. The owner should still
perform the short manual browser check listed in section 10.

## 2. Session and cookie security

### 2.1 Real request topology

The repository is configured for a same-origin browser-to-Vercel path, not a
direct cross-origin browser-to-Render API path:

```text
Browser
  -> https://learn-quest-one.vercel.app
       static frontend + /api/:path* rewrite
  -> https://learnquest-hhiv.onrender.com
       Render edge
  -> Express backend
```

Relevant source/configuration:

- `frontend/vercel.json` rewrites `/api/:path*` to the Render service.
- `frontend/src/services/api/http.ts` defaults to an empty `VITE_API_BASE_URL`,
  which means same-origin `/api`.
- `render.yaml` sets `APP_ORIGIN` to the Vercel frontend, `API_ORIGIN` to the
  Render service, `GOOGLE_REDIRECT_URI` to the Vercel `/api/auth/google/callback`
  path, and `TRUST_PROXY_HOPS=2`.
- The browser therefore sees the session cookie on the Vercel host. A
  host-only cookie is first-party there, which is why `SameSite=Lax` is
  appropriate and why `SameSite=None` is not needed.

The live deployment does not currently match this topology: Vercel's `/api`
routes return 404, so the rewrite is not serving the current backend. This is a
deployment defect, not evidence that the source topology is wrong.

### 2.2 Cookie attributes

Production cookie construction is in `backend/src/auth/crypto.ts`:

| Attribute | Production behavior | Assessment |
|---|---|---|
| Name | `__Host-lq_session` | Host-only prefix requires Secure, Path=/, and no Domain. |
| `HttpOnly` | Present | JavaScript cannot read the session token. |
| `Secure` | Present in production | Cookie is HTTPS-only. |
| `SameSite` | `Lax` | Correct for the same-origin Vercel `/api` proxy; cross-site POSTs do not carry it. |
| `Path` | `/` | Required by `__Host-`; sent to the whole site. |
| `Domain` | Absent | Host-only scope; no parent-domain leakage. |
| `Max-Age` | Absolute session lifetime | Persistent cookie with a server-enforced absolute lifetime. |
| `Expires` | Matching absolute time | Redundant compatibility attribute. |
| Clearing | Empty value, `Max-Age=0`, epoch `Expires` | Uses the same name/path/secure/samesite attributes and removes the cookie immediately. |

Development uses the non-prefixed `lq_session` name and does not set `Secure`.
That is consistent with a loopback HTTP development origin. Production startup
forces `NODE_ENV=production`, which changes both the name and the `Secure`
attribute.

The cookie contains only the opaque session token. Tests confirm that account
profile fields and learning data are not placed in the cookie. The CSRF token is
kept in memory after login/session responses; it is not stored in
`localStorage`, `sessionStorage`, or the cookie.

### 2.3 CSRF, CORS, and origin checks

- `requireCsrf` compares the `X-CSRF-Token` header with the session record's
  per-session CSRF token using a timing-safe comparison.
- CSRF is required for state-changing authenticated routes: logout-all,
  password change, re-authentication, account profile/preferences/data
  mutations, email change, session deletion, and account deletion.
- Login, forgot-password, reset validation, reset completion, and email
  confirmation are intentionally sessionless/public. They are protected by
  credentials, single-use tokens, rate limits, and exact-origin checks rather
  than an existing session CSRF token.
- `POST /api/auth/logout` does not require a CSRF token. It can only revoke the
  current browser's session and clear its cookie; the global origin check and
  `SameSite=Lax` prevent a cross-site POST from carrying the cookie. The
  higher-impact `logout-all` requires CSRF.
- CORS uses an exact origin list with credentials enabled and never a
  wildcard. `CORS_ORIGIN` is merged with `APP_ORIGIN`; a `*` entry is rejected.
- `requireTrustedOrigin` rejects a present `Origin` header that is not in the
  exact allow-list. It does not trust `Host` or `X-Forwarded-Host` for link or
  origin construction.
- Helmet sets a restrictive CSP, HSTS in production, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, and frame protections. Auth/account
  responses use `Cache-Control: no-store` and `Pragma: no-cache`.

### 2.4 Session lifecycle, rotation, expiry, and revocation

Session records are server-side MongoDB documents. The raw session token exists
only in the cookie; the database stores an HMAC-SHA256 digest plus a random
session ID, CSRF token, user ID, auth method, password version, idle/absolute
expiry, revocation timestamp, user agent, and a truncated SHA-256 IP hash.

Verified behavior:

- **Creation:** 32 random bytes from `crypto.randomBytes`, base64url encoded.
- **Storage:** only `HMAC(SESSION_SECRET, "session:" + token)` is persisted.
- **Lookup:** requires the token digest and `revokedAt: null`; an absolute or
  idle-expired record is marked revoked and rejected.
- **Idle timeout:** default 7 days; `touchSession` extends idle expiry only up
  to the absolute expiry.
- **Absolute timeout:** default 30 days; never extended by activity.
- **Rotation:** login, Google callback, Google onboarding, and password change
  revoke the old token and create a new session. This prevents session
  fixation and makes a pre-login cookie useless after authentication.
- **Logout:** revokes the current session and clears the cookie.
- **Logout-all:** revokes every active session for the authenticated user;
  another account is unaffected. Covered by a two-account regression test.
- **Password reset:** revokes every session for the account, invalidates all
  outstanding email actions, clears the current cookie, and sends a security
  notice to the account email.
- **Password change:** revokes all other sessions, rotates the current session,
  invalidates all outstanding email actions, and sends a notice.
- **Email change confirmation:** revokes every session and requires sign-in
  with the new address; the previous address receives a notice.
- **Account deletion:** marks the account `deleting` first, then removes
  account-scoped sessions, action tokens, OAuth states, and learning records.
  The route clears the cookie even if cleanup must be resumed.
- **Stale cookie:** a revoked or expired record cannot be revived by presenting
  an old cookie value; lookup is against the current digest and revocation
  state.

### 2.5 Session-status consistency fix

`GET /api/auth/session` previously checked that the session existed and the
account was active, but did not apply the same password-version and
pending-registration checks as protected routes. A session whose password
version had advanced, or a pending Google registration whose onboarding window
had expired, could still be reported as authenticated and render an
authenticated shell until the next account request failed.

The endpoint now:

- compares the session's `passwordVersion` with the account's current version;
- rejects a pending registration session when
  `isGoogleOnboardingSession(...)` is false;
- revokes that session and clears the cookie before returning
  `{ authenticated: false, ...config }`.

Regression tests in `backend/tests/multiuser.test.ts` cover:

- stale password version -> `authenticated: false`, no CSRF token, cookie
  cleared, account data 401;
- expired pending-registration session -> `authenticated: false`, cookie
  cleared, account data 401;
- idle-expired and absolute-expired sessions rejected at the status endpoint.

### 2.6 401 and rejected-session UI handling

The API client previously treated any 401 from a non-sessionless path as proof
that the whole session had ended. That was wrong for re-authentication and
security-sensitive forms: a wrong current password returns
`INVALID_CREDENTIALS`, not a rejected session. The overbroad handler signed the
user out of an otherwise valid session.

`frontend/src/services/api/http.ts` now dispatches `lq:auth-expired` only for
the server codes that actually prove session rejection:

- `UNAUTHENTICATED`
- `SESSION_EXPIRED`
- `SESSION_REVOKED`
- `ACCOUNT_UNAVAILABLE`

For backward compatibility, a 401 without a code on a non-sessionless path is
still treated as a session rejection; current server routes always send a code.
The public sessionless paths are excluded. Regression tests cover real expiry
codes and wrong-password 401s from password change, re-authentication, email
change, and account deletion.

When a session is rejected, the client now calls `clearLocalSession(...)`:
it invalidates in-flight work, clears CSRF/account/auth state and the focus
timer, and shows the sign-in form with a scoped notice. It no longer shows the
misleading account-data-unavailable error card. A separate test covers this.

### 2.7 Cross-tab and cross-device behavior

Same-origin tabs use `frontend/src/app/authSync.ts`:

- preferred transport: `BroadcastChannel('lq-auth-sync-v1')`;
- fallback: a `localStorage` write that emits a `storage` event in other tabs;
- event payload: only `{ type: 'signed-out', reason, at }`;
- reasons: `sign-out`, `password-reset`, `email-change`, `account-deleted`;
- no token, cookie, email, user profile, or learning data is broadcast.

The store subscribes to these events and clears authenticated UI only when the
tab actually had an authenticated session. A public recovery/reset screen does
not inherit an unrelated workspace sign-out notice. Late login, account-load,
or save responses are invalidated by epoch/generation counters, so they cannot
repopulate authenticated UI after a sign-out.

Cross-device behavior is server-authoritative, not a real-time broadcast:

- `logout-all` revokes every session in MongoDB;
- password reset, password change, and verified email change revoke all
  sessions;
- another device's next request receives 401 and its client clears the account
  state;
- no claim is made that another device's open tab changes instantly before its
  next request.

If a local sign-out request cannot be confirmed by the server, the client now
warns that the device view was cleared but the session may still be active and
does not broadcast a false successful sign-out.

### 2.8 Account isolation

Protected account routes use `requireAuth`, which derives `userId` from the
session record, not from a client-supplied field. Account reads, collection
writes, imports, migrations, exports, session listing/deletion, email change,
and deletion all scope database operations to `req.auth.userId`.

Action tokens also bind `userId`, purpose, account email at issue time, and the
target email. A token cannot be replayed against another account or used after
the account email changes. Tests cover two-user read/write/archive/delete
isolation, client-supplied ownership-field rejection, and wrong-account reset
tokens.

### 2.9 Proxy and forwarded-header assessment

`backend/src/app.ts` sets Express `trust proxy` to the configured number of
hops, not `true`:

- production blueprint: `TRUST_PROXY_HOPS=2` (Vercel edge + Render edge);
- local default: 1;
- zero disables proxy trust for direct operation.

This is the correct approach for the documented topology. It means `req.ip`
and rate-limit keys use the client address only after the trusted hops. It also
means the deployment must keep the hop count aligned if the topology changes.
A wrong hop count would degrade IP attribution/rate limiting or let an
untrusted forwarding header influence the perceived client; it would not by
itself bypass session or CSRF checks. The configured value should be verified
after deployment, and the Render dashboard must not override it silently.

### 2.10 Session/cookie assessment summary

| Area | Source/config assessment | Test evidence | Live production |
|---|---|---|---|
| Same-origin cookie topology | Correct via Vercel `/api` rewrite | Tests model same-origin API | Vercel `/api` currently 404; unverified |
| Cookie flags | `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | Production cookie test | Old deployment; cannot confirm |
| CSRF | Session-bound token, timing-safe compare, required on mutations | CSRF-less mutation rejection tests | Old deployment |
| CORS/origin | Exact origins, credentials, no wildcard | Cross-origin mutation test | Old deployment |
| Rotation | Login/Google/onboarding/password change | Rotation tests | Old deployment |
| Expiry | Server-side idle and absolute | Status/data expiry tests | Old deployment |
| Revocation | Logout, logout-all, reset, change, email change, deletion | Multi-user and all-device tests | Old deployment |
| Account isolation | Session-derived user ID only | Two-user isolation tests | Old deployment |
| Client state clearing | Epoch invalidation + scoped notice | Cross-tab and rejected-session tests | Old deployment |

## 3. Password reset and action-token security

### 3.1 Token properties

- High-entropy opaque token: 32 random bytes from Node's CSPRNG, base64url.
- Persisted value: HMAC-SHA256 digest only; the raw token exists only in the
  email link and the consuming request.
- Purpose-bound: `password_reset` or `email_change`.
- Account-bound and email-bound: issue-time account email and target email are
  recorded and checked.
- Server-side UTC expiry: the consuming database filter includes
  `expiresAt > now`.
- Atomic single-use: `findOneAndUpdate` with `consumedAt: null`,
  `purpose`, and the expiry filter, setting `consumedAt` in the same operation.
- GET never consumes: the reset page uses an explicit read-only validation POST.
- Failure behavior: a database failure returns a sanitized 503 and does not
  report a successful password change.
- Password update only after validation and consumption; a weak password is
  rejected before the token is consumed.
- After success: password version increments, every session is revoked, all
  outstanding email actions are invalidated, legacy recovery artifacts are
  retired, and the cookie is cleared.
- New link issuance invalidates prior outstanding links for the same
  account/purpose, under a per-process issuance lock plus database compare-and-
  set.
- No raw token is written to logs, browser storage, analytics, or exception
  messages.

### 3.2 Link construction

`emailActionUrl()` uses only the validated `APP_ORIGIN`. It does not consult
request `Host` or `X-Forwarded-Host`. In production the origin must be HTTPS,
non-local, and exact; the email builder additionally requires the action URL's
origin to equal `APP_ORIGIN`. The token is in the fragment, not the query, so it
is not sent to the web server, proxy, scanner, or analytics service in the page
request. The frontend strips it from history immediately after reading it.

### 3.3 Regression coverage

The existing and new tests cover:

- expired token rejection, with the record remaining unconsumed;
- wrong-purpose, wrong-account, malformed, consumed, and replayed tokens;
- concurrent consumption allowing only one winner;
- read-only validation reporting valid/expired/invalid without consuming;
- reset success only after the backend confirms the change;
- all-session revocation and outstanding-action invalidation after reset;
- password-change invalidation of pending reset/email-change links;
- no false success when MongoDB is unavailable;
- Host/X-Forwarded-Host independence;
- no numeric OTP authentication routes and no `Math.random` in security
  modules.

A backend source scan found `Math.random` only in the YouTube retry jitter in
`backend/src/services/youtube/youtubeService.ts`, and the frontend
security-source guardrail test confirms the same for the authentication/session
modules. That value is not a credential, OTP, reset token, session token, or
security challenge and was left unchanged.

## 4. Brevo email pipeline

### 4.1 End-to-end path

The implemented path is:

1. The frontend submits the recovery identifier to the same-origin
   `/api/auth/forgot`.
2. The backend enforces setup checks, the email-action rate limit, and the
   Brevo-configured check.
3. The account lookup normalizes the identifier and requires an active,
   onboarded, password-reset-eligible account.
4. The response stays generic for known and unknown accounts and never contains
   a token or challenge identifier.
5. A per-account resend cooldown is enforced. A new issuance invalidates prior
   outstanding links for that account/purpose.
6. The action URL is built from the validated `APP_ORIGIN` with the token in the
   fragment and the configured TTL.
7. The Brevo adapter builds responsive HTML and an equivalent plain-text body
   with the same action URL and expiry.
8. The adapter posts to `https://api.brevo.com/v3/smtp/email` with the configured
   sender, recipient, subject, HTML, and text. The request has a 10-second
   timeout.
9. Provider response handling classifies:
   - 2xx: accepted/queued, with an optional `messageId`;
   - 401/403: `provider_auth`;
   - 429: `provider_rate_limit`;
   - 5xx: `provider_unavailable`;
   - other 4xx: `provider_validation`;
   - timeout: `email_provider_timeout`;
   - network failure: `email_provider_unreachable`.
10. Logs contain only safe operational fields such as event, kind, class, HTTP
    status, a short provider code, and a provider request ID. They never contain
    the raw provider body, recipient, token, API key, or action URL.
11. If the send fails, the just-issued token is invalidated and the public
    response remains generic. The backend does not claim success.
12. The recipient opens the fragment link, the frontend validates the token
    without consuming it, then the explicit reset POST consumes it, changes the
    password, revokes sessions, invalidates outstanding actions, clears the
    cookie, and sends a security notice.

### 4.2 Configuration presence (no values printed)

Local environment checks, without printing any value:

| Variable | Local presence | Production blueprint |
|---|---|---|
| `BREVO_API_KEY` | Present, non-empty | Required; configured through Render secret |
| `BREVO_SENDER_EMAIL` | Present, non-empty | Required; configured through Render secret |
| `BREVO_SENDER_NAME` | Present, non-empty | `LearnQuest` |
| `APP_ORIGIN` | Present, development origin | Vercel public HTTPS origin |
| `API_ORIGIN` | Present | Render public HTTPS origin |
| `CORS_ORIGIN` | Present | Vercel public origin |
| `SESSION_SECRET` | Present, non-empty | Generated by Render |
| `EMAIL_ACTION_HMAC_SECRET` | Absent locally | Dedicated generated secret |
| `OTP_HMAC_SECRET` | Present, non-empty | Legacy fallback only |
| `MONGODB_URI` | Present | Required; Render secret |
| `MONGODB_DB_NAME` | Present | `learnquest` |
| `EMAIL_ACTION_TTL_MIN` | Absent locally | 30 |
| `OTP_TTL_MIN` | Present locally | Legacy alias; not the production setting |
| `EMAIL_ACTION_RESEND_SEC` | Absent locally | 60 |
| `OTP_RESEND_SEC` | Present locally | Legacy alias; not the production setting |
| `NODE_ENV` | Development | Production |

The local environment therefore uses the supported legacy HMAC fallback and a
10-minute action TTL. The production blueprint uses the dedicated HMAC secret,
a 30-minute TTL, and a 60-second resend cooldown. This difference is
configuration, not a source defect. The server validates the numeric TTL and
cooldown at production startup and fails closed for invalid values.

### 4.3 Provider evidence and delivery status

The last controlled live provider request was documented in Report 15. It used
the single owner-controlled account and the configured credentials. Brevo
returned:

- HTTP 401;
- provider classification `unauthorized`;
- no message ID;
- no delivery.

The provider response indicated an unrecognized source IP that was not on the
API key's authorized-IP list. The exact IP, provider link, and raw message were
deliberately omitted. The application correctly classified this as
`provider_auth`, skipped any success claim, and invalidated the local token.

No new Brevo request was made in this run. Reasons:

- no owner-authorized controlled test recipient was available;
- the allowlist change was not independently verified;
- sending to an unrelated account would violate the execution policy.

Therefore:

| Stage | Evidence | Status |
|---|---|---|
| Frontend request construction | Source + tests | Verified locally |
| API route/eligibility/lookup | Source + tests | Verified locally |
| Token creation and URL construction | Source + tests | Verified locally |
| HTML/text rendering | Source + tests | Verified locally |
| Brevo authentication | Report 15 live request | Rejected with 401 source-IP authorization |
| Provider acceptance | No successful request | Not verified |
| Inbox delivery | No provider log/inbox evidence | Not verified |
| Reset-link navigation | Tests | Verified locally; not live |
| Token validation/update/revocation | Tests | Verified locally; not live |

Provider `2xx` would mean accepted or queued, not delivered. A `messageId` is an
acceptance receipt, not proof of inbox placement. Delivery requires the
provider's actual transactional log or recipient-side evidence, neither of which
was available.

### 4.4 Remaining email risks

- The configured sender was previously identified as a consumer mailbox domain,
  not a custom verified domain. Deliverability and sender verification remain
  owner-side checks.
- Brevo API key source-IP authorization remains the first blocking provider
  condition until the current Render egress address/range is authorized or the
  restriction is safely removed.
- The live Render backend is still `0.2.0` and does not expose the current
  forgot/reset routes, so production recovery cannot work even with a corrected
  provider key.
- The live Vercel `/api` proxy returns 404, so a deployed frontend cannot reach
  the current backend through the intended same-origin path.
- No provider log access was available from the CLI; the owner must check the
  Brevo transactional log after the IP fix.

## 5. Node.js security baseline

### 5.1 Official release information consulted at execution time

Sources:

- `https://nodejs.org/en/blog/release`
- `https://nodejs.org/en/blog/release/v24.22.1`
- `https://www.php.net/archive/2026.php`

Official findings:

- Node.js `24.22.1` "Krypton" LTS was released on 2026-10-21 as a security
  release.
- It is the latest LTS patch shown on the official release index at execution
  time. Node.js `26.12.1` is the Current line, not the project's production
  target.
- The release notes list:
  - CVE-2026-106069 and CVE-2026-106072: TLS reject non-canonical IP addresses
    (High);
  - CVE-2026-105482: DNS validate resolve inputs for null bytes (High);
  - CVE-2026-105483: TLS fix IP normalization regression (High);
  - CVE-2026-111497: Brotli cherry-pick (High);
  - CVE-2026-105481: HTTP agent data guard without I/O (Medium);
  - CVE-2026-106074: crypto reset random caches across snapshots (Medium);
  - CVE-2026-106073: permission model realpathSync check (Low);
  - updated root certificates to NSS 3.131.1;
  - updated c-ares to 1.34.9;
  - updated timezone data to 2026e;
  - updated OpenSSL sources to 3.5.9;
  - updated undici to 7.30.1.

This report does not claim every CVE is exploitable in LearnQuest. It claims
that the runtime baseline includes the official fixes and that the project must
not run an older Node 24 patch if these issues are relevant to its TLS, DNS,
Brotli, HTTP, crypto, or permission surfaces.

### 5.2 Runtime declarations

| Location | Value | Assessment |
|---|---|---|
| `backend/package.json` `engines.node` | `>=24.22.1 <25` | Matches required LTS baseline. |
| `backend/.node-version` | `24.22.1` | Local/CI version-manager pin. |
| `frontend/package.json` `engines.node` | `>=24.22.1 <25` | Added in this run; a declaration, not proof of the Vercel build runtime. |
| `render.yaml` `NODE_VERSION` | `24.22.1` | Blueprint request. |
| `render.yaml` comment | Dashboard `NODE_VERSION` can override | Must be checked after deployment. |
| Root `.nvmrc` | Absent | No conflicting root pin was found. |
| Frontend `.node-version` | Absent | Vercel project runtime must be verified separately. |

### 5.3 Local verification runtime

- Default installed Node: `v24.11.0`.
- All final builds, tests, typechecks, lint, and the MongoDB diagnostic in this
  run were executed with Node `v24.22.1` from a temporary `npx` package cache,
  placed first on `PATH`.
- Under that runtime, `process.versions` reported Brotli `1.2.0`, OpenSSL
  `3.5.9`, and undici `7.30.1`.
- No separate Brotli package appears in the backend/frontend lockfiles; the
  relevant Brotli code is in the Node runtime.
- `npm audit --audit-level=low` reported `found 0 vulnerabilities` for both
  backend and frontend.

### 5.4 PHP CVEs

The PHP security archive lists CVE-2026-109618 and CVE-2026-109619 as PHP
runtime vulnerabilities. They are not Node.js vulnerabilities. The repository
contains no `.php` files, `composer.json`, `composer.lock`, PHP Dockerfile, or
PHP deployment configuration. The observed deployment is Node.js on Render with
a Vercel static frontend. No PHP runtime was added or assumed.

### 5.5 `#max`

`#max` is not a repository setting. It is a harness/model reasoning selection.
It was preserved where supported, but the CLI did not confirm it was active.
Nothing in the source, runtime, deployment, or test results depends on it, and
this report does not claim it was active.

## 6. Verification results

### 6.1 Runtime and test commands

Final verification used Node `v24.22.1`:

```text
backend:  npm run typecheck   PASS
backend:  npm run build       PASS
backend:  npm test            PASS  (22 files, 185 tests)
backend:  npm run lint        PASS  (0 errors, 84 existing warnings)
backend:  npm audit           PASS  (0 vulnerabilities)

frontend: npm run typecheck   PASS
frontend: npm run build       PASS  (tsc --noEmit + vite build)
frontend: npm test            PASS  (41 files, 348 tests)
frontend: npm run lint        PASS  (0 errors, 4 existing warnings)
frontend: npm audit           PASS  (0 vulnerabilities)
```

Targeted results:

- `backend/tests/multiuser.test.ts`: 57 tests passed.
- `frontend/tests/auth-repair.test.tsx`: 27 tests passed.
- `frontend/tests/auth-sync.test.tsx` plus `auth-repair.test.tsx`: 37 tests
  passed when run together.

The frontend production build transformed 2,253 modules and emitted the current
bundle; the local entry asset was `index-D0BStoqG.js`.

Verification note: one full frontend run launched concurrently with the
production build and both lint jobs produced a single non-reproducible failure
in a timer-cleanup test. An isolated rerun immediately afterward passed all
41 files and all 348 tests, and the failure did not recur. No source change was
made between those runs. The final isolated result is the one reported above.

### 6.2 MongoDB connectivity/readiness

Read-only diagnostic under Node 24.22.1:

```json
{
  "diagnostic": "mongo-read-only-connectivity",
  "readOnly": true,
  "runtime": { "node": "v24.22.1" },
  "database": { "expected": "learnquest", "matches": true },
  "configured": true,
  "uri": {
    "scheme": "mongodb+srv",
    "structurallyValid": true,
    "options": {
      "hasCredentials": true,
      "hasDatabasePath": true,
      "optionKeys": [],
      "tlsOption": "unset",
      "sslOption": "unset",
      "directConnection": false,
      "replicaSet": false
    }
  },
  "classification": "CONNECTED",
  "connected": true,
  "ping": true,
  "retryable": false,
  "elapsedMs": 419
}
```

This diagnostic performs exactly one `ping`, opens no application write, and
does not print the URI, host, credentials, or raw driver exception. It confirms
current local connectivity; it does not confirm live Render readiness, because
the deployed service does not expose `/api/ready`.

### 6.3 Live Render and Vercel checks

Read-only checks at execution time:

| Check | Result | Interpretation |
|---|---|---|
| Render `/api/health` | 200, `version: "0.2.0"` | Live backend is an old release. |
| Render `/api/ready` | 404 | Current readiness endpoint is not deployed. |
| Render `/api/auth/config` | 404 | Current auth configuration endpoint is not deployed. |
| Vercel `/` | 200 HTML | Frontend is serving, but from an older build. |
| Vercel `/api/health` | 404 (Vercel `NOT_FOUND`) | `/api` rewrite is not serving the current backend. |
| Vercel `/api/auth/config` | 404 (Vercel `NOT_FOUND`) | Current auth API is not reachable through the frontend origin. |
| Live Vercel asset | `index-RgZDAXlN.js` | Does not match the current build's `index-D0BStoqG.js`. |
| Live Vercel headers | `Access-Control-Allow-Origin: *`; no current `vercel.json` security headers | Consistent with a deployment predating the current config. Static-content wildcard is not credentialed API access, but it confirms the stale build. |
| Render health headers | Helmet CSP/HSTS/nosniff/referrer policy; rate-limit header | Old backend still has some hardening, but not the current routes. |

The deployed Vercel HTML and backend are not the code in this working tree.
Production cookies, the real `/api` proxy, the current reset route, and the
current email path therefore cannot be verified from the live site.

### 6.4 Browser verification limitation

No Playwright, Cypress, Selenium, or other real-browser automation was available
or run. The reset-success acceptance test uses jsdom and React Testing Library,
which proves the user-visible component transition and URL state but does not
prove real-browser history, BFCache, or cookie behavior. The owner-side manual
check is mandatory before declaring the production flow fixed.

## 7. Files changed and reasons

| File | Reason |
|---|---|
| `backend/src/routes/auth.ts` | Apply password-version and expired-onboarding checks to `GET /api/auth/session`; revoke and clear the cookie instead of reporting a stale session as authenticated. |
| `backend/tests/multiuser.test.ts` | Add logout-all cross-account isolation, stale-password-version, expired-onboarding, and idle/absolute-expiry regressions. |
| `frontend/package.json` | Declare the Node engine baseline `>=24.22.1 <25` for the frontend. |
| `frontend/src/app/store.tsx` | Make the email action route mutable; add `leaveEmailAction()`; centralize `clearLocalSession()`; fix rejected-session UI; fix sign-out failure messaging. |
| `frontend/src/services/api/http.ts` | Only dispatch the global session-expiry event for real session-rejection codes, not wrong-password 401s. |
| `frontend/tests/auth-repair.test.tsx` | Add the confirmed reset-success -> sign-in acceptance test, expired-link -> forgot-password test, direct `#/auth` load test, and 401-code regressions. |
| `frontend/tests/auth-sync.test.tsx` | Add the server-rejected-session -> sign-in/scoped-notice regression. |
| `docs/user-doc/audit2/17_LEARNQUEST_AUTH_SESSION_EMAIL_RUNTIME_FINAL_AUDIT_2026-10-28.md` | This report. |
| `docs/user-doc/audit2/README.md` | Add the Report 17 row in the existing archive index. |

No backend dependency version was changed. No lockfile was regenerated. No
environment file, secret, database record, or deployment configuration was
changed.

## 8. Final Git status

At report creation:

```text
Branch: main
HEAD:   e741852 partial fix
Remote: main...origin/main [ahead 8]
```

Working tree:

```text
 M backend/src/routes/auth.ts
 M backend/tests/multiuser.test.ts
 M frontend/package.json
 M frontend/src/app/store.tsx
 M frontend/src/services/api/http.ts
 M frontend/tests/auth-repair.test.tsx
 M frontend/tests/auth-sync.test.tsx
 M docs/user-doc/audit2/README.md
?? docs/user-doc/audit2/17_LEARNQUEST_AUTH_SESSION_EMAIL_RUNTIME_FINAL_AUDIT_2026-10-28.md
?? LEARNQUEST_AUTH_SESSION_EMAIL_RUNTIME_FINAL_AUDIT_PROMPT_2026-10-28.txt
```

The prompt file was already untracked and was preserved. No commit, push, reset,
clean, stash, or branch switch was performed.

## 9. Local fixes vs deployment vs provider vs external configuration

### 9.1 Code defects fixed and tested locally

- Broken post-reset Back to sign-in transition.
- Reset/action route state not being cleared on exit.
- Residual reset token in URL/history after leaving the success screen.
- Session-status endpoint accepting stale-password-version and expired-onboarding
  sessions.
- Overbroad 401 session-expiry handling that signed users out on wrong current
  passwords.
- Rejected-session UI showing an account-data error instead of sign-in.
- Sign-out failure being reported/broadcast as a confirmed success.
- Frontend Node engine declaration missing the patched baseline.

### 9.2 Fixes that still require deployment

- The backend session-status consistency fix.
- The frontend reset-navigation and 401-handling fixes.
- The Vercel same-origin `/api` rewrite and current frontend build.
- Production `__Host-` cookie behavior through the Vercel proxy.
- The current forgot/reset routes on Render.
- Node 24.22.1 on Render and a current Vercel build runtime.

### 9.3 Live provider behavior actually verified

- Report 15's controlled Brevo request reached the provider.
- Brevo rejected it with HTTP 401 `unauthorized` because the source IP was not
  authorized.
- No provider acceptance, message ID, or delivery was observed from that
  request.
- No new provider request was made in this run.

### 9.4 External configuration that remains unverified

- Whether the current Render egress IP/range is now allowed by the Brevo key.
- Whether the sender identity/domain is verified and deliverable.
- Whether a controlled message is accepted and delivered after the IP fix.
- Whether Render actually runs Node 24.22.1 (dashboard override and runtime
  evidence).
- Whether Vercel actually uses the current `vercel.json` rewrite and security
  headers.
- Whether the production proxy preserves `Set-Cookie` exactly as expected.
- Real-browser BFCache/Back/Forward behavior.
- Any real inbox delivery.

## 10. Remaining owner-side steps

1. **Review and commit the working tree.** The changes are intentionally
   uncommitted. Do not deploy an unreviewed mix of old and new files.
2. **Deploy the current backend and frontend.** Ensure Render uses the current
   `backend` build and Vercel uses the current `frontend` build with
   `frontend/vercel.json`. The live Render service is still `0.2.0`; the live
   Vercel `/api` routes return 404.
3. **Verify Render runtime configuration.** Confirm the dashboard has no
   `NODE_VERSION` override older than `24.22.1`, and that the service reports
   the intended Node runtime. The blueprint requests `24.22.1`, but a dashboard
   variable can override it.
4. **Verify Vercel build runtime.** `frontend/package.json` declares
   `>=24.22.1 <25`, but that is not proof of the build runtime. Confirm the
   project's Node.js version setting after deployment.
5. **Verify the proxy topology.** After deployment, check:
   - `https://learn-quest-one.vercel.app/api/health` returns the current
     backend health response;
   - `https://learn-quest-one.vercel.app/api/ready` is reachable;
   - `https://learn-quest-one.vercel.app/api/auth/config` is reachable;
   - `TRUST_PROXY_HOPS=2` still matches the actual Vercel + Render chain.
6. **Inspect the real cookie in a browser.** After a successful sign-in, confirm
   `__Host-lq_session` has `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no
   `Domain`, and a sensible expiry. Confirm sign-out/reset clears it with the
   same attributes. Confirm no session token appears in local/session storage.
7. **Fix Brevo source-IP authorization.** Add the current Render egress
   IP/range to the API key's authorized IPs, or safely remove the restriction
   if the key is scoped to transactional send only. Do this in the provider,
   not in source.
8. **Verify the sender identity.** Confirm the configured sender is verified;
   preferably use a custom domain with SPF/DKIM/DMARC alignment rather than a
   consumer mailbox domain.
9. **Run one controlled owner-authorized delivery test.** Use only an
   owner-controlled recipient. Confirm:
   - provider HTTP 2xx and a message ID (acceptance, not delivery);
   - the provider transactional log shows accepted/sent/delivered status;
   - the email link uses the public Vercel origin, not localhost;
   - the TTL shown in the email matches the configured production TTL (30
     minutes);
   - the link works once before expiry;
   - an expired/replayed link is rejected by the server.
10. **Manual real-browser acceptance.** Complete a reset, see the success
    screen, click `Back to sign in`, confirm the sign-in screen appears, confirm
    the reset token is gone from the URL/history, sign in with the new password,
    and refresh `#/auth`. Also check cross-tab sign-out and a second-device
    `logout-all` revocation.
11. **Do not claim email delivery from a 2xx alone.** Report acceptance,
    delivery, bounce, or block status separately from the provider log.

## 11. Residual risks and audit conclusion

- **Production is not verified.** The source fixes are tested, but the live
  deployment is stale. The current cookie, reset, and email behavior is not
  live.
- **No real-browser test was run.** jsdom proves component transitions and URL
  state, not actual browser history/BFCache or cookie transport.
- **Brevo remains blocked externally.** The last live request was rejected on
  source-IP authorization. No acceptance or delivery is claimed.
- **The sender-domain risk remains.** A consumer mailbox sender is a
  deliverability risk even after the IP fix.
- **Proxy hop count is configuration-sensitive.** `TRUST_PROXY_HOPS=2` matches
  the documented Vercel + Render topology; a topology change requires an update.
- **In-memory rate limiting is per process.** If the backend is horizontally
  scaled, per-process limits are not a global quota. The current single-service
  blueprint does not demonstrate a bypass, but this is an operational limit to
  revisit if scaling changes.
- **`#max` is unconfirmed.** It is not claimed as active or as a security
  control.

Within the local code and test boundary, the reset-success navigation is fixed,
the session/cookie design is consistent with the actual same-origin proxy
topology, stale and revoked sessions are rejected server-side, reset tokens are
single-use and purpose/account-bound, and the Node.js baseline is current. The
remaining failures are deployment and external-provider configuration, not
untested local behavior.
