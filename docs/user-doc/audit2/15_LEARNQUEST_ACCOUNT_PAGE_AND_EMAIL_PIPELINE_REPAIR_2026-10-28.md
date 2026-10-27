# Report 15 — LearnQuest Account Page and Email Pipeline Repair (2026-10-28)

## Scope and execution policy

This report is the single final report for this run. Report 15 did not exist
beforehand, so it was created here rather than continued. The existing archive
index was updated in place; no second index or progress report was created.

The run covered:

- the current working tree, Git state, reports 13 and 14, and the deployed
  frontend/backend;
- a read-only MongoDB connectivity and state check;
- the Account route's shell/header isolation;
- cross-tab sign-out message isolation on password recovery;
- the complete password-reset email path, including one controlled live Brevo
  request;
- crypto/token generation, OTP remnants, session behavior, and account-data
  safety;
- targeted and full tests, typechecks, lint, builds, and dependency audits.

`#max` is a harness/session setting, not a repository setting. It was preserved
for further agent invocations wherever the harness supports it. No source,
environment, or deployment setting was changed merely to alter model behavior.

No secret was printed. This report contains no database URI, password, API key,
session token, reset token, email address, account identifier, or complete
provider exception message. No commit, push, reset, clean, stash, branch switch,
migration, legacy retirement, account deletion, or destructive database
operation was performed. Nothing was deployed.

## Repository baseline

At the start of the run:

```text
## main...origin/main [ahead 7]
?? LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_AUDIT_PROMPT_2026-10-28.txt
```

`HEAD` was `b279079 bad fix 6`. There were no tracked modifications. The only
untracked file was this run's prompt. Reports 13, 14, and the existing archive
index were already tracked in that commit. Existing work, environment files,
and secrets were left intact.

The local default runtime is Node `v24.11.0`; `backend/package.json` requires
`>=24.22.1 <25`. The supported runtime was also used explicitly for the
database diagnostic and both full test suites.

## Database connectivity and current state

The existing read-only diagnostic was run from `backend/` before any source
change:

```text
npm run diagnose:mongo -- --probe-tls
```

It returned:

```json
{
  "classification": "CONNECTED",
  "connected": true,
  "ping": true,
  "retryable": false,
  "elapsedMs": 387,
  "database": { "expected": "learnquest", "matches": true }
}
```

The same diagnostic under the declared Node `v24.22.1` also returned
`CONNECTED`, `connected: true`, `ping: true`, `elapsedMs: 623`. Live MongoDB
connectivity is genuinely verified; the previous TLS failure is no longer
present from this machine.

A read-only application-data inspection (not the server startup path) showed:

- one active, fully onboarded account;
- one active server session (ten session records in total);
- zero outstanding unexpired email-action tokens;
- four historical `password_reset` tokens, all consumed;
- legacy learning-data storage is still authoritative (`LQ_USER_DATA_STORE`
  unset, so the default `legacy` mode applies);
- three learning records in the legacy layout: one playlist snapshot, one meta
  record, and one active-playlist record.

The login timestamp and password version were inspected without printing the
account identity. The password version is still the onboarding version; none of
the four reset tokens was consumed by a completed password reset.

The application server was **not** started against Atlas. No index
initialization, deletion sweep, migration, or learning-data write was run. The
existing account and playlist state was preserved.

## Account page header leak

### Defect

Opening any `#/account/*` route still showed workspace shell content above the
Account page:

- the desktop sticky header with the active playlist title;
- the `N=... · source · fetched ...` playlist metadata line;
- the `Active playlist:` context row;
- the sidebar and mobile-header playlist switcher;
- dashboard-only onboarding content and shared notification/migration cards.

The Account page therefore looked embedded in the playlist workspace.

### Root cause

`frontend/src/app/App.tsx` rendered the workspace shell unconditionally and
only selected the Account component at the bottom of the shared `<main>`:

- the desktop sticky header always read `displayTitle` and `snap` metadata;
- the `<main>` always rendered the `Active playlist:` row, the legacy migration
  card, `lastDiff`, and celebration content;
- the sidebar and mobile header always rendered `PlaylistSwitcher`;
- the Account route had no shell-level branch that suppressed workspace-only
  content.

The hash router itself was already correct: `#/account/profile`,
`#/account/settings`, and `#/account/security` decode to the right tab and
section, and hash changes drive back/forward navigation. The leak was in shell
rendering, not in route parsing.

### Fix

`frontend/src/app/App.tsx` now derives `isAccountPage` from the current tab and
treats Account as a separate shell destination:

- the desktop sticky bar shows only an `Account` label plus the shared
  sync/account controls; it never reads the active playlist title or metadata;
- the `Active playlist:` metadata row is not rendered;
- the sidebar playlist switcher and the mobile-header switcher row are not
  rendered;
- dashboard onboarding, the legacy browser-data migration card, `lastDiff`, and
  celebration content are not rendered on Account;
- the outer shell carries `data-page="account"` for layout/testing;
- entering Account moves focus to the Account page heading; switching Account
  sections keeps the normal tab focus.

`frontend/src/features/account/Account.tsx` now exposes a stable, focusable
Account heading (`id="account-page-title"`), keeps the real `h1`, and marks the
tab list as horizontal. Shared navigation remains available, but no active
playlist can change the Account heading, layout, or content.

Direct URL load, hash navigation, and section switching continue to work. The
Account page still supports `#/account/profile`, `#/account/settings`, and
`#/account/security`; an unknown section safely falls back to Profile.

### Regression coverage

`frontend/tests/account-route.test.tsx` now renders the full App with a real
active playlist snapshot on all three Account routes and asserts the absence of:

- the playlist title;
- `Active playlist` / the active-playlist context row;
- `fetched` metadata and `N=...` playlist counts;
- the playlist switcher;
- dashboard onboarding and playlist-creation controls;
- the legacy migration card.

A separate test confirms the same active-playlist title and metadata still
appear in the normal workspace shell, so the fix does not hide legitimate
workspace content. Existing tests continue to confirm dashboard onboarding on
the dashboard route.

## Cross-tab logout message leak on password recovery

### Defect

The password-reset request confirmation screen showed:

- `Check your email` and the reset-link explanation; and
- `You were signed out in another tab. Sign in again to continue.`

The two messages describe unrelated states. The stale workspace sign-out notice
contaminated the public recovery screen.

### Root cause

Two independent paths combined:

1. `frontend/src/app/store.tsx` stored every remote sign-out reason in one
   `sessionNotice` state, regardless of whether the tab still had an
   authenticated session.
2. `frontend/src/features/auth/AuthScreens.tsx` rendered `authError` above all
   modes, including `forgot` and the `sent` confirmation state. There was no
   mode-level visibility rule and no route-entry cleanup.

The reset and verification link screens were already separate from the main
Auth component, but the request-confirmation state was inside `AuthScreens`.

### Fix

- `AuthScreens` only displays the cross-tab notice on the sign-in and account
  creation screens. Recovery and confirmation screens never render it.
- Entering `forgot` or `sent` clears the shared session notice through a new
  stable `clearAuthNotice` action.
- `enterMode` replaces direct mode changes, so local form errors are cleared
  without erasing a genuine recovery error.
- The store now ignores a remote sign-out notice when the tab was already
  signed out. A public recovery screen has no session to lose.
- Reset/verification action routes clear any stale session notice on mount.
- The confirmation copy now says an email will be **sent** if an eligible
  account matches, instead of implying that it has already arrived.

Genuine form errors still render on recovery screens. A real sign-out notice
still renders on the sign-in screen, and the existing cross-tab tests continue
to cover that behavior.

### Regression coverage

- Direct `AuthScreens` test: a notice is visible on sign-in, disappears after
  entering recovery, and stays absent after a successful reset request.
- Store integration test: an already signed-out tab remains on recovery after
  a storage-event sign-out and never shows the workspace warning.
- Standalone reset-link test: a remote event does not replace the
  `Choose a new password` screen with a workspace warning.
- Public-route 401 tests: `/auth/forgot` and `/auth/password/reset` do not fire
  the global session-expiry event, even with a stale CSRF token.
- Existing authenticated-tab tests still prove a real sign-out notice is shown
  and that late login/load responses cannot repopulate a signed-out tab.

## Email pipeline: trace and exact failure point

### Trace in the current working tree

1. **Form** — `AuthScreens` submits the username/email to `forgotPassword`.
2. **API client** — `frontend/src/services/api/authApi.ts` sends
   `POST /api/auth/forgot` with `{ identifier }`, `credentials: include`; it is
   a public/sessionless path, so it does not depend on an existing session.
3. **Backend route** — `backend/src/routes/auth.ts` applies the email-action
   rate limit, setup checks, and Brevo-configured check.
4. **Lookup/eligibility** — `findAccountByIdentifier` normalizes the identifier;
   only active, onboarded accounts with a normalized verified email are
   eligible. The public response is identical for known and unknown accounts.
5. **Cooldown** — the latest token creation time enforces
   `EMAIL_ACTION_RESEND_SEC`.
6. **Token issue** — `backend/src/auth/actionTokens.ts` generates 32 random
   bytes (`base64url`), stores only an HMAC-SHA256 digest, binds the token to
   the account, purpose, and account/new email, invalidates older outstanding
   tokens, and sets the configured expiry.
7. **Link construction** — `emailActionUrl` builds
   `${APP_ORIGIN}/#/reset-password?token=...`; the token is in the fragment, so
   it is not sent to Vercel, Render, logs, or analytics in a page request.
8. **Render** — `backend/src/email/brevo.ts` builds responsive HTML plus an
   equivalent plain-text alternative containing the same action URL.
9. **Provider call** — the route awaits `email.sendActionEmail`, which posts to
   `https://api.brevo.com/v3/smtp/email` with the configured key and sender.
10. **Response handling** — provider acceptance is logged with a sanitized
    message ID; rejected/timeout/network failures are logged with only status,
    a short provider code, a request ID, and a failure class. No recipient,
    token, API key, or raw provider body is logged.
11. **Failure cleanup** — if the send fails, the route invalidates the just-issued
    token and still returns the same generic `202` response.
12. **Completion** — the reset page POSTs the token explicitly, consumes it
    atomically, validates the bound account/email, hashes the new password with
    Argon2id, revokes all sessions, invalidates email actions, clears the cookie,
    and sends a security notice.

The actual forgot-password route does invoke the intended sender and awaits its
result. There is no second/legacy sender call site in the active path.

### Historical database evidence

The four historical reset tokens were all invalidated **0.8–1.1 seconds after
creation**. The account password version did not advance and no password reset
completed. A human clicking a reset link could not produce that timing. The
pattern is consistent with the route issuing a token, attempting a provider
send, failing, and immediately invalidating the token.

### Controlled live provider test

Exactly one controlled Brevo request was made to the single active,
owner-controlled account. No arbitrary recipient was selected. The request used
the currently configured provider credentials and sender and reported:

```json
{
  "liveProviderRequest": true,
  "messageSentToOwnerAccount": true,
  "status": 401,
  "accepted": false,
  "providerCode": "unauthorized",
  "messageIdPresent": false
}
```

The provider response indicated that the request came from an unrecognized IP
address that is not on the key's authorized-IP list and directed the owner to
the provider's authorized-IP security settings. The exact IP, provider link, and
raw message are deliberately omitted.

This is the exact current delivery failure point:

- the request reached Brevo;
- Brevo rejected it with HTTP 401 before acceptance;
- no provider message ID was issued;
- no message can have been delivered from that request;
- the application path classifies this as `provider_auth` and invalidates the
  local token.

A subsequent read-only senders/account check could not inspect sender
verification because the restricted API key returned `403 permission_denied`
for those endpoints. Sender verification status is therefore **not** proven by
this run.

### Configuration review (sanitized)

- `MONGODB_URI`: present, structurally valid `mongodb+srv`, database name matches
  `learnquest`; no value printed.
- `BREVO_API_KEY`: present and shaped like a provider key; permissions are
  restricted to sending, not account/sender administration.
- `BREVO_SENDER_EMAIL`: present. The configured sender uses a **consumer mailbox
  domain**, not a custom verified domain. This is a deliverability risk that
  cannot be assessed until the IP rejection is removed.
- `BREVO_SENDER_NAME`: present.
- `EMAIL_ACTION_HMAC_SECRET`: absent in the local environment; the supported
  legacy `OTP_HMAC_SECRET` is present and of sufficient length, so the fallback
  is active. No secret value was printed.
- `APP_ORIGIN` / `API_ORIGIN`: local HTTP origins in the local environment;
  production `render.yaml` defines the public frontend/API origins.
- `LQ_USER_DATA_STORE`: unset locally, so the existing authoritative legacy
  layout remains selected. No migration was run.
- `NODE_ENV`: development locally.

### Production path is also not deployed

Read-only checks on 2026-10-28:

- `https://learnquest-hhiv.onrender.com/api/health` returned `200` with version
  `0.2.0` and only liveness data.
- `.../api/ready` returned `404`.
- `.../api/auth/config` returned `404`.
- `https://learn-quest-one.vercel.app/api/auth/config` and `/api/health`
  returned `404`; the deployed Vercel bundle does not contain `/auth/forgot`,
  reset-password routes, or Account routes.

The live backend is still the old pre-auth version, and the live Vercel proxy is
not serving the repository's `/api` rewrite. Even with a corrected Brevo key,
production recovery cannot work until the current backend and frontend are
deployed. This is deployment/configuration work, not a local code defect.

### What is and is not proven

- **Proven:** the local code reaches Brevo and Brevo rejects the request with
  `401 unauthorized` due to the IP allowlist.
- **Proven:** the local database contains no orphaned usable reset token.
- **Not proven:** that the configured sender is verified or that the recipient
  inbox accepts the message after the IP restriction is removed.
- **Not proven:** production delivery; the production routes are not deployed.
- **Not claimed:** email delivery is fixed. The owner must correct the provider
  authorization first.

## Crypto, token, OTP, and authentication audit

### `Math.random` scan

The entire repository was searched for `Math.random`. No use occurs in active
security-sensitive generation:

- backend use: only YouTube retry jitter in
  `backend/src/services/youtube/youtubeService.ts`;
- frontend use: local UI/record IDs in `store.tsx`, `Player.tsx`,
  `revision.ts`, and `focus.ts`, plus the fictional competition cohort seed in
  `Competition.tsx`;
- test-only use: deterministic test data in existing tests.

No active OTP generation, password-reset token, email-change token, session
token, CSRF credential, or security challenge uses `Math.random`.

`backend/tests/token-security.test.ts` adds static guardrails that fail if
`Math.random` appears in the backend auth/email/session modules or the frontend
auth/session-sync modules. It also verifies that `randomToken(32)` produces 43
URL-safe characters with no collisions across 32 samples.

### Token design

- Password-reset and email-change tokens: 32 random bytes from Node
  `crypto.randomBytes`, encoded `base64url`.
- Persistence: HMAC-SHA256 digest only, with a dedicated/legacy-fallback secret.
- Purpose-bound and account-bound; email-change tokens also bind the new email
  and the account email at issue time.
- Short server-enforced expiry; resend cooldown; rate limiting.
- Atomic single-use consumption through a compare-and-set update.
- Older outstanding tokens invalidated when a new one is issued.
- No raw token or code in logs; the action URL keeps the token in the fragment.
- No numeric OTP flow remains active. Legacy `lq_reset_grants` and
  `lq_challenges` documents are only invalidated/account-deleted; no new code is
  generated.

### New hardening

Password change and password reset now invalidate **all** outstanding emailed
actions for the account, not only the same purpose. This closes two gaps:

- a reset link requested before a password change could otherwise remain usable;
- an email-change confirmation requested before a password reset could otherwise
  survive the reset.

Regression tests prove both cases return `INVALID_RESET_TOKEN` /
`INVALID_EMAIL_TOKEN` and leave no unconsumed action token.

### Password and session verification

- Passwords are hashed with Argon2id (`@node-rs/argon2`, versioned PHC string);
  tests assert the stored value starts with `$argon2id$`.
- A successful reset increments `passwordVersion` atomically, revokes every
  session, rotates/clears cookies, and invalidates email actions.
- Session tokens are random, stored only as HMAC-SHA256 digests; CSRF tokens are
  random and compared in constant time.
- Session records enforce idle and absolute expiry and reject revoked sessions.
- `passwordVersion` prevents a login that raced a password change from keeping
  an old-password session valid.
- Password policy remains at least 12 characters; it was not weakened.

## Session, cross-tab, and account isolation

Existing and new tests cover:

- two same-browser tabs both reuse the valid server-side session without a
  sign-in screen;
- signing out in one tab clears both tabs through BroadcastChannel or the
  storage fallback;
- the broadcast carries only `type`, `reason`, and `at` — no token, cookie,
  email, profile, or learning data;
- a late login or account-data response cannot repopulate a signed-out tab;
- password reset revokes all server sessions;
- reset/verification links work without an existing authenticated session;
- public recovery 401s do not trigger the global session-expiry handler;
- recovery screens cannot display a workspace cross-tab notice;
- session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, and
  `__Host-` scoped with no `Domain` attribute;
- cookies contain only the opaque session token, never playlists, progress,
  notes, analytics, or other learning data;
- account data remains scoped to the authenticated user and pending onboarding
  accounts are refused an empty learning state.

No cross-device session behavior is claimed as live-tested. That remains a
server/session property verified by unit/integration tests, not by signing into
two physical devices in this run.

## Learning-data safety

The existing fail-closed behavior was preserved:

- a database-unavailable request returns a sanitized retryable `503`, never an
  empty account or learning state;
- the client validates the full account-state contract before applying it;
- a failed read leaves `loadError` set and does not start the writer;
- a pending onboarding account is not given an empty account state;
- migration/legacy retirement was not run;
- the current database contains the existing playlist, meta, and active-playlist
  records and they were not modified.

The existing cloud-persistence and Mongo-readiness tests continue to cover
these boundaries. No new browser-only fallback was introduced.

## Accessibility and UI quality

- Account has a real `h1`, focusable on route entry, with semantic section
  headings and ARIA tabs.
- Account tabs support Left/Right/Home/End keyboard navigation and correct
  `aria-selected`, `aria-controls`, and tab order.
- Disabled/busy states prevent duplicate Account, password, delete, and reset
  submissions.
- The delete dialog remains a centered, scrollable, portaled alert dialog with
  focus return and explicit confirmation.
- Recovery confirmation now has one coherent message and no unrelated warning.
- Password reset validates confirmation, length, and match before submit; the
  reset link is single-use and rejected after expiry/replay.
- Existing glass-card styling, responsive grids, hover/focus states, and dark
  theme were retained.

No real-browser E2E run was performed. UI routing/layout verification was done
with the full-App jsdom test suite. This report does not claim a Playwright or
manual browser pass.

## Additional defects fixed in scope

1. **Stale email actions after password change/reset** — described above.
2. **Provider failure classification** — Brevo rejections now log a non-secret
   `classification` (`provider_auth`, `provider_rate_limit`,
   `provider_unavailable`, or `provider_validation`) in addition to status and
   provider code, so an operator can distinguish authorization/IP failures from
   validation or provider outages without seeing the raw response.
3. **Misleading arrival wording** — the confirmation screen and backend generic
   message now say the email will be sent, not that it has arrived or will
   arrive shortly.

No unrelated redesign, migration, deployment, or data operation was performed.

## Files changed

### Backend source

| File | Change |
|---|---|
| `backend/src/email/brevo.ts` | Added sanitized provider failure classification to rejected-send logs; no raw provider body or secret logging. |
| `backend/src/routes/auth.ts` | Password change and reset now invalidate all outstanding emailed actions; recovery copy no longer implies arrival. |

### Backend tests

| File | Change |
|---|---|
| `backend/tests/email-delivery.test.ts` | Added a Brevo 401/IP-authorization regression proving `provider_auth` classification and no logging of IP, provider link, recipient, or token. |
| `backend/tests/multiuser.test.ts` | Added password-change reset-link invalidation and reset-time email-change invalidation tests; updated generic-copy expectation. |
| `backend/tests/token-security.test.ts` | New static guardrails against `Math.random` in security modules and entropy/alphabet check for opaque tokens. |

### Frontend source

| File | Change |
|---|---|
| `frontend/src/app/App.tsx` | Separate Account shell branch; removed playlist title/metadata/switcher/onboarding/migration/notification content from Account; added Account focus management and `data-page` marker. |
| `frontend/src/app/store.tsx` | Added `clearAuthNotice`; ignored remote sign-outs when no authenticated session exists; cleared stale notices on action routes; passed the clear action to AuthScreens. |
| `frontend/src/features/account/Account.tsx` | Focusable Account heading and horizontal tablist semantics. |
| `frontend/src/features/auth/AuthScreens.tsx` | Scoped cross-tab notices to credential screens; clear on recovery entry; coherent confirmation copy. |

### Frontend tests

| File | Change |
|---|---|
| `frontend/tests/account-route.test.tsx` | Active-playlist leak regressions for all three Account routes plus workspace-shell control test. |
| `frontend/tests/auth-repair.test.tsx` | Recovery notice isolation and public-route 401 session-expiry regression tests. |
| `frontend/tests/auth-sync.test.tsx` | Signed-out recovery and standalone reset-link cross-tab isolation tests. |

### Documentation

| File | Change |
|---|---|
| `docs/user-doc/audit2/15_LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_REPAIR_2026-10-28.md` | This single final report. |
| `docs/user-doc/audit2/README.md` | Added report 15 to the existing archive index in place. |

## Verification results

All commands were run from the stated directory. Counts below are from this run.

### Targeted regressions

| Check | Command | Result |
|---|---|---|
| Account/recovery/session frontend tests | `npm test -- --run tests/account-route.test.tsx tests/auth-repair.test.tsx tests/auth-sync.test.tsx` | **3 files, 29 tests passed** |
| Email/security/backend tests | `npm test -- --run tests/email-delivery.test.ts tests/multiuser.test.ts tests/token-security.test.ts` | **3 files, 58 tests passed** |

### Full suites

| Check | Command | Result |
|---|---|---|
| Full frontend (default Node) | `npm test` | **41 files, 334 tests passed**, 90.77 s |
| Full backend (default Node) | `npm test` | **20 files, 160 tests passed**, 50.34 s |
| Full frontend (supported Node `24.22.1`) | `npx -y node@24.22.1 node_modules/vitest/vitest.mjs run` | **41 files, 334 tests passed**, 69.37 s |
| Full backend (supported Node `24.22.1`) | `npx -y node@24.22.1 node_modules/vitest/vitest.mjs run` | **20 files, 160 tests passed**, 16.03 s |

One first full-frontend run was executed in parallel with the backend suite and
one `ui-controls` test hit its 10-second timeout under contention. The test
passed in isolation (7/7, 3.13 s), and the clean full frontend rerun above
passed 334/334. This was a resource-contention timeout, not a code regression.

### Typecheck, lint, build, audit

| Check | Result |
|---|---|
| Frontend typecheck | Passed |
| Backend typecheck | Passed |
| Frontend lint | **0 errors, 4 existing hook-dependency warnings** |
| Backend lint | **0 errors, 84 existing `no-explicit-any` warnings** |
| Frontend production build | Passed (Vite 6.4.4) |
| Backend production build | Passed (`tsc`) |
| `npm audit --omit=dev` frontend | **0 vulnerabilities** |
| `npm audit --omit=dev` backend | **0 vulnerabilities** |

The changed files introduced no new lint warnings. No assertions or security
checks were weakened.

### Database recheck

The read-only diagnostic returned `CONNECTED` / `ping: true` under Node
`v24.11.0` and `v24.22.1`. The application-data inspection still reports the
single active account and the same three legacy learning records. No write was
made by this run.

## Local versus live

| Area | Local working tree | Live deployment |
|---|---|---|
| MongoDB | Connected and ping verified under both runtimes | Render health is liveness-only; readiness endpoint is not deployed |
| Account isolation | Fixed and covered by full-App tests | Deployed bundle has no Account/auth routes |
| Recovery notice | Fixed and covered by tests | Not deployed |
| Password-reset email | Reaches Brevo; rejected 401 due to source-IP authorization | No `/api/auth/forgot`; Vercel `/api` proxy returns 404 |
| Backend version | `0.3.0` | Render health reports `0.2.0` |
| Frontend | Current source builds successfully | Deployed bundle has no reset/account/auth code |

No live deployment, provider setting, credential, URI, or production
configuration was changed.

## Remaining owner actions

1. **Authorize the sending source in Brevo.** Add the current/live outbound IP
   (or the deployment's stable egress range) to the API key's authorized IPs, or
   remove the IP restriction if the key is safely scoped to transactional send
   only. Do not paste the key or IP into the repository or logs. After the
   change, use the existing read-only diagnostic/service logs and one controlled
   owner message to confirm Brevo returns `2xx` and a message ID.
2. **Verify the sender identity.** The current sender is a consumer mailbox
   domain. Confirm it is verified in Brevo, and preferably move production to a
   verified custom sender domain with SPF/DKIM/DMARC alignment. Do not assume a
   consumer mailbox sender will deliver reliably.
3. **Check Brevo Transactional → Logs** for the controlled message after the IP
   fix. Distinguish accepted, sent, delivered, blocked, bounced, and failed
   statuses from the provider's actual data; an API `2xx` is acceptance, not
   inbox delivery.
4. **Deploy the current backend and frontend.** The live Render service is
   `0.2.0` and lacks `/api/ready` and `/api/auth/config`; the live Vercel
   deployment does not serve the `/api` rewrite and has no auth/reset routes.
   Deploy only after review, then verify `/api/health` stays `200`,
   `/api/ready` becomes `200` only with a real database ping, `/api/auth/config`
   returns the matching configuration, and a reset link reaches the intended
   public route.
5. **Install the declared local Node runtime** (`24.22.1`) or keep using the
   temporary `npx` form. The local default remains outside the engine range even
   though the supported runtime passed all checks.
6. **Do not weaken TLS verification, rotate credentials without an
   authentication error, migrate data, or run destructive maintenance** merely
   to make email or connectivity appear fixed.

## Final Git status

No commit, push, reset, clean, stash, or branch switch was performed. No
production configuration or secret was changed. `backend/dist/` and
`frontend/dist/` were regenerated by the builds and are ignored by Git.

```text
## main...origin/main [ahead 7]
 M backend/src/email/brevo.ts
 M backend/src/routes/auth.ts
 M backend/tests/email-delivery.test.ts
 M backend/tests/multiuser.test.ts
 M docs/user-doc/audit2/README.md
 M frontend/src/app/App.tsx
 M frontend/src/app/store.tsx
 M frontend/src/features/account/Account.tsx
 M frontend/src/features/auth/AuthScreens.tsx
 M frontend/tests/account-route.test.tsx
 M frontend/tests/auth-repair.test.tsx
 M frontend/tests/auth-sync.test.tsx
?? LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_AUDIT_PROMPT_2026-10-28.txt
?? backend/tests/token-security.test.ts
?? docs/user-doc/audit2/15_LEARNQUEST_ACCOUNT_PAGE_AND_EMAIL_PIPELINE_REPAIR_2026-10-28.md
```

The 15 paths above are uncommitted: 12 tracked modifications (11 source/test
files plus the archive index) and 3 untracked files (this report, the token
security test, and this run's prompt). They are not committed or pushed. The
prompt file is shown for completeness and was not modified.

## Final assessment

- **Account header leak:** fixed by a dedicated Account shell branch; all three
  Account routes are covered by active-playlist leak tests.
- **Recovery notice leak:** fixed by mode-scoped visibility, route-entry cleanup,
  and ignoring remote sign-outs when no authenticated session exists.
- **Email delivery:** the exact current failure is external Brevo authorization:
  HTTP 401 `unauthorized` from an unrecognized source IP. The app correctly
  awaits the send, returns a generic public response, and invalidates the token
  on failure. No email delivery is claimed. Production is separately blocked by
  stale Render/Vercel deployments.
- **Crypto/token security:** no `Math.random` in security-sensitive generation;
  opaque 256-bit tokens, HMAC storage, expiry, purpose/account binding, atomic
  single use, rate limits, and invalidation are present. Pending email actions
  are now invalidated on password change/reset.
- **Database:** genuinely connected and pinged under both runtimes; existing
  account and legacy learning data preserved; no migration or destructive
  operation performed.
- **Verification:** fresh targeted and full suites, typechecks, lint, production
  builds, and dependency audits passed. No real-browser E2E was run and no live
  deployment was changed.
