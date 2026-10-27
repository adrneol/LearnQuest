# LearnQuest Multi-User Platform — Implementation & Verification Report

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `40af48c6d9023fb73791b0166c22d3fc4102a69d`  
**Working tree:** Intentionally uncommitted. No commit, push, branch change, reset, clean, stash, or destructive checkout was performed.  
**Scope:** Authenticated multi-user platform, MongoDB persistence, Google-only registration, password sign-in, Brevo OTP recovery/email change, checkpoint form redesign, two-choice playlist removal, regression/security tests, configuration, deployment docs, and final verification.

---

## 1. Executive summary

The requested multi-user platform was implemented end-to-end and verified locally. Accounts, sessions, learning data, migration, archive, and permanent deletion are now server-authoritative in production. Authentication is fail-closed: missing MongoDB, Google, Brevo, or secret configuration does not enable a fake local login, predictable OTP, or client-trusted `userId`.

Final measured gates:

| Gate | Result |
|---|---|
| Backend tests | **54 / 54 passed** (7 files) |
| Frontend tests | **272 / 272 passed** (34 files) |
| Backend typecheck | **Passed** |
| Frontend typecheck | **Passed** |
| Backend lint | **0 errors / 75 warnings** |
| Frontend lint | **0 errors / 4 warnings** |
| Backend production build | **Passed** |
| Frontend production build | **Passed**; largest JS chunk 388.58 kB (gzip 117.44 kB) |
| Full dependency audit (both packages) | **0 vulnerabilities** |
| Production-only dependency audit | **0 vulnerabilities** |
| Backend health smoke test | **HTTP 200**, version `0.3.0`, fail-closed status truthful |

Two additional removal bypasses were found and fixed during verification: custom-titled playlists failed the typed-title check because the backend compared only the source title, and the Reports playlist menu still exposed the old one-click delete/raw archive path. Both now use the canonical managed flow.

Production external services were **not** live-verified because no real MongoDB, Google, or Brevo credentials are present in this environment. This is the main remaining limitation; the exact boundary is documented in §12.

### 1.1 Continuation verification (same date)

A second pass compared the full original specification and addendum against every
tracked and untracked path, then fixed remaining integrity and deployment gaps:

- **Rollback on partial writes.** Collection and full-state replacement now
  snapshot previous rows, restore them if a later insert fails, and release the
  reserved data version. A failed import/migration cannot leave a half-written
  account or appear successful.
- **Restartable permanent deletion.** Deletion jobs now persist the displayed
  title plus the checkpoint, goal, and Focus-session attribution keys. A failure
  after the playlist document is removed no longer makes retry return `404`;
  the original tab's pre-reservation version is accepted while the job remains
  resumable, and a retry cannot lose checkpoint/goal/Focus XP attribution.
- **Complete XP attribution.** `code:`, `ex:`, `built:`, and playlist-owned
  `focus:` XP are now deleted with their playlist on both the backend and
  frontend paths. Focus attribution uses the same persisted key format on both
  sides. Checkpoint-linked goals with `playlistId: null` are counted and
  removed consistently.
- **No metadata-only restore wipe.** `/api/account/import` now extracts
  `state`, `data`, or a raw state and rejects an envelope that has no
  recognized learning-data collection before reserving a version. Previously a
  payload such as `{version, exportedAt}` could be treated as an empty account.
- **Cookie topology corrected.** The deployment guide previously recommended
  pointing Vercel directly at Render. Production uses
  `__Host-lq_session` + `SameSite=Lax`, so a `*.vercel.app` page calling
  `*.onrender.com` is cross-site and never sends the cookie. The guide now
  requires either a same-origin Vercel `/api` proxy or same-site custom
  domains (for example `app.example.com` + `api.example.com`); the Google
  redirect URI must match the chosen public origin.
- **Cloud-neutral UI wording.** Error/loading text no longer claims data is
  local-only when the cloud store is active.
- **Test stability.** The revision lifecycle test now waits for the settled
  `needsRevision: false` IndexedDB write before remounting. Testing Library's
  async utility timeout is 5s, matching the existing 10s test timeout, so a
  busy machine does not turn a correct but slow store/effect render into a
  false failure.

The durable coverage ledger for this continuation is
[`LEARNQUEST_MULTIUSER_PROGRESS_2026-10-27.md`](./LEARNQUEST_MULTIUSER_PROGRESS_2026-10-27.md).

---

## 2. Baseline and constraints

- Branch `main`, HEAD `40af48c`; the only pre-existing untracked user file was `learnquest-multimuser-platform-prompt.txt`, preserved.
- Prior audit reports were preserved without modification.
- Existing `backend/.env` values were not printed and were not overwritten. Missing keys were appended; the file remains git-ignored.
- No real account, IndexedDB database, or external service was used for destructive testing.
- Tests use an in-memory database adapter, mocked Google OIDC responses, and a fake email service.
- No live browser, screen-reader, Render, Vercel, Google Cloud, Brevo, or MongoDB Atlas session was available.

---

## 3. Backend implementation

### 3.1 Data layer

- Added a small `DbAdapter` abstraction with two implementations:
  - official MongoDB driver (`mongodb@^7.7.0`) for production;
  - in-memory adapter for tests.
- Repository logic is shared between both, so tests exercise the same ownership, version, migration, archive, and deletion code paths.
- Collections:
  - `lq_accounts`
  - `lq_sessions`
  - `lq_challenges`
  - `lq_oauth_states`
  - `lq_deletions`
  - `lq_migrations`
  - `lq_reset_grants`
  - `lq_state_versions`
  - per-domain `lq_data_<collection>` documents keyed by `{ userId, key }`.
- User learning collections are split by domain (playlists, progress, sessions, XP, etc.) rather than stored in one unbounded document.
- Indexes and TTL cleanup are created on first Mongo connection. Session/OTP records are server-side; no token or OTP is stored in plaintext.

### 3.2 Authentication and sessions

- **Google-only registration** through an OAuth start/callback flow with PKCE and single-use state.
- Google ID-token verification uses `jose` with JWKS, issuer, audience, nonce, expiry, and verified-email checks. Identity is anchored to the stable provider `sub`, not the mutable email.
- Onboarding is completed with a unique username, display name, and password.
- **Password sign-in afterwards** supports username or verified email.
- **Argon2id** password hashing (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, `outputLen: 32`) via `@node-rs/argon2`.
- Unknown-account and wrong-password logins use the same generic response; a dummy Argon2 verify burns comparable work to reduce timing/account-enumeration signals.
- Sessions are server-side, with HMAC-hashed tokens, idle and absolute expiry, last-seen updates, explicit revocation, and rotation on login, onboarding, password change, and password reset.
- Production cookie: `__Host-lq_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`. Development uses `lq_session` without `__Host-`/`Secure`.
- Mutations require `X-CSRF-Token`; the token is bound to the server session.
- Exact-origin middleware rejects untrusted browser origins; CORS allows credentials only for configured exact origins and rejects wildcards.
- Recent-reauthentication checks protect password changes, email changes, and account deletion.
- Rate limits cover auth, OTP, and general API traffic; `TRUST_PROXY_HOPS` controls trusted proxy handling.

### 3.3 OTP and Brevo

- Six-digit OTP from `crypto.randomInt`, never `Math.random`.
- HMAC-SHA256 verifier bound to challenge ID, user ID, purpose, normalized email, and code.
- 10-minute default TTL, 5 attempts, resend cooldown, single active challenge per purpose/user, atomic single-use consumption.
- Password-reset completion uses a separate single-use reset grant (`lq_reset_grants`) with an HMAC-hashed token and a 10-minute lifetime.
- Email change verifies the new address before activation; the old address remains active until verification.
- Brevo sends HTML and plain-text emails. Missing Brevo configuration disables recovery rather than faking it.
- Generic forgot-password responses do not reveal whether an account exists.

### 3.4 User data and ownership

- Every repository operation scopes by the authenticated `userId`; client-supplied ownership fields are rejected.
- Per-collection writes use optimistic concurrency (`expectedVersion` + server version). Stale writes return `VERSION_CONFLICT`.
- Validators enforce collection shapes, sizes, entry identity, positions, timestamps, and allowed fields.
- Account export excludes password hashes, OTPs, reset grants, and session tokens.
- Account deletion removes account-owned collections, sessions, deletion/migration/version records, and challenges; other accounts are untouched.

---

## 4. Playlist archive vs permanent deletion

### 4.1 Archive

- Archiving sets `meta.archived = true` without deleting learning records.
- Archived playlists are excluded from the active-playlist selector and active dashboard totals.
- If the archived playlist was active, a remaining non-archived playlist is selected; otherwise `activeId` becomes `null`.
- Restore reuses the same records and XP; it does not recreate or duplicate XP.
- The dashboard manager and Reports both call the managed archive/restore endpoints. The old raw meta toggle was removed.

### 4.2 Permanent deletion

- Requires the exact **displayed** playlist title, including a custom title.
- Backend summary now resolves `meta.customTitle ?? snapshot.title`; this fixed a mismatch where the dialog asked for one title while the server compared another.
- Deletion uses a job document (`lq_deletions`) with `running` / `failed` / `completed` states and per-collection counts.
- Ordered deletion covers progress, ranges, checkpoints, modules, sessions, segments, play sessions, scoped goals, queue, playlist snapshot, and meta.
- XP is removed only when its dedup key gives reliable attribution:
  - `done:<playlistId>:…`
  - `rev:<playlistId>:…`
  - `ach:<playlistId>:…`
  - `cp:<checkpointId>:…` where the checkpoint belongs to the playlist
  - `goal:<goalId>:…` where the goal belongs to the playlist
- Day goals, account-wide settings/preferences, unrelated playlists, and unattributable XP are preserved.
- A valid remaining active playlist is chosen after deletion.
- A failed step records `status: failed`, returns HTTP 500 with `DELETE_INCOMPLETE`, and never claims success. Retry safely resumes; a completed job returns `alreadyDeleted: true`.
- The UI requires the typed title, shows affected record counts, and reports success only after the backend call succeeds.
- The Reports menu no longer offers the old one-click delete; it directs the user to the canonical dashboard manager.

---

## 5. Frontend implementation

### 5.1 Store and sync

- Store modes: `local` (tests and development/test path) and `cloud` (production default).
- `import.meta.env.MODE === 'test'` forces local mode so existing IndexedDB tests remain valid. Production builds default to cloud.
- Cloud mode loads account state from the server, never treats the browser as authoritative, and never falls back to an apparently empty local database.
- Per-collection debounced saves send only changed collections, sequentially, with server version and fingerprints.
- Save status is explicit: saving, saved, error, conflict. A conflict offers reload; an error offers retry.
- Sign-out and session expiration clear account state and the focus recovery snapshot without writing local learning data.
- Account deletion clears in-memory state and returns to authentication.

### 5.2 Account UI

- Account menu is in the **top-right of the main header** on desktop and mobile; it is not in the sidebar.
- Menu actions: Profile, Account settings, Security & active sessions, Export account data, Sign out.
- Profile: verified email (read-only), username, display name, Google-link status, password status, member since.
- Account settings: timezone, session length, break length, minimum viable session, account export, refresh, and account deletion.
- Security: password change/setup, email change with OTP, active session list, per-session sign-out, and sign-out all devices.
- Account deletion requires the exact username, current password when one exists, recent reauthentication, and a danger confirmation.

### 5.3 Authentication screens

- Sign-in with Google or username/email + password.
- Google-only registration screen; onboarding collects username, display name, password, and timezone.
- Forgot-password → six-digit OTP → new password flow.
- Setup-required screen when core account services are missing; no fake login.
- Account-unavailable screen when the cloud service is unreachable; no local-only fallback.
- Disabled integrations are named explicitly (e.g., Brevo recovery not configured).

### 5.4 Legacy IndexedDB migration

- Legacy data is inspected only after authentication, never on the login screen.
- Merge rules: existing cloud records win on identical IDs; missing records are added; XP is deduped by `dedupKey`; sessions by `clientId`; migration is idempotent via `lq_migrations`.
- A local claim marker (`lq-legacy-claim-v1`) prevents a different account from inheriting the same browser data.
- The local source is retained on failure and can be retried.
- Users can download a local backup first and remove the local copy only after server confirmation.

---

## 6. Checkpoint form redesign

- One required video-range field accepts:
  - `1-8`
  - `1 – 8`
  - `1–8`
  - a single position such as `103`
- Automatic labels: **Videos 1–8** and **Video 103**.
- Optional custom name replaces only the generated label.
- Live preview states the label, inclusive range, video count, and that the range is not entered twice.
- Strict validation rejects empty, reversed, fractional, negative, malformed, multiple-range, and out-of-bounds input. Out-of-bounds values are **not clamped**.
- Editing an auto-generated label updates it to the new range; a custom name is preserved.
- Checkpoints and saved Library ranges are visually and semantically separated: saved ranges are duration calculations, not completion milestones, and do not award checkpoint XP.
- Tests cover parsing variants, invalid input, no clamping, custom names, generated labels, UI preview, creation, and edit preservation.

---

## 7. Configuration and environment

### 7.1 `backend/.env`

- Existing keys were preserved: `YOUTUBE_API_KEY`, `PORT`, `CORS_ORIGIN`, `CACHE_TTL_SEC`, `RATE_LIMIT_PER_MIN`.
- Added missing keys, including `NODE_ENV`, origins, rate limits, Mongo, Google, Brevo, session/OTP policy, and account size limit.
- Generated `SESSION_SECRET` and `OTP_HMAC_SECRET` with `crypto.randomBytes(48).toString('base64url')` (**64 characters each**, unique).
- No MongoDB, Google, or Brevo credential was fabricated. Those keys remain empty and must be supplied by the owner.
- No duplicate keys; 29 keys total.
- `.env` remains ignored by `.gitignore` and was never printed.
- `.env.example` now documents every runtime variable; a script confirmed all 29 environment names used by `src/config/env.ts` are present.
- Health smoke test with current local config returned HTTP 200, `version: 0.3.0`, `setupRequired: true`, missing only `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`; session, OTP, and the existing YouTube key report configured (validity not tested).

### 7.2 Node version pin

- `backend/.node-version` → `24.22.1`.
- `backend/package.json#engines` → `>=24.22.1 <25`.
- `render.yaml` requests `NODE_VERSION=24.22.1`.
- **Render Dashboard risk documented:** a dashboard-level `NODE_VERSION` overrides the Blueprint. An old dashboard pin silently defeats `.node-version` and `engines`.
- The official Node.js distribution index confirms `v24.22.1` was published on 2026-10-20 as a security release (LTS “Krypton”). It was **not executed here**.
- Local runtime is **Node v24.11.0**, so the patched 24.22.1 runtime itself could not be executed; npm correctly warns `EBADENGINE`. All tests and builds ran on v24.11.0.

### 7.3 Documentation

- Updated `README.md` for accounts, cloud persistence, configuration, deployment, and troubleshooting.
- Updated `HOW_TO_USE_LEARNQUEST.md` for sign-in/recovery, account security, the one-range checkpoint form, archive vs delete, and cloud data safety.
- Added `docs/DEPLOYMENT_MULTIUSER.md` with MongoDB, Google, Brevo, Render, Vercel, cookie/CORS, and post-deploy checks. The cookie section now documents the two supported first-party topologies (same-origin `/api` proxy or same-site custom domains) and rejects a direct `*.vercel.app` → `*.onrender.com` API URL.
- Added `docs/audits/LEARNQUEST_MULTIUSER_PROGRESS_2026-10-27.md` as the durable coverage ledger for this continuation.
- Prior audit reports were preserved.

---

## 8. Verification results

### 8.1 Automated tests

| Suite | Result | Coverage highlights |
|---|---|---|
| Backend | **54 / 54** (7 files) | Account registration/onboarding, session rotation, CSRF, production `__Host-` cookies, password reset, OTP reuse/expiry/attempts, Google state/nonce, cross-user isolation, ownership injection rejection, versions, migration idempotency, archive preservation, restore no duplicate XP, custom-title deletion, delete cascade/fallback/retry failure, XP attribution variants, rollback after partial collection/full-state writes, retry after playlist-document deletion, metadata-only import rejection, production startup fail-closed, export, account deletion |
| Frontend | **272 / 272** (34 files) | All prior domain/UI suites, plus checkpoint parsing/form, archive/restore, typed custom title, permanent delete attribution for `code`/`ex`/`built`/Focus XP and checkpoint-linked goals, cancel, account menu/screens, Reports removal routing |

A parallel run that also executed the production build caused three unrelated UI tests to hit Vitest's 5-second default while the CPU was saturated. The suite passed 272/272 when run alone. The frontend test/hook timeout is now 10 seconds to absorb normal build/backend load; no assertion was changed or skipped.

New regression tests added in this pass:

- `backend/tests/multiuser.test.ts` — **28 tests** (multi-user, security, archive, delete, XP attribution, rollback, import/export, migration, runtime and production startup fail-closed).
- `frontend/tests/checkpoint-range.test.ts` — **7 tests**.
- `frontend/tests/checkpoint-form.test.tsx` — **3 tests**.
- `frontend/tests/playlist-manager.test.tsx` — **4 tests**.
- `frontend/tests/account-ui.test.tsx` — **6 tests**.
- `frontend/tests/reports-playlist-actions.test.tsx` — **2 tests**.

### 8.2 Typecheck, lint, build

- Backend typecheck: passed.
- Frontend typecheck: passed.
- Backend lint: 0 errors, 75 `no-explicit-any` warnings; exit 0.
- Frontend lint: 0 errors, 4 pre-existing hook-dependency warnings; exit 0.
- Backend build: passed (`tsc`).
- Frontend build: passed; largest chunk 388.58 kB / gzip 117.44 kB, no >500 kB warning.

### 8.3 Dependency audit

- `npm audit` in backend: **0 vulnerabilities**.
- `npm audit` in frontend: **0 vulnerabilities**.
- Vitest was upgraded from 2.1.9 to **4.1.12** to clear the dev-only Vitest/Vite/tinypool advisories. Both suites passed after the upgrade.
- `npm audit --omit=dev` is also clean in both packages.

### 8.4 Production boot smoke

- Built backend imported and served `/api/health` successfully.
- Response exposed only booleans/names, no secret values.
- Current status: setup required because external credentials are absent; account endpoints remain fail-closed.

---

## 9. Defects found and fixed during verification

Prior LQ findings that were already fixed remain covered by the full frontend
and backend suites; no prior fix was reverted. The continuation pass found the
new defects below.

| Defect | Impact | Fix |
|---|---|---|
| Typed-title mismatch for renamed playlists | Dialog asked for the custom title; local store and backend summary compared the source title, so confirmation could never succeed | Local delete uses `meta.customTitle ?? snapshot.title`; backend `playlistSummary` resolves the custom title; regression test added |
| Reports still exposed old one-click delete/raw archive | Bypassed the two-choice flow, typed confirmation, and managed backend protocol | Reports archive/restore now call managed actions; delete item becomes “Manage removal…” and routes to the dashboard manager; regression test added |
| Auth route UUID literal type inference | Backend typecheck failed on `generic.challengeId` assignment | Explicit `{ challengeId: string }` annotation |
| Conditional `useEffect` in AccountMenu | Lint hook-order error after early return | Hooks now run before the `!user` return |
| Unused imports/assignments and useless catch | Lint errors | Removed; behavior unchanged |
| Dev-only Vitest/Vite advisories | Full audits reported 6 dev vulnerabilities per package | Upgraded Vitest to 4.1.12; audits now clean; suites re-run |
| Focus XP attribution key mismatch | Backend compared prefix-stripped `focus:` keys against a set that still had the prefix; Focus XP could survive permanent deletion | Store and compare the full `focus:<clientId>` key; backend and frontend now use the same format |
| Missing `code:` / `ex:` / `built:` XP attribution | Revision and learning-record XP survived permanent playlist deletion and was undercounted | Added all three prefixes to backend `xpBelongs` and both frontend attribution paths; regression test covers each |
| Checkpoint-linked null-playlist goals omitted from UI counts | Dialog understated records that permanent deletion would remove | Counts and local deletion include goals whose checkpoint belongs to the playlist |
| No rollback on partial collection/full-state writes | A mid-write failure could leave a half-replaced account and still bump the version | Snapshot/restore collection rows, restore every collection on full-state failure, release the version, and test both paths |
| Retry returned `404` after the playlist row was deleted | A failure in the XP/goal tail of deletion could not be resumed | Persist the title and attribution IDs on the deletion job; allow resumable attempts without the playlist document; test a failure after playlist removal |
| Metadata-only import could wipe data | `{version, exportedAt}` was treated as an empty state, replacing the account with defaults | Extract `state`/`data`/raw state and require a recognized learning-data collection before reserving a version; regression test rejects the metadata-only envelope |
| Cross-site Vercel→Render cookie topology | `SameSite=Lax` session cookie is not sent; login appears to succeed then all authenticated requests fail | Deployment guide now requires a same-origin `/api` proxy or same-site custom domains; README/HOW_TO_USE/troubleshooting corrected |
| Revision lifecycle test remounted too early | A debounced write with `needsRevision: true` could satisfy the wait, causing a timing-only failure under load | Wait for `needsRevision: false` in the persisted record; raise Testing Library's async utility timeout to 5s |

---

## 10. Security review summary

Verified locally by inspection and tests:

- No client-supplied `userId` is trusted for data ownership.
- No auth/account endpoint falls back to local-only state.
- No fake auth bypass or predictable OTP path exists.
- OTP codes and session tokens are not stored in plaintext.
- CSRF-less mutations are rejected; untrusted origins are rejected; CORS is exact.
- Production cookies use `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- The session cookie is first-party only; deployment requires a same-origin
  `/api` proxy or same-site custom domains.
- Sessions rotate and revoke on security-sensitive changes.
- Stale versions cannot overwrite newer data.
- Account exports omit secrets and password hashes.
- Import rejects metadata-only envelopes and never turns a missing state into
  an empty account.
- Account and playlist deletion are scoped to the authenticated user.
- Delete success is never returned on a partial failure.
- Archive preserves all records and restore does not duplicate XP.
- Full-state and per-collection write failures restore prior rows and release
  the reserved version.

Not verified in this environment:

- Live TLS/cookie behavior at Render/Vercel.
- Real Google token signatures/JWKS availability.
- Real Brevo delivery, sender verification, bounce handling, or spam placement.
- Real MongoDB connectivity, Atlas network rules, backups, or failover.
- Browser visual layout, screen readers, mobile devices, or real-browser CSP behavior.

---

## 11. Account and removal user experience

- Sign-in/registration/recovery screens explain what is configured and what is missing.
- Account menu is consistently top-right; no account navigation was added to the sidebar.
- Session list distinguishes “This device” and shows last-seen/expiry.
- Password change states that other sessions were revoked.
- Email change keeps the old address until the new one is verified.
- Account deletion requires exact username + password (when set) + recent auth.
- Playlist manager shows counts for videos, completed items, annotations, Focus sessions, playback segments, play sessions, checkpoints, ranges, modules, scoped goals, and attributable XP before removal.
- Archive and delete are visually distinct; delete requires exact title typing and is marked destructive.
- Reports no longer provides a shortcut that bypasses these safeguards.

---

## 12. External verification status and remaining limitations

### Not performed / not possible here

| Item | Status |
|---|---|
| Real MongoDB connection and indexes | **Not verified live** — no credentials |
| Real Google OAuth consent, redirect, JWKS | **Not verified live** — mocked only |
| Real Brevo OTP delivery | **Not verified live** — fake email service |
| Render deployment and `NODE_VERSION` | **Not verified live** — no dashboard access |
| Vercel production build with API URL | **Not verified live** |
| Real browser E2E, mobile, screen reader | **Not performed** — jsdom/Testing Library only |
| Node 24.22.1 runtime | **Not executed** — local is 24.11.0; pin/engines documented |
| YouTube API key validity | **Not tested** — key presence only |
| Render/Vercel cookie/CORS handshake | **Not verified live** |
| Cookie-safe topology (proxy or same-site domains) | **Documented and required; not deployed** — owner must choose and configure it |
| Live account migration | **Not performed** — fake IndexedDB and in-memory DB only |

These are external or environment limitations, not hidden test failures. No live success is claimed.

---

## 13. Required owner actions

1. Fill `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, and `BREVO_SENDER_EMAIL` in `backend/.env` (or Render).
2. Choose the cookie-safe topology in `docs/DEPLOYMENT_MULTIUSER.md` §6:
   - same-origin Vercel `/api` rewrite (leave `VITE_API_BASE_URL` empty), or
   - same-site custom domains (`app.example.com` + `api.example.com`, with
     `VITE_API_BASE_URL=https://api.example.com`).
   Do not point `*.vercel.app` directly at `*.onrender.com`.
3. Register the exact public Google redirect URI for that topology:
   local `http://localhost:3001/api/auth/google/callback`; production
   `https://YOUR-APP-DOMAIN/api/auth/google/callback` (proxy) or
   `https://api.YOUR-DOMAIN/api/auth/google/callback` (custom domains).
4. Verify the Brevo sender/domain and test a real OTP delivery.
5. Allow Render egress in MongoDB Atlas network access.
6. On Render, set `APP_ORIGIN`, `CORS_ORIGIN`, `API_ORIGIN`,
   `GOOGLE_REDIRECT_URI`, and confirm `NODE_VERSION=24.22.1` is not overridden
   by an older dashboard value. For the proxy layout, check client-IP behavior
   and adjust `TRUST_PROXY_HOPS` only to the real trusted-proxy count.
7. On Vercel Production, configure the matching frontend/API connection and
   redeploy.
8. Run the post-deploy checklist in `docs/DEPLOYMENT_MULTIUSER.md` §9,
   including two-account isolation, Google registration, password login, OTP
   recovery, archive/restore, typed deletion, account export/restore, and a
   first-party cookie check.

---

## 14. Verdict

**Implementation: LOCALLY COMPLETE AND VERIFIED.**

**Production readiness: EXTERNAL CONFIGURATION REQUIRED.**

All local code gates pass with zero dependency vulnerabilities, the new security and removal protocols are covered by regression tests, and documentation reflects the new architecture. Production deployment additionally requires choosing either a same-origin `/api` proxy or same-site custom domains; the previous cross-site Vercel→Render recommendation is explicitly rejected because it cannot carry the `SameSite=Lax` session cookie. Live Google, Brevo, MongoDB, Render, Vercel, browser, and patched-Node verification remain owner-side actions because the required external credentials and environments are not available in this workspace.

---

## 15. Files changed and dependency updates

### Backend

- New: `src/auth/*`, `src/db/*`, `src/email/*`, `src/routes/account.ts`,
  `src/routes/auth.ts`, `src/routes/playlists.ts`, `src/services/userData.ts`,
  `src/store.ts`, `tests/multiuser.test.ts`, `.node-version`.
- Modified: `src/app.ts`, `src/config/env.ts`,
  `src/controllers/playlistController.ts`, `src/middleware/errors.ts`,
  `src/server.ts`, `package.json`, `package-lock.json`, `.env.example`.
- Dependencies added: `@node-rs/argon2`, `jose`, `mongodb`, `zod`.
- Test tooling upgraded: Vitest `2.1.9` → `4.1.12`.

### Frontend

- New: `src/app/...` account/auth integration paths,
  `src/features/account/*`, `src/features/auth/*`,
  `src/features/dashboard/PlaylistManager.tsx`, `src/domain/checkpoints/*`,
  `src/services/api/authApi.ts`, `src/services/api/http.ts`,
  and the account/checkpoint/manager/Reports regression tests.
- Modified: `src/app/App.tsx`, `src/app/store.tsx`, `src/app/tabs.ts`,
  `src/domain/index.ts`, `src/features/checkpoints/Checkpoints.tsx`,
  `src/features/dashboard/Dashboard.tsx`, `src/features/reports/Reports.tsx`,
  `src/services/api/playlistApi.ts`, `src/test-setup.ts`, `vite.config.ts`,
  `tests/revision-lifecycle.test.tsx`, `package.json`, `package-lock.json`,
  `.env.example`.
- Test tooling upgraded: Vitest `2.1.9` → `4.1.12`.

### Documentation and deployment

- Updated: `README.md`, `HOW_TO_USE_LEARNQUEST.md`, `render.yaml`,
  `docs/VERCEL_RENDER_CONNECTIVITY_FIX.md` (superseded-cookie banner),
  `docs/DEPLOYMENT_MULTIUSER.md` (new cookie-safe topology section).
- Added: `docs/audits/LEARNQUEST_MULTIUSER_PLATFORM_REPORT_2026-10-27.md`
  (this report) and `docs/audits/LEARNQUEST_MULTIUSER_PROGRESS_2026-10-27.md`
  (durable progress ledger).

---

## 16. Environment-file changes

- `backend/.env` already existed and remains git-ignored. It contains 29
  documented keys; `SESSION_SECRET` and `OTP_HMAC_SECRET` are present
  (64-character generated values) and were not printed, rotated, or
  overwritten. `YOUTUBE_API_KEY` is present.
- Missing external values: `MONGODB_URI`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.
- `backend/.env.example` documents every runtime variable (29 names) and now
  warns that the public app/API origins must be same-site.
- `frontend/.env.example` now documents the same-origin `/api` proxy and the
  same-site custom-domain option, and warns against a direct Vercel→Render API
  URL.
- No secret value is included in this report or in any tracked file.

---

## 17. Final Git status

- Branch: `main`.
- HEAD: `40af48c6d9023fb73791b0166c22d3fc4102a69d`.
- Working tree: modified tracked files plus the new backend/frontend/docs
  files listed above; all intentionally uncommitted.
- No commit, push, reset, clean, stash, branch switch, or destructive checkout
  was performed.
- `backend/.env` is unchanged by this audit and remains ignored.

---

## 18. Staging and manual acceptance checklist

1. Start the backend with MongoDB/Google/Brevo configured; confirm
   `GET /api/health` reports `authEnabled: true` and no missing core values.
2. Complete Google registration and onboarding in a normal browser profile;
   confirm the session cookie is first-party and survives a reload.
3. Sign out, sign in with username and password, then request a password reset
   and verify a real Brevo OTP; confirm the code is single-use and expires.
4. Create a second account and verify it cannot read, list, update, archive,
   delete, export, or restore the first account's records.
5. Add two playlists, create progress/notes/Focus sessions/checkpoints/goals,
   then archive one; confirm it disappears from the active selector while its
   records remain, and restore it without duplicate entries or XP.
6. Permanently delete the other playlist with the exact displayed title;
   confirm attributable progress, sessions, checkpoints, goals, `code`/`ex`/
   `built`/`focus` XP, and other scoped records are removed while the archived
   playlist and account-wide XP remain.
7. Export the account, restore it through Reports, and confirm the data is
   replaced atomically; try a malformed/metadata-only envelope and confirm it
   is rejected without changing data.
8. Switch accounts in the same browser and confirm no profile, playlist,
   annotation, or statistic from the previous account remains visible.
9. Check responsive layouts and keyboard focus in a real browser; jsdom tests
   do not prove visual or screen-reader behavior.
10. Verify the chosen deployment topology end to end, including the Google
    redirect URI, `Set-Cookie` flags, CORS preflight, and authenticated
    `/api/account/data` after reload.
