# LearnQuest Multi-User — Durable Progress Ledger

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD at audit start:** `40af48c6d9023fb73791b0166c22d3fc4102a69d`  
**Working tree:** Intentionally uncommitted. No commit, push, branch switch, reset,
clean, stash, or destructive checkout was performed.  
**Authoritative requirements:** `learnquest-multimuser-platform-prompt.txt`,
including the mandatory addendum, plus `learnquest-multimuser-continuation.txt`.

> **Superseded 2026-10-27:** This is a historical progress ledger. Its numeric
> OTP references describe the implementation at that time, not current
> behavior. Current recovery and email verification use single-use email
> action links; see
> [`LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md`](./LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md).

---

## 1. Status

| Area | Status | Evidence |
|---|---|---|
| MongoDB-backed account data | **Implemented locally** | Mongo adapter, in-memory adapter, 54 backend tests |
| Google-only registration / OIDC | **Implemented, mocked only** | PKCE/state/nonce/JWKS code; no live Google credentials |
| Password onboarding, login, change | **Implemented locally** | Argon2id, sessions, tests |
| Password recovery and email change | **Implemented, mocked only** | OTP + Brevo service; fake email tests |
| Account UI (profile/preferences/security/export/delete) | **Implemented locally** | `Account.tsx`, `AccountMenu.tsx`, account UI tests |
| Legacy local-data migration | **Implemented locally** | Idempotent migration route and deterministic merge tests |
| Archive vs permanent playlist removal | **Implemented locally** | Managed flow, typed title, retry protocol, UI + backend tests |
| Checkpoint single-range redesign | **Implemented locally** | Parser/form tests and domain tests |
| Runtime / env hardening | **Implemented locally** | Fail-closed production config, `.env.example`, Node pin |
| Cookie-safe production topology | **Documented; owner choice required** | `docs/DEPLOYMENT_MULTIUSER.md` §6; no live Vercel/Render |
| Live MongoDB/Google/Brevo/Render/Vercel verification | **Not possible here** | Required external credentials/access absent |

**Verdict:** locally complete for the code and test scope; production readiness
still requires owner-supplied external configuration and a live deployment
check. No live integration success is claimed.

---

## 2. Spec coverage matrix

| # | Requirement (abbreviated) | Implementation | Verification |
|---|---|---|---|
| 1 | Authenticated accounts; Google-only registration | `backend/src/auth/*`, `routes/auth.ts` | Backend registration/onboarding/session tests (mocked OIDC) |
| 2 | Stable Google `sub` identity; no email auto-link | `auth/google.ts`, `accounts.ts` | Link-required regression test |
| 3 | Username/email + password sign-in | `auth/accounts.ts`, login route | Password login and generic-failure tests |
| 4 | Argon2id password storage | `@node-rs/argon2` | Hash-prefix and no-plaintext assertions |
| 5 | Server-side sessions, rotation, revocation, CSRF | `auth/sessions.ts`, `auth/middleware.ts` | Rotation, logout, CSRF-less rejection, origin tests |
| 6 | Brevo OTP recovery/email change | `auth/otp.ts`, `email/brevo.ts` | OTP reuse/expiry/attempt tests; delivery mocked |
| 7 | Account profile, preferences, security UI | `features/account/*` | Account UI tests |
| 8 | Account export without secrets | `/api/account/export` | Export envelope test; no `passwordHash` |
| 9 | Account deletion with recent auth | `/api/account/delete` | Wrong-name and successful deletion tests |
| 10 | MongoDB persistence for every user collection | `store.ts`, `services/userData.ts` | In-memory adapter exercises the shared repository |
| 11 | Ownership on every read/write/delete | `userId`-scoped queries | Two-user isolation test including archive/delete |
| 12 | Optimistic version/conflict handling | `stateVersions`, `reserveVersion` | Version-conflict and write tests |
| 13 | Legacy local migration with backup/conflict rules | `/api/account/migrate`, migration UI | Idempotent migration + merge tests |
| 14 | Archive preserves records; restore no duplicate XP | `archivePlaylist`, manager UI | Archive/restore tests |
| 15 | Permanent delete is explicit and complete | `deletePlaylistPermanently` | Custom-title, cascade, fallback, retry tests |
| 16 | Delete success never reported before completion | Deletion job + `DELETE_INCOMPLETE` | Simulated failure and resume tests |
| 17 | Checkpoint one-range creation redesign | `domain/checkpoints/*`, `Checkpoints.tsx` | Parser and UI tests |
| 18 | Runtime/configuration fail-closed | `config/env.ts`, `server.ts` | Production startup refusal tests |
| 19 | Node deployment hardening | `.node-version`, `engines`, `render.yaml` | Pin present; current local Node is older |
| 20 | Documentation | README, HOW_TO_USE, deployment guide, reports | Revised in this continuation |

---

## 3. Continuation defects found and fixed

1. **Focus XP attribution mismatch.** Deletion jobs persisted
   `focus:<clientId>` keys but compared the prefix-stripped key against that
   set. Focus XP could survive permanent deletion. The comparison now uses the
   full persisted key on both backend and frontend paths.
2. **Missing XP prefixes.** `code:`, `ex:`, and `built:` XP were not attributed
   to their playlist in either the backend deletion service or the frontend
   manager/local-delete path. They are now included.
3. **Checkpoint-linked null-playlist goals.** Goals whose `playlistId` is null
   but whose `checkpointId` belongs to the removed playlist were omitted from
   UI counts. Backend deletion was already intended to remove them; counts and
   local deletion now agree.
4. **Partial-write rollback.** Collection and full-state replacements now
   snapshot previous rows, restore them on a mid-write failure, and release the
   reserved version. A failed import can no longer leave a half-replaced
   account.
5. **Retry after the playlist document was deleted.** The deletion route
   required the playlist summary before every attempt, so a failure after the
   playlist row was removed made retries return `404`. The deletion job now
   persists the displayed title and attribution IDs, accepts the original
   tab's pre-reservation version while the job is resumable, and can finish
   without the playlist document.
6. **Metadata-only restore could wipe data.** Import previously treated any
   object without a `state` property as a full state, so `{version, exportedAt}`
   validated as an empty account and could replace real data with defaults. The
   route now extracts `state`/`data` or a raw state and rejects envelopes with
   no recognized learning-data collections before reserving a version.
7. **Cross-site cookie topology documentation was wrong.** `__Host-lq_session`
   uses `SameSite=Lax`; a `*.vercel.app` frontend calling `*.onrender.com`
   directly will not send the cookie on API fetches. Deployment docs now
   require a same-origin Vercel `/api` proxy or same-site custom domains.
8. **Local-only wording in cloud error states.** The app error boundary and
   load states no longer claim the data is local/IndexedDB-only when the cloud
   store is active.
9. **Flaky revision lifecycle test.** The test remounted after waiting for an
   IndexedDB write that could still contain `needsRevision: true`. The wait now
   includes `needsRevision: false`, so the remount observes the settled state.

---

## 4. External credentials still required

These names are documented; no values are printed or fabricated.

- `MONGODB_URI` (plus `MONGODB_DB_NAME`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL` (must be verified in Brevo)

`SESSION_SECRET`, `OTP_HMAC_SECRET`, and `YOUTUBE_API_KEY` are present in the
local ignored `.env`; their live validity was not tested. Rotating either
secret signs out sessions and invalidates pending OTP/reset challenges.

---

## 5. Risks / open decisions

| Risk | Impact | Required action |
|---|---|---|
| Vercel/Render cookie topology not chosen | Login appears to work, then authenticated requests return 401 | Use same-origin `/api` proxy or same-site custom domains (deployment guide §6) |
| Google redirect URI not registered for the chosen public origin | OAuth callback fails | Register the exact public `/api/auth/google/callback` URI |
| Live MongoDB/Google/Brevo never exercised | Integration bugs can remain despite local tests | Fill credentials and run the post-deploy checklist |
| Local Node `v24.11.0` vs pinned `24.22.1` | Tests/builds ran on an older runtime | Deploy with `24.22.1`; run a smoke test there |
| Same-origin proxy adds an edge hop | Rate-limit identity may collapse under `TRUST_PROXY_HOPS=1` | Check client IP behavior; raise trusted hops only if the proxy chain requires it |
| Full frontend suite is timing-sensitive under heavy CPU load | Occasional unrelated UI test flake | Run suites without competing builds; the repo uses 10s test/hook timeouts |
| No real-browser E2E | Accessibility/mobile/cookie behavior unverified | Owner-side browser verification after deploy |

---

## 6. Verification log

Run from the repository root unless noted.

| Command | Result |
|---|---|
| `backend`: `npm test -- --run` | **54 / 54 passed** (7 files) after continuation changes |
| `backend`: `npm run typecheck` | Passed |
| `backend`: `npm run lint` | 0 errors, 75 `no-explicit-any` warnings |
| `backend`: `npm run build` | Passed |
| `frontend`: `npm run typecheck` | Passed |
| `frontend`: `npm test -- --run` | **272 / 272 passed** (34 files); final rerun after the last source edit |
| `frontend`: `npm run lint` | 0 errors, 4 hook-dependency warnings |
| `frontend`: `npm run build` | Passed; largest chunk 388.58 kB (gzip 117.44 kB) |
| Both: `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities in each package |
| Env-name check | All 29 names used by `src/config/env.ts` are present in `.env.example` |

Tests use the in-memory database adapter, mocked Google OIDC, and a fake email
service. They do **not** prove live MongoDB, Google, Brevo, Render, Vercel, or
real-browser behavior.

---

## 7. Next task

1. Owner supplies the five missing external values and chooses the cookie-safe
   topology.
2. Register the exact Google callback and verify the Brevo sender.
3. Deploy backend on Render with Node `24.22.1`; deploy frontend on Vercel with
   the matching API connection.
4. Run the post-deploy checklist: Google registration, password login, OTP
   recovery, two-account isolation, archive/restore, typed permanent deletion,
   account export/restore, and a real-browser cookie inspection.
5. Record live results in a new dated report; do not mark live integrations
   complete from mocked tests.
