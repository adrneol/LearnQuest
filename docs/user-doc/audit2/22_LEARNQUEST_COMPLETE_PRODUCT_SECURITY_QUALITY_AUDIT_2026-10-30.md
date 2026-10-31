# LearnQuest — Complete Product, Security, Authentication, Simulation, and Quality Audit

**Report:** 22  
**Audit date:** 2026-10-30  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main` at `3107d11c151a2fd86dddd7630255998026dcd6a7` (`Fix production API routing and CSP connectivity`)  
**Mode:** Read-only investigation and design. No application, test, dependency, environment, database, deployment, or production change was made.  
**Archive index:** [README.md](./README.md)

> **Report-only compliance:** This audit created this report and updated the archive index. It did not modify application source, tests, package manifests, lockfiles, environment files, database records, live sessions, deployments, or production settings. It did not commit, push, deploy, migrate, send email, reset a password, revoke a live session, or delete data.

## Scope and evidence conventions

This report covers the complete current working tree, with emphasis on the user-reported logout synchronization problem, Arena ranking simulation, Focus reliability, Efficiency mathematics, user-facing microcopy, and Legacy-versus-Unified storage safety. Reports 13–21 were read from Git history and treated as historical context only; every material claim below was rechecked against the current source.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **Confirmed — source** | Directly observed in the current source or configuration. |
| **Confirmed — test** | Covered by an existing test that was executed during this audit. |
| **Partially confirmed** | Source evidence exists, but a runtime or cross-browser condition was not reproduced. |
| **Potential risk** | Plausible and source-supported, but not demonstrated in a real browser or production environment. |
| **Not found** | A specific check found no evidence of the stated problem. |
| **Not tested** | The required environment, browser, device, or live service was unavailable. |

Test results recorded during this audit: **backend 25 files / 201 tests passed; frontend 42 files / 352 tests passed.** Backend and frontend typechecks and builds passed; lint completed without errors (the backend emitted 86 warnings). The local Node runtime was **v24.11.0**, while both manifests require **>=24.22.1 <25** and `backend/.node-version` pins **24.22.1**; therefore the current local QA run did not exactly match the declared runtime baseline. No dependency installation or upgrade was performed. No live production checks, database writes, or real-browser E2E runs were performed.

Model-effort metadata was not available to this report, so no claim is made about a specific reasoning-effort setting.

---

## Contents

1. Executive summary and overall quality verdict
2. Repository baseline and architecture map
3. Full application feature inventory
4. Authentication and session lifecycle
5. Cookies and leakage assessment
6. Single-browser multi-tab logout defect
7. All-devices logout defect
8. Recommended session/logout architecture
9. Complete Arena mathematical audit
10. New Arena simulation model proposal
11. Arena frontend configuration experience
12. Focus reliability and mathematical assessment
13. Focus improvement blueprint
14. Efficiency formula analysis
15. Recommended efficiency methodology and UX
16. Playlist ingestion and duration integrity
17. Progress/checkpoint/module calculations
18. Goals, XP, achievements, and challenges
19. Analytics and charts
20. Cloud persistence and multi-device data, including Legacy-vs-Unified storage
21. Frontend quality and accessibility, including microcopy audit
22. Backend architecture and quality
23. Security threat model
24. Performance and scalability
25. QA coverage and gaps
26. Complete prioritized improvement backlog
27. P0/P1/P2/P3 implementation roadmap and readiness verdict
28. Regression and acceptance-test matrix
29. Evidence classification and limitations
30. Final Git status and report-only compliance confirmation

### Addendum deliverable crosswalk

| Addendum requirement | Where addressed |
|---|---|
| Recommended formulas and mathematical validation | Sections 9, 10, 12, 13, 14, 15; worked examples throughout |
| User-facing microcopy audit and replacements | Section 21.5 and the microcopy table |
| Deep Legacy-vs-Unified comparison | Sections 20.2–20.6 |
| Storage migration safety verdict | Section 20.7 |
| Proposed target storage architecture | Section 20.8 |
| Prioritized implementation roadmap | Sections 26 and 27 |
| Comprehensive future test matrix | Section 28 |
| Explicit blockers and prerequisites | Sections 20.7, 27.6, and 29 |
| Final readiness verdict | Sections 1 and 27.6 |

---

## 1. Executive summary and overall quality verdict

### 1.1 Bottom line

LearnQuest is a capable, thoughtfully engineered **personal learning tracker** with a materially stronger security and persistence foundation than a typical hobby project. Authentication, cookie handling, CSRF, OAuth browser binding, password-reset safety, account-deletion fencing, optimistic concurrency, and migration verification all show deliberate design and meaningful test coverage.

It is **not yet a trustworthy competitive ranking product**, and its “Efficiency” number is a **content-throughput ratio**, not a measure of learning quality. The current Arena model is mathematically exploitable and can produce ranks that contradict real learning effort. The Focus system has good recovery instincts but still treats visible wall-clock time as focused time and has no clock-jump, sleep-gap, or cross-tab protection. The Unified storage layout is technically sound and the migration tooling is careful, but a production cutover is **not safe today** because the migration is snapshot-based, has no reverse migration, and requires a write freeze or change-capture mechanism that does not exist.

The reported **single-browser multi-tab logout defect is fixed in the current source**: the current tab revokes the server session, clears local state, and broadcasts a token-free notification to other same-origin tabs, with a storage-event fallback and late-response invalidation. The reported **all-devices visual logout defect still exists on remote devices**: the server revokes every session immediately, but an idle remote tab can continue showing already-loaded private data until it makes another request, is manually refreshed, or is revalidated by a mechanism that does not currently exist.

### 1.2 Quality scorecard

Scores are comparative judgments for this audit, not measurements.

| Area | Score | Verdict |
|---|---:|---|
| Authentication and session security | 8.0 / 10 | Strong controls; remote-tab visual staleness and cross-account tab identity are the main gaps. |
| Cookie and token handling | 8.5 / 10 | `__Host-`/HttpOnly/Secure/SameSite=Lax in production; no confirmed token leak in source. |
| Data integrity and persistence | 7.0 / 10 | Optimistic versioning, transactions, and deletion fencing are strong; whole-collection rewrites and client-authoritative learning data limit trust at scale. |
| Focus timing correctness | 5.0 / 10 | Pauses and recovery are handled well; clock jumps, sleep, idle time, and multi-tab overlap are not. |
| Efficiency mathematics | 6.5 / 10 | The ratio is valid and aggregate aggregation is correct, but the name overstates what it measures and inputs can be inflated. |
| Arena ranking | 3.0 / 10 | Deterministic and clearly labeled fictional, but equal-weight daily efficiency with a 3-day minimum is exploitable and not a defensible competition model. |
| Frontend UX and accessibility | 7.0 / 10 | Consistent shell and components; some developer-facing copy and stale cloud-mode privacy text; accessibility coverage is partial. |
| Backend architecture | 7.5 / 10 | Clear route/service/store separation and good fail-closed behavior; no server-side scoring or domain engine. |
| QA maturity | 6.0 / 10 | Good unit/component/integration coverage; no real-browser E2E, load, or automated accessibility suite; cross-device revocation untested. |
| Storage cutover readiness | 3.5 / 10 | Unified design is viable; migration and rollback are not production-ready without a freeze and reverse path. |
| Overall release posture | **Conditional** | Safe for continued personal/cloud use; not ready for official competitive claims or a storage-mode cutover. |

### 1.3 Most important findings

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| F-01 | Arena can rank a user highly from three one-minute, 100%-efficiency days. The score is the unweighted mean of eligible daily percentages, with no minimum volume. | Critical (rank credibility) | Confirmed — source `competition.ts:175–178`, `370–373`; no volume gate in `eligibleDailyEfficiencies` |
| F-02 | A remote device that has already loaded the app keeps showing private account UI after “sign out all devices”; server authorization is revoked but no heartbeat, push, or visibility revalidation exists. | High (privacy) | Partially confirmed — source `sessions.ts:151–159`, `store.tsx:1224–1234`; live device not tested |
| F-03 | Two tabs signed into different accounts share one rotating cookie. The older tab retains its old user/CSRF state and can issue account reads under the new session; a manual cloud reload can display the new account’s data in the old tab. | High (cross-account privacy) | Partially confirmed — shared cookie + no identity assertion in `/account/data`; runtime not reproduced |
| F-04 | Focus counts visible wall-clock time; a clock jump forward, device sleep without a visibility event, or two open tabs can inflate or double-count focused time. | High (data correctness) | Confirmed — source `focus.ts:103–137`, `Focus.tsx:95–153`; runtime sleep/clock tests absent |
| F-05 | Unified cutover is snapshot-based. Writes made to legacy after the final verification are not copied; switching to Unified makes them invisible, and there is no reverse migration. | Critical (data safety) | Confirmed — source `userDataMigration.ts:710–800`; no dual-write/fallback |
| F-06 | Every cloud save rewrites the entire changed collection (delete + insert). Segments can reach 200,000 rows, far beyond the 8 MB request-body cap, so large histories cannot be saved reliably. | High (scale/reliability) | Confirmed — source `userData.ts:499–550`, `store.tsx:977–1026`, `env.ts:297–299`; no load test |
| F-07 | Arena competitor totals fall back to `n × average resolved duration` when the playlist has unresolved durations, while the user is scored from actual coverage. | High (fairness) | Confirmed — source `competition.ts:234`, `Competition.tsx:93–102` |
| F-08 | Analytics “content” is the sum of all playback segment lengths, including rewatches, but an insight calls it “unique content coverage.” | Medium (misleading analytics) | Confirmed — source `Analytics.tsx:44–50`, `insights.ts:33–34` |
| F-09 | Settings says learning records live in this browser’s IndexedDB even in cloud mode, where that is false. | Medium (factual/privacy copy) | Confirmed — source `Settings.tsx:90–97`; mode is not consulted |
| F-10 | The loading screen exposes internal storage architecture with a sentence users do not need. | Low (microcopy) | Confirmed — source `store.tsx:1856–1857` |
| F-11 | Learning calculations (progress, XP, efficiency, Arena) are client-authored; the server validates shape but does not recompute results. | Medium (integrity) | Confirmed — source `userData.ts:249–266`, no server domain engine |
| F-12 | There is no real-browser E2E, load, or automated accessibility suite; cross-device revocation and real sleep/clock behavior are untested. | Medium (QA) | Confirmed — test inventory |

### 1.4 What currently works well

- Production cookies are `__Host-lq_session` and `__Host-lq_oauth`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, with both Max-Age and Expires. The session token is never placed in JavaScript-accessible storage.
- Session tokens are 32 random bytes; only an HMAC-SHA-256 digest is stored. CSRF tokens are separate random values and are held in memory. Session validation checks revocation, idle expiry, absolute expiry, account status, and password version on protected requests.
- Google registration and login are distinct intents; OAuth flows are bound to a short-lived HttpOnly browser cookie; an existing account is not silently signed in through the registration route.
- Password reset links are purpose-bound, single-use, expiring, HMAC-digested, and atomically consumed. Password reset and verified email change revoke all sessions. Password change excludes the current session, then rotates it.
- Account deletion is a resumable, fenced saga with writer draining, explicit phrase and recent-auth checks, scoped collection deletion, and zero-residue verification.
- Account data uses optimistic versioning and per-collection transactions; a version conflict is surfaced rather than silently overwriting another device.
- The Legacy/Unified repository abstraction prevents callers from bypassing the selected backend; migration is dry-run-first, checksum-verified, conflict-blocking, idempotent, and account-safe.
- Same-browser sign-out synchronization is implemented and covered by tests, including a storage fallback and late-response invalidation.
- Playlist duration handling distinguishes “unknown” from zero, withholds incomplete totals, and tracks stable occurrence identity rather than position alone.
- Arena is clearly labeled fictional, deterministic for the same inputs, and separates simulated opponents from real people.

### 1.5 What must not be claimed

- Do not claim that “efficiency” measures comprehension, retention, intelligence, or learning quality. It is a ratio of unique content timeline seconds to focused timer seconds.
- Do not claim that all-devices logout is visually immediate on remote devices. It is authoritative at the server, but not pushed to idle clients.
- Do not claim that the Arena rank is fair or meaningful in its current form. It is a fictional motivational simulation with an exploitable score.
- Do not claim that Unified is production-ready because tests pass. The cutover and rollback path are incomplete.
- Do not claim that passing local builds proves production behavior. No live deployment verification was performed in this audit, and Report 21 recorded stale deployments as a historical concern.

### 1.6 Readiness verdict summary

| Question | Verdict |
|---|---|
| Can implementation of approved fixes begin? | **Yes, for P0/P1 hardening and P2 microcopy/UX work**, with the gates in Section 27.6. |
| Can Arena be presented as a fair ranking today? | **No.** Redesign and versioning are required first. |
| Can Focus be presented as measuring concentration? | **No.** It measures timer-active time with partial interruption handling. |
| Can Unified be used for a production cutover now? | **No.** Use Legacy; at most run a controlled, isolated staging migration after the gates in Section 20.7. |
| Is the single-browser logout report still reproducible in current source? | **Not in the ordinary sign-out path.** If it reproduces in production, the deployed build is likely stale or a non-broadcasting failure path was taken. |
| Is all-devices logout fixed? | **Server-side yes; remote visual propagation no.** |

---

## 2. Repository baseline and architecture map

### 2.1 Git baseline

At the start of this audit:

- Branch: `main`, tracking `origin/main`, **0 ahead / 0 behind**.
- HEAD: `3107d11c151a2fd86dddd7630255998026dcd6a7` — `Fix production API routing and CSP connectivity`.
- Working tree: **18 pre-existing tracked deletions** and **one pre-existing untracked prompt file**:
  - Deleted prompt files: nine `LEARNQUEST_*_2026-10-28.txt` files.
  - Deleted reports: `13_...` through `21_...` in `docs/user-doc/audit2/`.
  - Untracked: `LEARNQUEST_COMPLETE_PRODUCT_SECURITY_QUALITY_AUDIT_PROMPT_2026-10-30.txt`.
- No application source, test, dependency, environment, or configuration file was modified at baseline.
- The archive index was the only file present in `docs/user-doc/audit2/` in the working tree.

The deletions and the untracked prompt predate this audit and were **not caused, reverted, or altered** by it. Reports 13–21 were read with `git show HEAD:<path>` because they are absent from the working tree. The current report does not restore them, because only Report 22 and the archive index may be written.

### 2.2 Runtime and dependency baseline

| Item | Observed |
|---|---|
| Frontend | React 18, Vite 6, TypeScript 5.6, Tailwind 4, Recharts 2, `idb` 8, Vitest 4 |
| Backend | Node 24 LTS target, Express 4, MongoDB driver 7, Zod 4, `@node-rs/argon2`, `jose`, `helmet`, `cors` |
| Frontend package | `learnquest-frontend` 0.2.0; `engines.node >=24.22.1 <25` |
| Backend package | `learnquest-backend` 0.3.0; `engines.node >=24.22.1 <25` |
| Node pin | `backend/.node-version` = `24.22.1` |
| Local Node during audit | `v24.11.0` |
| Local test result | Backend 25 files / 201 tests; frontend 42 files / 352 tests; all passed |
| Typecheck/build | Passed for both apps |
| Lint | No errors; backend reported 86 warnings |
| Dependency installation | None |

The local Node patch is below the declared minimum. The source and deployment manifests still pin the intended baseline, and prior reports recorded 24.22.1 verification, but this audit’s local run is not a substitute for a clean 24.22.1 run.

### 2.3 Current architecture

```text
Browser (React/Vite, same origin)
  ├─ App shell / hash navigation / lazy route chunks
  ├─ StoreProvider
  │    ├─ cloud mode (production default)
  │    │    ├─ GET  /api/auth/session         session + CSRF + public config
  │    │    ├─ GET  /api/account/data         all 20 learning domains + version
  │    │    ├─ PUT  /api/account/data/:name   replace one collection, optimistic version
  │    │    ├─ POST /api/account/import       replace all domains atomically
  │    │    └─ POST /api/account/migrate      idempotent local-data merge
  │    └─ local mode (tests/development)
  │         └─ IndexedDB via `idb`, debounced whole-state writes
  ├─ Domain engine (progress, focus, efficiency, Arena, time, playback)
  ├─ Focus recovery snapshot (localStorage, account-unscoped)
  └─ Same-origin auth-sync signal (BroadcastChannel + storage fallback)

Vercel static host + `/api/*` rewrite
  └─ Render Express service
       ├─ helmet/CORS/trusted-origin/global rate limit
       ├─ auth routes: login, Google OAuth, logout, logout-all, reset, onboarding
       ├─ account routes: data, export, import, migrate, email change, delete, sessions
       ├─ playlist routes: YouTube metadata, cache, management
       ├─ Mongo readiness gate
       └─ MongoDB
            ├─ accounts, sessions, action tokens, OAuth states, deletion jobs
            ├─ lq_state_versions, lq_migrations, rate limits
            ├─ legacy learning data: lq_data_<domain> (20 collections)
            └─ optional unified learning data: lq_user_data
```

Important architectural facts verified in source:

- **Production browser traffic is same-origin.** `getApiBase()` returns an empty string and `apiUrl()` always builds `/api/...`; Vercel rewrites `/api/:path*` to Render. This preserves first-party cookies and the `connect-src 'self'` CSP.
- **The browser owns the learning calculations.** Progress, focus attribution, efficiency, Arena scores, XP, and achievements are computed in `frontend/src/domain`. The backend validates payload shape and limits, persists values, and maintains versions and deletion safety; it does not recompute the domain results.
- **The backend is authoritative for authentication and storage, not for learning semantics.** This is acceptable for a personal tracker but insufficient for an official competitive rank or audited credential.
- **Cloud mode never writes IndexedDB.** The only browser-local durable state in cloud mode is the focus recovery snapshot, the legacy-claim marker, and UI preferences. This is intentional but incomplete for offline recovery.
- **Legacy is the default storage mode.** `LQ_USER_DATA_STORE` is absent from `render.yaml`, so the source default `legacy` applies. `unified` requires an explicit environment value and a cutover acknowledgement; there is no fallback and no dual-write.
- **The deployment path is Vercel → Render → MongoDB.** `render.yaml` sets `NODE_ENV=production`, two trusted proxy hops, the exact Vercel origin, the Vercel `/api` callback, a 30-day absolute session, a 168-hour idle session, and an 8 MB account-state cap.

### 2.4 Production and development differences

| Concern | Development | Production |
|---|---|---|
| API origin | Vite proxy to `http://localhost:3001` | Vercel rewrite to Render |
| Session cookie | `lq_session` (no `Secure`) | `__Host-lq_session` (`Secure`) |
| OAuth cookie | `lq_oauth` | `__Host-lq_oauth` |
| Storage mode | `.env` default `legacy` unless overridden | `render.yaml` does not set the variable; default `legacy` |
| CSP | Vite dev server (no production CSP) | Vercel static CSP plus backend Helmet API CSP |
| Node | Local shell v24.11.0 during audit | Manifest and `.node-version` target 24.22.1 |

No live production state was inspected. Report 21’s historical note that Render/Vercel deployments were stale remains an owner-verification item, not a claim made by this audit.

---

## 3. Full application feature inventory

| # | Feature | Primary implementation | Data authority | Persistence | Audit section |
|---:|---|---|---|---|---|
| 1 | Account registration, Google onboarding, password login | `routes/auth.ts`, `AuthScreens.tsx`, `authApi.ts` | Server | Accounts, sessions | 4 |
| 2 | Password recovery and email verification | `actionTokens.ts`, `auth.ts`, `AuthScreens.tsx` | Server | `lq_action_tokens` | 4, 23 |
| 3 | Session listing, single-session revoke, all-devices logout | `sessions.ts`, `account.ts`, `Account.tsx` | Server | `lq_sessions` | 4, 6, 7 |
| 4 | Profile, timezone, session preferences | `account.ts`, `Account.tsx` | Server + client defaults | `lq_accounts`, `prefs` | 4, 20 |
| 5 | Account export, import, deletion | `account.ts`, `accountDeletion.ts`, `backup.ts` | Server | All learning/operational collections | 20, 23 |
| 6 | Playlist URL/ID resolution and YouTube import | `routes/playlist.ts`, `youtubeService.ts`, `playlistId.ts` | Server metadata; client math | `playlists`, `meta` | 16 |
| 7 | Player, verified coverage, manual playback evidence | `Player.tsx`, `playback.ts`, `segments` | Client | `segments`, `playSessions`, `progress` | 17 |
| 8 | Manual and verified video completion | `identity.ts`, `Player.tsx`, `store.tsx` | Client | `progress` | 17 |
| 9 | Modules, checkpoints, saved ranges | `Modules.tsx`, `Checkpoints.tsx`, domain modules | Client | `modules`, `checkpoints`, `ranges` | 17 |
| 10 | Revision workflow and learning records | `Revision.tsx`, `LearningRecordEditor.tsx` | Client | `progress` notes, revision fields | 17, 18 |
| 11 | Focus timer, pauses, recovery, manual correction | `focus.ts`, `Focus.tsx` | Client | `sessions`, local recovery snapshot | 12, 13 |
| 12 | Daily goals and flexible goals | `Goals.tsx`, domain goals | Client | `goals`, `flexGoals` | 18 |
| 13 | XP, achievements, streaks | `gamification.ts`, `store.tsx` | Client | `xp`, `achievements` | 18 |
| 14 | Efficiency screen and daily trend | `efficiency.ts`, `Efficiency.tsx` | Client | Derived from `segments`, `sessions` | 14, 15 |
| 15 | Arena simulation and fictional ranking | `competition.ts`, `Competition.tsx` | Client | `challenge`, `challengeEnabled`, `rankHistory` | 9, 10, 11 |
| 16 | Analytics, charts, rule-based insights | `Analytics.tsx`, `insights.ts` | Client | Derived from timeline/focus data | 19 |
| 17 | History and learning-record inspection | `History.tsx` | Client | Existing evidence collections | 17, 19 |
| 18 | Reports, backup validation, export/CSV | `Reports.tsx`, `backup.ts` | Client + server import | Backup files, all domains | 20 |
| 19 | Settings, theme/motion, privacy copy | `Settings.tsx` | Client/account | `prefs`, `settings` | 21 |
| 20 | Legacy local-data migration and cleanup | `LegacyMigrationCard.tsx`, `store.tsx` | Client + server merge | `lq_migrations`, IndexedDB source | 20 |

### 3.1 Calculation ownership map

| Calculation | Where computed | Server recomputation | Cross-device consistency |
|---|---|---|---|
| Playlist totals and completion percentages | Frontend domain | No | Same inputs and code version; client state must sync |
| Unique watched coverage | Frontend `mergeIntervals` | No | Segment IDs and stored timeline intervals; duplicates possible from multiple clients |
| Focus active/elapsed/paused time | Frontend timer | No cross-field check | Stored as client-authored values |
| Daily focus attribution and DST splitting | Frontend time domain | No | Recomputed from stored intervals/timezone |
| Content efficiency and utilization | Frontend efficiency domain | No | Derived from stored segments/sessions |
| Arena daily eligibility and score | Frontend competition domain | No | Derived client-side; no official server snapshot |
| XP and achievement awards | Frontend store | No | Stored as client-authored events |
| Account state version | Backend | Yes | Authoritative compare-and-set |
| Session validity/revocation | Backend | Yes | Authoritative across processes via MongoDB |

This split is the single most important architectural boundary in the product. It keeps the domain engine testable and private, but it means there is no trusted source for an “official” Arena rank or a tamper-resistant XP ledger.

---

## 4. Authentication and session lifecycle

### 4.1 Lifecycle in the current source

1. A password login verifies the account and Argon2id hash, then rotates any old cookie session and creates a new server session.
2. Google login/registration completes the OAuth code flow, validates the state and browser-binding digest, and creates or resumes an account. Registration remains a distinct intent.
3. A session record contains an opaque `sessionId`, an HMAC-SHA-256 `tokenHash`, a random CSRF token, auth method, password version, creation/last-seen/idle/absolute timestamps, revocation timestamp, reauthentication timestamp, truncated user agent, and hashed IP.
4. The browser receives only the opaque token in an HttpOnly cookie. CSRF is returned in the session/login JSON and held in a module variable, not in persistent browser storage.
5. `requireAuth` looks up the token hash, rejects revoked/expired sessions, checks the account is active, compares the session password version to the account password version, touches the idle expiry, and attaches the auth context.
6. Mutating account routes require CSRF. Security-sensitive changes require recent authentication.
7. Logout revokes the current token and clears the cookie. Logout-all revokes every active session for the account, including the current one.
8. Password change revokes all other sessions and rotates the current one. Password reset and verified email change revoke all sessions. Account deletion revokes all sessions through the deletion saga.
9. On page load, the frontend calls `/api/auth/session` once; it does not poll. A 401 with a session-expiry code dispatches `lq:auth-expired`, which clears all account state.

### 4.2 Session policy details

| Control | Value / behavior | Source |
|---|---|---|
| Token entropy | 32 random bytes, base64url | `auth/crypto.ts:6–8`, `sessions.ts:65` |
| Stored token representation | HMAC-SHA-256 digest using `SESSION_SECRET` | `auth/crypto.ts:61–64` |
| CSRF token | 24 random bytes, separate per session | `auth/crypto.ts:66–68` |
| Idle timeout | `SESSION_IDLE_HOURS`, default 168 h (7 days) | `config/env.ts:272–274` |
| Absolute timeout | `SESSION_ABSOLUTE_DAYS`, default 30 days | `config/env.ts:275–277` |
| Idle refresh | `touchSession` on every authenticated request, capped by absolute expiry | `sessions.ts:113–120` |
| Revocation | `revokedAt` set; query filters `revokedAt: null` | `sessions.ts:100–110`, `134–159` |
| Password-version check | Session version must equal account version | `middleware.ts:80–88` |
| Recent-auth window | `REAUTH_WINDOW_MIN`, default 10 min | `config/env.ts:278–280`, `sessions.ts:184–186` |
| Session listing | Max 50 active sessions, newest seen first | `sessions.ts:161–175` |
| Logout-all | Every active session, including current | `routes/auth.ts:392–400` |
| Session status | Validates expiry, account status, password version, onboarding expiry | `routes/auth.ts:150–196` |

### 4.3 Cookie and browser transport

| Attribute | Session cookie | OAuth binding cookie |
|---|---|---|
| Production name | `__Host-lq_session` | `__Host-lq_oauth` |
| Development name | `lq_session` | `lq_oauth` |
| HttpOnly | Yes | Yes |
| Secure | Production only | Production only |
| SameSite | Lax | Lax |
| Path | `/` | `/` |
| Domain | None (host-only) | None (host-only) |
| Max-Age | Session absolute lifetime | 600 s |
| Expires | Explicit; epoch for deletion | Explicit; epoch for deletion |
| Cleared with same attributes | Yes | Yes |

The production cookie name and `__Host-` prefix are mutually consistent: host-only, Secure, Path=/, no Domain. The same-origin Vercel `/api` proxy is required for this topology. The source correctly avoids a cross-origin API URL and `connect-src` exceptions.

### 4.4 Race and revocation behavior

| Scenario | Current behavior | Assessment |
|---|---|---|
| Login while an old cookie exists | Old session revoked, new one created | Good |
| Password reset racing a login | Account password version advances; stale session rejected even if revocation races | Good |
| Concurrent first state version | Unique index; loser re-reads winner | Good |
| Two devices saving | Compare-and-set version; one gets `VERSION_CONFLICT` | Safe but no merge |
| Logout while a write is in flight | Client invalidates generation; server revocation may still allow an already-authorized in-flight request to finish | Inherent small race |
| All-devices logout across Render processes | MongoDB is the shared session store; each process re-reads | Good |
| Password change | All other sessions revoked, current rotated, email actions invalidated | Good |
| Email change | All sessions revoked; user must sign in with new address | Good |
| Account deletion | Account marked `deleting`, fence, writer drain, scoped deletion, verification | Good |

### 4.5 Session findings

| ID | Finding | Severity | Evidence | Classification |
|---|---|---|---|---|
| S-01 | No cross-device revocation push or heartbeat; remote UI remains until a request or reload. | High (privacy) | `sessions.ts`, `store.tsx:1224–1234`; no polling in frontend | Partially confirmed |
| S-02 | A stale tab with an old CSRF token and a newly rotated cookie can read the new account’s data through a manual cloud reload; no userId assertion is returned by `/account/data`. | High (cross-account) | Shared cookie, `loadCloud` accepts state without identity, `authApi.ts:102–142` | Partially confirmed |
| S-03 | Sign-out broadcast happens only after server success; if logout fails, other tabs are not cleared. | Medium | `store.tsx:1218–1222` | Confirmed — source |
| S-04 | A 403 `CSRF_FAILED` does not dispatch `lq:auth-expired`; a tab with a rotated session can show repeated save errors instead of revalidating identity. | Medium | `http.ts:114–125`; CSRF code excluded | Confirmed — source |
| S-05 | No server-side session-idle warning or reauthentication prompt before absolute expiry. | Low | No UI timer found | Confirmed — gap |
| S-06 | `revokeAllSessions` reads active sessions and updates one by one; a very large session history is slower than a single update. | Low (performance) | `sessions.ts:151–159` | Confirmed — source |
| S-07 | Session status does not touch idle expiry; only protected routes do. This is intentional but means a page that only polls status would not extend the session. | Informational | `routes/auth.ts:150–196` | Confirmed — source |
| S-08 | Same-browser sign-out propagation is implemented, tested, token-free, and robust to late responses. | Positive | `authSync.ts`, `cross-tab-auth.test.tsx` | Confirmed — test |

---

## 5. Cookies and leakage assessment

### 5.1 Cookie inventory

| Cookie | Purpose | Sensitive? | JavaScript-readable? | Notes |
|---|---|---|---|---|
| `__Host-lq_session` / `lq_session` | Server session token | Yes | No (HttpOnly) | Opaque 32-byte token; HMAC digest stored server-side |
| `__Host-lq_oauth` / `lq_oauth` | Bind a Google OAuth flow to this browser | Yes, short-lived | No | 10-minute lifetime; state digest stored server-side |

No other application cookie was found. There is no cookie containing a user ID, email, CSRF token, or learning data.

### 5.2 Token and state placement

| Storage location | Content | Risk assessment |
|---|---|---|
| `document.cookie` | Not used by application code | No confirmed leak |
| localStorage `lq-nav-collapsed` | UI collapse preference | Harmless |
| localStorage `lq-auth-sync-v1` | Token-free `{type, reason, at}` signal | Harmless; sanitized by validator |
| localStorage `lq-focus-timer-v1` | Timer state, note, manual correction | **Sensitive personal data**, account-unscoped; see finding L-01 |
| localStorage `lq-legacy-claim-v1` | Opaque userId + migration/cleanup status | Identifier, not credential; low risk |
| IndexedDB | Local-mode learning data only | Plaintext browser storage by design; not used in cloud mode |
| In-memory module variable | CSRF token | Not persisted; lost on reload and re-fetched |
| URL fragment | Reset/verification token until captured | Deliberately fragment; stripped after capture; never sent in query/referrer |
| Server logs | Sanitized security events | No token/cookie values found in inspected paths |
| Third-party scripts | None found | CSP restricts scripts to self and YouTube frame API |

The reset-token design deserves credit: the token is captured from the hash fragment, the fragment is replaced with a token-free route, and the token is never placed in a query string. API requests use `credentials: 'include'` and relative `/api` paths. The server sets `Cache-Control: no-store` on auth and account responses.

### 5.3 CSP and browser hardening

The production Vercel CSP:

```text
default-src 'self';
script-src 'self' https://www.youtube.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://*.ytimg.com;
font-src 'self' data:;
connect-src 'self';
frame-src https://www.youtube.com https://www.youtube-nocookie.com;
media-src 'self' https://www.youtube.com;
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
manifest-src 'self';
worker-src 'self' blob:;
upgrade-insecure-requests
```

Additional headers: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, HSTS, and a restrictive Permissions Policy. The backend API also disables `x-powered-by`, sets `no-store`, and uses Helmet’s CSP for API responses. `style-src 'unsafe-inline'` is a minor residual risk but not a session-token leak.

### 5.4 Leakage findings

| ID | Check | Result | Classification |
|---|---|---|---|
| L-01 | Session token readable by JavaScript | No; HttpOnly cookie only | Not found |
| L-02 | Session token in localStorage/sessionStorage/IndexedDB | No | Not found |
| L-03 | Session token in URL, fragment, history, or referrer | No; reset token only, then stripped | Not found |
| L-04 | CSRF token persisted or placed in cookie | No; memory only | Not found |
| L-05 | Cookie leakage through third-party analytics | No analytics scripts found | Not found |
| L-06 | Cookie leakage through logs | No inspected path logs cookie/token values | Not found (source inspection) |
| L-07 | Focus recovery note is readable by the next account on the same browser profile | Timer key is not account-scoped; sign-out clears it, but a crash/forced close or cross-tab account switch can leave it | Potential risk |
| L-08 | Local-mode IndexedDB data is plaintext | By design; documented local mode only | Potential risk (accepted design) |
| L-09 | Cookie clearing attribute consistency | Same name/path/flags with Max-Age 0 and epoch Expires | Confirmed — source |
| L-10 | Reverse-proxy cookie host behavior | Source topology is consistent; live Vercel cookie behavior not tested | Not tested |

The absence of a confirmed leak is not proof of immunity to XSS. If an attacker executes same-origin script, it can issue authenticated requests and read CSRF responses even without reading the HttpOnly session cookie. The CSP and lack of third-party scripts reduce, but do not eliminate, that risk.

---

## 6. Single-browser multi-tab logout defect

### 6.1 Actual current behavior

The ordinary sign-out path is implemented as follows:

1. The user clicks Sign out in tab A.
2. `signOut` increments `authEpoch`, cancels the debounced save, clears `cloudUserRef`, and increments `cloudLoadGeneration` before the network call (`store.tsx:1190–1198`).
3. The frontend calls `POST /api/auth/logout`.
4. The backend reads the session cookie, marks the matching server session revoked, and appends a clearing cookie (`routes/auth.ts:381–390`).
5. In `finally`, tab A resets account state, clears the authenticated user, clears the focus recovery key, and emits `lq:data-cleared` (`store.tsx:1204–1217`).
6. Only after server success, tab A broadcasts a token-free `{type:'signed-out', reason:'sign-out', at}` event through `BroadcastChannel`; if that is unavailable, it writes the same event to localStorage for a `storage` event (`store.tsx:1218–1222`, `authSync.ts:33–54`).
7. Tab B subscribed at mount (`store.tsx:886–889`). It calls `applyRemoteSignOut`, which uses the synchronous `authUserRef` to decide whether it had an authenticated session and then `clearLocalSession` (`store.tsx:799–805`).
8. `clearLocalSession` increments `authEpoch`, cancels saves, invalidates cloud loads, clears CSRF and all account state, removes the focus recovery key, and emits `lq:data-cleared` (`store.tsx:782–797`). Any late load/login response checks its epoch/generation and is discarded.

The event carries no token, cookie, session ID, user ID, email, profile, or learning data. The test asserts exactly three fields (`auth-sync.test.tsx:91–113`).

### 6.2 Required-behavior assessment

| Required behavior | Current status | Evidence |
|---|---|---|
| All same-browser tabs transition promptly | Yes, in the ordinary success path | `cross-tab-auth.test.tsx:155–169` |
| Current session revoked server-side | Yes | `routes/auth.ts:381–390` |
| All tabs clear stale private UI | Yes, via `clearLocalSession` | `store.tsx:782–805` |
| New protected operations fail | Yes, server session is revoked | `multiuser.test.ts:361–375` |
| Late async responses cannot restore auth | Yes, epoch/generation guards | `store.tsx:607–612`, `1164–1168` |
| User can sign in again | Yes | Auth state is reset to the public form |
| Immediate visual synchronization and authoritative revocation | Yes in ordinary success; visual sync is best-effort | Code and tests |

### 6.3 Residual cases

| Case | Behavior | Severity | Classification |
|---|---|---|---|
| Server logout fails | Current tab clears; other tabs receive no broadcast because broadcast is gated on `!serverError`; the user sees a warning that the session may still be active. | Medium | Confirmed — source `store.tsx:1218–1222` |
| BroadcastChannel unsupported and localStorage blocked | No cross-tab signal; other tabs remain until a protected request returns 401. | Low/Medium | Potential risk |
| Tab is frozen/suspended | BroadcastChannel/storage event may be delayed until the tab resumes; UI is stale while frozen. | Low | Potential risk (browser behavior) |
| Sign-out in a tab that never had authenticated state | It may show no notice; public recovery screens deliberately suppress the notice. | Informational | Confirmed — source |
| Password reset in another tab | Reset screen broadcasts `password-reset`; tabs clear. The server revokes all sessions. | Positive | Confirmed — source/test |
| Verified email change | Verification screen broadcasts `email-change`; tabs clear. | Positive | Confirmed — source |
| Account deletion | Deletion broadcasts `account-deleted`; tabs clear. | Positive | Confirmed — source |
| Tab retains an in-flight request that completes after revocation | Client generation guard discards the response; a request already authorized at the server may still complete. | Low | Partially confirmed |
| Broadcast event forged by same-origin script | It can clear UI but cannot create a session or reveal data; server still enforces auth. | Low | Potential risk |

### 6.4 Verdict on Case A

**The ordinary single-browser multi-tab sign-out report is not reproducible from current source and is covered by tests.** If the user still observes it in a deployed environment, likely explanations are:

1. The deployed frontend is stale and does not contain the current `authSync` implementation (Report 21 recorded stale deployments as a historical concern).
2. The sign-out request failed, so the deliberate “broadcast only after confirmed revocation” branch was taken.
3. The other tab was frozen or in a browser context where neither BroadcastChannel nor localStorage events were delivered.
4. A different action (session expiry, password change, admin revocation) occurred without a broadcast.

None of those should be described as “the same-browser logout bug is unfixed.” The source now implements both immediate visual synchronization in the success path and authoritative server revocation.

---

## 7. All-devices logout defect

### 7.1 Server behavior

`POST /api/auth/logout-all` is authenticated and CSRF-protected. It calls `revokeAllSessions(store, userId)` with no exception, so every active session for the account is revoked, including the initiating one (`routes/auth.ts:392–400`). It then clears the initiating cookie. `revokeAllSessions` selects all `{userId, revokedAt:null}` sessions and updates each (`sessions.ts:151–159`). A later request from any device calls `findSessionByToken`, which requires `revokedAt:null`; the session is rejected, the cookie is cleared, and the API returns 401 with `SESSION_EXPIRED` (or a route-specific session code).

This is **authoritative, immediate revocation at the server** for all processes using the shared MongoDB session collection. There is no server-side session cache that would delay it.

### 7.2 What is missing for remote devices

There is no mechanism that tells a remote browser that its session was revoked:

- No WebSocket.
- No server-sent events.
- No periodic `/api/auth/session` heartbeat.
- No visibility/focus-triggered session revalidation.
- No cross-device auth-sync channel.
- No session generation/version in account responses that a tab could compare.

`refreshSession()` exists, but it is called from the Account screen and is not wired to visibility, focus, online, or a timer (`store.tsx:1224–1234`). The only automatic global response is a 401 on a later protected request. Therefore a remote device can continue displaying already-loaded private UI indefinitely, until:

1. It makes a protected request and receives 401, or
2. The user manually refreshes/reloads, or
3. The user opens Account and triggers a session refresh, or
4. An unrelated `lq:auth-expired` event is dispatched.

An idle tab that is only reading cached React state makes no request, so it can display playlists, notes, focus history, and account identity after revocation. This is the reported Case B.

### 7.3 Nuances that matter

| Nuance | Current behavior |
|---|---|
| Does logout-all revoke the current session too? | Yes. There is no exclusion. |
| Are sessions deleted or marked revoked? | Marked `revokedAt`; TTL handles later cleanup. |
| Is revocation checked on every protected request? | Yes, via `findSessionByToken`. |
| Are password-version changes checked? | Yes, in `requireAuth` and `/auth/session`. |
| Is there an active-session cache? | No application cache; MongoDB is the authority. |
| Are all Render processes consistent? | Yes, if they share the same database and `SESSION_SECRET`; no in-memory session truth. |
| Can a refresh recreate an old session? | No; refresh only re-reads. A login creates a new session and rotates the cookie. |
| Do cookies get cleared on the initiating device? | Yes. |
| Do remote devices eventually get a rejection? | Yes, on their next protected request. |
| Do background sync operations stop? | Client saves are invalidated by `cloudUserRef`/epoch on local sign-out; remote tabs do not know until a request fails. |
| Is there a session-status endpoint? | Yes, `GET /api/auth/session`, but it is not polled. |
| Is there an existing cross-device event channel? | No. |
| Does logout delete learning data? | No. It only revokes sessions and clears cookies. |

### 7.4 Threat and impact

This is primarily a **privacy/UI staleness** defect, not an authorization bypass: after revocation, the remote device cannot make a successful protected request. But on a shared or unattended device, already-rendered notes, playlists, account email, and learning history remain visible. The user asked for a visual logout, and the product currently provides only eventual server rejection.

The correct claim is: **all-devices logout is authoritative at the server and not visually immediate on remote clients.** That distinction must be preserved in any release note or UI copy.

### 7.5 Evidence table

| Claim | Evidence | Classification |
|---|---|---|
| Logout-all revokes all sessions | `revokeAllSessions` filter has no exception; route calls it | Confirmed — source |
| Revoked sessions fail on next request | `findSessionByToken` filters `revokedAt:null`; multiuser test | Confirmed — test |
| Current device cookie is cleared | `clearSessionCookie(res)` in route | Confirmed — source/test |
| Remote device receives no push | No WebSocket/SSE/polling/visibility revalidation | Confirmed — source (absence) |
| Remote device can display cached private UI after revocation | No state invalidation without a request/event | Partially confirmed (source reasoning; live device not tested) |
| Learning data is not deleted by logout | Logout only touches sessions/cookies | Confirmed — source |

---

## 8. Recommended session/logout architecture

This section is design-ready but not implemented. It preserves the server as the sole authentication authority and adds explicit identity and revalidation semantics.

### 8.1 Design principles

1. **Server authority:** every protected request still validates the session, account status, and password version.
2. **One identity per browser context:** a tab must never assume that its in-memory user matches the cookie’s current session.
3. **Immediate local truth:** same-browser tabs converge through a token-free channel, with a storage fallback.
4. **Bounded remote staleness:** remote tabs revalidate on a low-cost schedule and at high-value moments.
5. **No secret in synchronization messages:** events carry only a reason, timestamp, and non-reversible session generation.
6. **Fail closed on ambiguity:** if identity cannot be confirmed, clear private UI and show sign-in; never merge data across identities.

### 8.2 Same-browser tabs

Keep the existing `BroadcastChannel` + storage fallback, with these changes:

- Rename the protocol to `lq-auth-sync-v2` and include a `sessionGeneration` integer or UUID that is not a secret.
- Broadcast on **sign-in as well as sign-out**, so an older tab cannot keep showing the previous account after a new login. The event reason can be `sign-in`; the receiving tab must revalidate `/auth/session` rather than trusting the event payload.
- Broadcast a local-clear event even when server logout fails, with a distinct reason such as `sign-out-unconfirmed`, so other tabs do not continue showing private UI. The server session may still exist; each tab still revalidates and fails closed.
- Keep the event free of user ID, email, token, cookie, and session ID. A hash of the session generation is acceptable but not necessary.
- Add an `authEpoch` check to every auth-sensitive response (already present) and a `userId` comparison when a response includes an identity.
- On receiving any auth event, abort in-flight account loads/saves, clear CSRF, clear account state, and show a scoped notice. Do not immediately auto-login.

### 8.3 Account identity assertion

Add `userId` (and optionally `sessionId`/`sessionGeneration`) to every account-data response, or return a canonical `{userId, version, state}` envelope. In `loadCloud`:

```text
if (response.userId !== authUserRef.current.userId) {
  clearLocalSession("Your account changed in another tab. Sign in again.");
  return;
}
```

This closes the stale-tab read path where an old tab manually reloads data under a newly rotated cookie. The server should also reject a request whose CSRF token belongs to a different session; it already does, but the client should not need a failed save to discover the change.

### 8.4 Remote devices

Recommended layered strategy, in order:

1. **Visibility/focus revalidation (required):** on `visibilitychange` to visible and on `window.focus`, call `GET /api/auth/session` if the tab is authenticated and the last check is older than 30–60 seconds. This catches the common “user returns to the tab” case at almost no cost.
2. **Lightweight heartbeat (required):** while the tab is visible and authenticated, call `/api/auth/session` every 60–120 seconds with jitter. On hidden tabs, stop the timer; revalidate on resume. Do not poll while offline.
3. **Pre-write revalidation (required):** before a cloud save that will mutate data, confirm the session identity if the last check is older than the heartbeat interval. A rejected session must not be followed by a retry under a stale identity.
4. **401 handling (existing):** any protected response with a session-expiry code clears state immediately, even if the request was not a heartbeat.
5. **SSE/WebSocket (optional, not now):** a push channel would reduce staleness to seconds, but it adds connection lifecycle, Render sleep/proxy behavior, reconnect storms, and server memory cost. For a personal tracker with a 30-day session, visibility + heartbeat is the better cost/benefit choice.
6. **Do not use localStorage for cross-device events.** localStorage is origin- and profile-scoped.

### 8.5 Heartbeat response contract

```json
{
  "authenticated": true,
  "user": { "userId": "...", "username": "...", "..." : "..." },
  "session": { "generation": 42, "idleExpiresAt": "...", "expiresAt": "..." },
  "csrfToken": "..."
}
```

The heartbeat must not extend the absolute expiry. It may touch idle expiry, consistent with a real user activity signal. To avoid write amplification, `requireAuth` can throttle `touchSession` to at most once every 5 minutes, while still checking revocation/expiry on every request.

### 8.6 Failure and race scenarios

| Scenario | Required behavior |
|---|---|
| Heartbeat returns 401 `SESSION_REVOKED` | Clear all account state, show “signed out elsewhere,” do not retry with old CSRF. |
| Heartbeat returns 403 CSRF | Treat as identity ambiguity if the session user differs; revalidate session, then clear if needed. Do not loop. |
| Logout-all initiated locally | Revoke server session, clear local tabs, broadcast `sign-out`; remote tabs converge on next heartbeat/visibility. |
| Logout-all initiated remotely | Local tab sees heartbeat 401; clears. If offline, it clears on next request or manual reload. |
| New login in another tab | Broadcast `sign-in`; old tabs revalidate. If the session user differs from their in-memory user, clear and show sign-in, do not load the new account automatically. |
| Network offline | No heartbeat; keep UI but mark “offline/unverified”; do not allow destructive actions that require server confirmation. On reconnect, revalidate before saving. |
| Device asleep | No polling; on wake, visibility/focus revalidation runs before any new save. |
| Late account load after sign-out | Generation/epoch guard discards it (existing). Add userId assertion as a second barrier. |
| In-flight save after revocation | Server rejects; client must not retry automatically under the same identity. |
| Two tabs sign in as different users | Older tab detects identity change and clears; it must never display the new account under the old profile. |

### 8.7 Architecture comparison

| Mechanism | Reliability | Cost | Complexity | Render fit | Verdict |
|---|---|---|---|---|---|
| Server validation on each request (existing) | Authoritative | Normal request cost | Low | Excellent | Keep |
| Same-browser BroadcastChannel + storage fallback | High in same profile | Negligible | Low | N/A | Keep and extend |
| Visibility/focus revalidation | High for returning users | Very low | Low | Excellent | **Adopt** |
| 60–120 s heartbeat while visible | High within one interval | Low but adds requests and session touches | Low/Medium | Good | **Adopt** |
| Server-sent events | High, near-real-time | Persistent connections, reconnect logic | Medium/High | Possible but operationally heavier | Defer |
| WebSocket | Highest, bidirectional | Connection state, scaling, auth handshake | High | Overkill | Reject for now |
| Cross-device localStorage | None | None | Low | N/A | Reject |

### 8.8 Acceptance criteria

- Two tabs in one browser: sign-out clears both within 1 second in the success path; a failed server logout still clears both locally with an explicit unconfirmed notice.
- Two tabs with different accounts: signing in as B broadcasts; tab A revalidates and clears rather than displaying B’s data.
- A remote tab with an open dashboard receives revocation within the heartbeat interval when visible, and on the next visibility/focus transition when hidden.
- No event or heartbeat response exposes a session token, cookie, email, or learning data to another origin.
- A late response cannot restore auth after a sign-out or identity change.
- Server tests prove logout-all revokes every session; client tests prove the UI clears on 401 and identity mismatch.

---

## 9. Complete Arena mathematical audit

### 9.1 What Arena currently is

Arena is an **optional fictional simulation**, off by default. It is not a real-user leaderboard and does not persist opponent records on the server. Competitors are generated locally from a seed, the active playlist, a cohort distribution, a daily study cap, and a rolling calendar window. The page labels the cohort as fictional and states that no real people are involved.

### 9.2 Exact current model

**Daily efficiency** for one calendar day in the selected timezone:

```text
E_d = 100 × U_d / F_d
```

Where:

- `U_d` = unique content seconds attributed to day `d` from playback segments, merged by stable entry identity and interval union.
- `F_d` = focused seconds attributed to day `d` from study sessions, including cross-midnight splitting and excluding recorded pauses when intervals exist.
- A day is eligible if `F_d > 0` and both inputs are finite and non-negative. Zero-focus days are excluded, not scored as zero.

**Arena score**:

```text
A = (E_1 + E_2 + ... + E_n) / n
```

Where `n` is the number of eligible days. This is an **unweighted arithmetic mean of daily percentages**, deliberately different from the Efficiency screen’s aggregate ratio. `arenaScore([]) = null`.

**Eligibility**:

```text
required = 3                     if W ≥ 3
required = max(1, W)             otherwise
```

A user or rival is ranked only when `arenaScore !== null` and `eligibleDays >= required`. Otherwise the row is “provisional,” receives no rank, and is excluded from percentile denominators.

**Competition rank**:

```text
rank(r) = 1 + count(scored rows with value > value(r))
```

Ties share a rank (1, 2, 2, 4). Rows are sorted by score descending, then stable ID. Percentile is the share of **scored rivals** strictly below the user, not including provisional rivals.

**Window**: default rolling 14 calendar days in the user’s timezone, including the current partial day. `windowDays` is configurable from 1 to 90. Rolling forward changes the date set and therefore recomputes ranks.

**Competitor generation**:

- Deterministic mulberry32 PRNG, seeded by `cfg.seed`.
- Date-anchored behavior uses `hash(seed:rivalIndex:dateKey)` per rival-day so refreshing the same date reproduces the same day.
- Tier distribution defaults: Ultra 2%, High 8%, Good 20%, Normal 30%, Average 25%, Below Average 15%.
- Each tier has an efficiency band, a downward daily deviation, an active-day probability, and a session-length range.
- Competitor daily content is capped by remaining playlist duration. Once the playlist is exhausted, no further new coverage is fabricated; practice minutes are display-only.
- `dailyCapHours` caps simulated rival session length, not the user.
- Names are generated from a separate stream so expanding the cohort appends identities rather than renaming existing ones.

### 9.3 Inputs and units

| Input | Source | Unit | Notes |
|---|---|---|---|
| `U_d` | Playback segments merged by entry identity | content seconds | Timeline seconds, already playback-rate normalized by YouTube’s timeline; repeated coverage is deduped within the day |
| `F_d` | Study sessions attributed by interval | active seconds | Pauses excluded when intervals exist; legacy sessions without intervals are distributed over wall time |
| `dailyEffs` | `eligibleDailyEfficiencies(table)` | percentage points | One value per eligible day |
| `playlist.totalSec` | Resolved entry durations | seconds | Null if any duration is unresolved |
| `playlist.n` | Entry count | count | Used as a fallback multiplier when total is null |
| `cfg.dailyCapHours` | User setting | hours | Rival-only cap |
| `cfg.windowDays` | User setting | days | Rolling window |
| `cfg.seed` | User setting | integer | Deterministic identity and behavior |

### 9.4 Why the current rank feels nonsensical

#### A. One minute per day can beat hours of real study

The score has no minimum volume. Three days of 60 seconds of focus and 60 seconds of unique content produce:

```text
Day 1: 60 / 60 × 100 = 100%
Day 2: 60 / 60 × 100 = 100%
Day 3: 60 / 60 × 100 = 100%
Arena score = (100 + 100 + 100) / 3 = 100.0%
```

That user ranks above every simulated High, Good, Normal, Average, and Below Average rival, and beats any Ultra rival below 100%. The user did three minutes of study. This is a **confirmed rank exploit**, not a hypothetical.

#### B. Equal weight per day ignores volume

Suppose:

- Day 1: 5 minutes focus, 5 minutes unique content → 100%.
- Day 2: 180 minutes focus, 90 minutes unique content → 50%.

Current Arena score:

```text
(100 + 50) / 2 = 75.0%
```

The Efficiency screen’s aggregate ratio:

```text
(300 + 5,400) / (300 + 10,800) × 100
= 5,700 / 11,100 × 100
= 51.35%
```

The five-minute day contributes as much rank weight as the three-hour day. This is intentional in the current model but is not defensible as a measure of learning performance.

#### C. A single extreme day dominates the mean

A user with two ordinary 40% days and one 200% day (for example, a short high-speed session) gets:

```text
(40 + 40 + 200) / 3 = 93.3%
```

The median is 40%. The score is highly sensitive to one observation. There is no robust aggregation, trimming, or confidence adjustment.

#### D. Efficiency is not progress

A user who watches a small, easy segment at high speed can outrank a user who completes most of a long playlist at a sustainable pace. The score ignores:

- How much of the playlist is complete.
- Whether the learner returned consistently.
- Whether the observed coverage is partial or complete.
- Whether the playlist is short or long.

#### E. Incomplete playlists create a denominator mismatch

`playlist.totalSec` is null when any entry has an unresolved duration. `generateCompetitors` then uses:

```text
total = playlist.n × averageResolvedDuration
```

If unresolved entries are missing rather than zero-length, this underestimates the true playlist. Competitors exhaust their fabricated content earlier and their last day’s efficiency is capped lower, while the user’s score is still based on actual coverage. The user can receive an artificial advantage. This is a confirmed fairness defect.

#### F. The final partial day penalizes completion

A competitor with 10 hours of content who completes 9.5 hours on day 13 and has 0.5 hours left on day 14 may record a very low final-day efficiency because the remaining content is small relative to the session. The mean then drops sharply even though the competitor completed the playlist. The current comment acknowledges the lower final-day efficiency, but the scoring model treats it as a bad day rather than a completion boundary.

#### G. The 3-day minimum is too weak relative to a 14-day window

A user can be ranked after 3 eligible days while rivals are evaluated across 14 days. The user is not required to demonstrate consistency across the window. This amplifies the one-minute exploit and makes early ranks unstable.

#### H. Rolling-window rank drift is structural

Because the window slides every day, yesterday’s best day can fall out and a new day can enter. Rank can move without any new learning. Competitor day values are stable for the same date, but the **set of dates** changes. This is not a bug in determinism; it is a property of a rolling window that the UI does not explain enough.

#### I. Competitor realism is limited

Competitors have coherent per-day sessions and tier-dependent activity/length, which is better than independent random daily scores. But:

- Daily efficiency is sampled independently within a band; there is no learning trend.
- Activity is Bernoulli, not a realistic weekly schedule with rest days, holidays, or weekday effects.
- There is no relationship between a rival’s cumulative progress and its remaining content beyond the final cap.
- A rival’s “tier” is an ability label, but the score only sees efficiency percentages; the simulation’s hours are display-only.
- The distribution can be changed freely by the user, which changes the apparent rank without changing the user’s learning.

#### J. Settings can change the apparent rank

The user can change cohort size, seed, window, daily cap, and tier percentages at any time. The page explains that changing the window re-simulates the period and ranks may move without new study. That transparency is good, but it means the displayed rank is not a stable property of the learner. It is a property of the learner **and the current settings**.

### 9.5 Worked comparison: Arena vs aggregate efficiency

| Day | Unique content | Focus | Daily efficiency |
|---|---:|---:|---:|
| 1 | 300 s | 300 s | 100.0% |
| 2 | 5,400 s | 10,800 s | 50.0% |
| Total | 5,700 s | 11,100 s | **51.35% aggregate** |

- Arena score: **75.0%**.
- Efficiency screen aggregate: **51.35%**.
- The two numbers are both “efficiency” in the product, but they answer different questions. Arena’s number gives equal weight to a five-minute day and a three-hour day. The UI does explain this, but the explanation does not make the rank fair.

### 9.6 Current rank stability and fairness matrix

| Scenario | Current behavior | Fairness assessment |
|---|---|---|
| Three 1-minute days | Score 100%, ranked | Severe exploit |
| One huge high-speed day | Mean lifted substantially | High sensitivity |
| Many low-volume days | Each day equal weight | Rewards frequency without volume |
| Consistent 70% over 14 days vs burst 100% over 3 days | 3-day burst can win | Depends on product objective; current UI implies sustainable rank, so mismatch |
| Long playlist, slow completion | Efficiency may be high; progress ignored | Rewards throughput, not completion |
| Short playlist, rapid completion | Content exhausted; final day may be capped | Penalizes completion |
| Unresolved durations | Competitor total estimated; user actual | Confirmed advantage/inconsistency |
| New user | Ranked after 3 eligible days | Too early for a 14-day claim |
| User changes seed/window | Rank changes without study | Transparent but not a stable rank |
| Refresh same day | Same date-anchored values | Deterministic |
| Tomorrow | Window slides | Rank drift without study |
| Ties | Competition rank shared | Correct |
| Provisional user | No rank, no bottom percentile | Correct |
| Real user vs simulated | Clearly labeled | Correct |

### 9.7 Evidence classification

| Finding | Evidence | Classification |
|---|---|---|
| Score is mean of eligible daily efficiencies | `competition.ts:175–178`; `Competition.tsx:79` | Confirmed — source |
| Required days is 3 for windows ≥3 | `competition.ts:166–168` | Confirmed — source |
| No minimum volume or content gate | `eligibleDailyEfficiencies` only checks `F_d > 0` | Confirmed — source |
| One-minute day can score 100% | Arithmetic from source inputs | Confirmed — mathematical |
| Equal weight per day differs from aggregate | Worked example above | Confirmed — mathematical |
| Final-day cap lowers competitor mean | `competition.ts:275–281`, `309–310` | Confirmed — source |
| Incomplete playlist uses estimated total | `competition.ts:234`; `Competition.tsx:93–102` | Confirmed — source |
| Rolling window changes ranks | `challengeWindowDates` + date anchor | Confirmed — source/test |
| Competitor identities stable | Separate name stream, tests | Confirmed — test |
| Tie ranks and percentile correct | `competition.ts:418–431`, `arena.test.ts` | Confirmed — test |
| User settings can change rank | Settings mutate `cfg` and regenerate | Confirmed — source |

---

## 10. New Arena simulation model proposal

### 10.1 Product objective first

Arena must choose one primary objective. The current model implicitly claims “average daily efficiency,” which is neither sustainable-habit ranking nor progress ranking. The recommended objective is:

> **Sustainable completion:** reward how much of the playlist the learner actually completes, with a meaningful consistency component, without rewarding raw hours, timer idling, or one-off spikes.

This objective is fairer than “average efficiency” because:

- It is bounded by the playlist, so long and short playlists are comparable through a percentage.
- It does not reward studying more hours after the playlist is complete.
- It gives consistency real weight without allowing a user to win by idle timer time.
- It can be explained in one sentence and decomposed on screen.
- It does not pretend to measure comprehension.

### 10.2 Recommended score (provisional, versioned)

```text
P = min(U / L, 1)                          Progress (0..1)
C = min(Q / W, 1)                          Consistency (0..1)
Arena Score = 100 × (0.75 × P + 0.25 × C)
```

Definitions:

- `L` = total resolved playlist duration in seconds. If any entry duration is unresolved, **Arena is unavailable** for that playlist until the snapshot is complete. Do not substitute an estimate.
- `U` = completed/covered content seconds, computed per entry:
  - If the entry is marked complete by the product’s normal definition, credit its full `durationSec` once.
  - Otherwise credit `min(durationSec, unique verified timeline coverage)`.
  - Sum across current playlist occurrences, then cap at `L`.
- `W` = official competition window in calendar days. For an official season, this is fixed at creation and does not roll.
- `Q` = qualifying active days, defined below.
- `P` and `C` are ratios, not percentages, until multiplied by 100.
- The score is bounded `[0, 100]`. If `L <= 0`, the score is unavailable, not zero.

**Qualifying active day**:

```text
contentGain_d >= 300 seconds
AND
max(focus_d, activePlayback_d) >= 600 seconds
```

Equivalently: at least five minutes of new content or a completed video, plus at least ten minutes of real focus or active playback. A day with a running timer but no content gain does **not** qualify. A day with autoplay but no observed activity does not qualify. A completed video can substitute for the five-minute content gain; the activity floor still applies.

This definition is deliberately stricter than the current “focus > 0” rule. It closes the one-minute exploit and the leave-the-timer-running exploit without requiring the user to maximize hours.

### 10.3 Why 75/25 rather than the supplied 85/15

The supplied 85/15 candidate is directionally better than the current model. It is not scientifically established, and it is completion-biased. Compare three learners on a 10-hour playlist over 14 days:

| Learner | P | Q | C | 85/15 score | 75/25 score | 60/40 score |
|---|---:|---:|---:|---:|---:|---:|
| Consistent: 75% complete, 10 qualifying days | 0.75 | 10 | 0.714 | 74.46 | **74.11** | 73.57 |
| Burst: 100% complete in 2 days | 1.00 | 2 | 0.143 | **87.14** | 78.57 | 65.71 |
| Strong consistent: 80% complete, 12 days | 0.80 | 12 | 0.857 | 80.86 | **81.43** | 82.29 |

Observations:

- At 85/15, a two-day burst beats a 10-day 75% learner by 12.7 points.
- At 75/25, the burst still wins, but by 4.5 points; the strong consistent learner is rewarded.
- At 60/40, consistency dominates; the burst learner drops below the consistent learner. This is a different product, not a “more correct” formula.

The weights are a **product policy choice**, not a scientific constant. The recommended default is **75/25** because it preserves progress as the primary signal while making consistency meaningful. If the product explicitly wants a completion race, 85/15 is acceptable and should be labeled “completion-first.” If the product wants sustainable habits, 60/40 is defensible. The report recommends 75/25 as the balanced default, with a visible statement that the weights are a design choice.

**Do not present the weights as statistically derived.** No population study supports 85/15, 75/25, or 60/40. Sensitivity analysis and product intent are the justification.

### 10.4 Eligibility, provisional status, and new users

- Official Arena is unavailable if the playlist has unresolved durations or `L = 0`.
- A learner is **provisional** until:
  - at least 3 qualifying days, and
  - at least 7 calendar days have elapsed in the official window.
- A provisional learner receives no rank and is excluded from percentile denominators. The UI shows “Calibrating — 2/3 qualifying days, 5/7 days observed.”
- New users may join an official season only at a season boundary, or may be placed in a “newcomer” cohort. They must not be silently compared with rivals who have a full 14-day window while the new user has one day.
- Late joiners are provisional for the remainder of their first 7 observed days; after that, their `C` uses the fixed official `W`, so they are not artificially rewarded for a short exposure.

### 10.5 Rank and tie-breaking

```text
scored rows: value != null and qualifying days >= 3 and observed days >= 7
sort: value desc, then P desc, then Q desc, then stable id asc
rank(r) = 1 + count(scored rows with value > value(r))
```

Equal scores share a rank. The secondary sort only determines display order, not rank. Percentile remains the share of scored rivals strictly below the user. A user with no score is “provisional,” never last place.

### 10.6 Competitor generation

Competitors must use the **same** `P`, `C`, and score formula. They must not receive a separate scoring shortcut.

#### Latent profile

For rival `i`:

- Determine tier from the configured tier distribution using a deterministic draw.
- Derive a target completion band `P_i` and target consistency band `C_i` from the tier table.
- Derive an activity pattern with weekday/rest-day variation and a small amount of deterministic noise.
- Derive a session-length profile from the tier, bounded by the configured daily cap for realism only.

Suggested tier bands (design assumptions, not population statistics):

| Tier | Target P band | Target C band | Typical active probability |
|---|---|---|---|
| Ultra | 0.98–1.00 | 0.85–0.95 | 0.90 |
| High | 0.90–0.98 | 0.70–0.85 | 0.80 |
| Good | 0.75–0.90 | 0.55–0.72 | 0.65 |
| Normal | 0.55–0.75 | 0.40–0.58 | 0.50 |
| Average | 0.35–0.55 | 0.25–0.40 | 0.38 |
| Below Average | 0.15–0.35 | 0.15–0.25 | 0.25 |

#### Trajectory generation

For each rival and each date in the fixed window:

1. Draw a uniform value from `mulberry32(hash(seed:version:i:date:"active"))`.
2. Apply the tier’s active probability, adjusted by a deterministic weekday factor and a small rest-day pattern.
3. Count selected dates. Adjust the set deterministically until the count is within ±1 of `round(C_i × W)`, preserving the earliest/latest constraints.
4. Allocate the rival’s total target content `P_i × L` across selected days using positive deterministic weights. Each day receives `remaining × weight / sum(weights for remaining days)`, so cumulative progress is monotonic and bounded.
5. Derive session lengths from the daily content gain and a tier efficiency factor; display them as context. They do not directly score.
6. Compute the rival’s actual `P`, `Q`, `C`, and score from the generated trajectory using the same functions as the user.

This produces:

- Stable ability profiles rather than independent random daily percentages.
- Natural variability in daily content.
- Rest days / weekly patterns.
- Monotonic cumulative progress.
- No impossible jumps beyond remaining content.
- The same scoring semantics for user and rivals.
- A controllable difficulty distribution without changing the user’s score.

#### Determinism and replay

- `ARENA_MODEL_VERSION = 'arena-v2'`.
- Seed every field with `hash(seed, version, rivalIndex, dateKey, field)`; do not use a single sequential stream that shifts when cohort size changes.
- Store the official season snapshot: `seasonId`, `modelVersion`, `seed`, `windowStart`, `windowEnd`, `playlistId`, `playlistSnapshotVersion`, `playlistDurationSec`, and a hash of the user’s inputs.
- Replaying the same snapshot must reproduce the same score and rank. A formula change increments the version and creates a new season; it does not silently rescore old results.
- Use server time for an official season. Client time is acceptable for a private practice simulation only.

### 10.7 Score decomposition and confidence

Display:

- Progress: `U / L`, with content hours.
- Consistency: `Q / W` qualifying days.
- Score: `100 × (0.75P + 0.25C)`.
- Evidence: verified vs self-reported completion share.
- Provisional reason, if any.
- “What this does not measure”: comprehension, retention, intelligence, or real-world ranking.

Do **not** show a fabricated confidence interval. “Calibrating” means insufficient observation days, not statistical uncertainty. If a numeric uncertainty is ever added, it must be derived from a defined sampling model and labeled as such.

### 10.8 Handling incomplete data, resets, and imports

| Case | Behavior |
|---|---|
| Unresolved duration | Arena unavailable until the playlist snapshot is complete. |
| Missing progress records | Treated as zero coverage for those entries; not invented. |
| Imported data | Included after validation; evidence labels preserved where available. |
| Reset playlist | New season; old rank history remains historical but is not mixed into the new score. |
| Duplicate video occurrences | Scored by stable entry identity; duplicates are distinct playlist occurrences. |
| Rewatch | Does not increase `U` beyond `L`; it may contribute to focus but not to progress twice. |
| Manual completion | Counts toward `P` at full duration but is labeled self-reported; it does not grant verified evidence. |
| Zero-length entry | Contributes zero; does not make `L` invalid unless all entries are zero. |
| All entries unresolved | Arena unavailable. |
| New user | Provisional until 3 qualifying days and 7 observed days. |
| Time zone change | Official season is anchored to the season timezone; practice recomputes with the selected timezone and is labeled as such. |

### 10.9 Anti-manipulation safeguards

No client-only score can be cheat-proof. These safeguards raise the cost and make the product honest:

1. Settings cannot change an official score, official cohort, or official weights after the season starts. They may change a clearly separate practice simulation.
2. Timer-only days do not qualify; content gain and activity are both required.
3. Raw hours are not scored; `P` is capped by the playlist and `C` is capped at one.
4. Duplicate segments are deduped by ID; duplicate progress is deduped by stable occurrence identity.
5. XP, achievements, and streaks are not inputs to Arena.
6. Manual completion is labeled; official views show evidence mix.
7. A formula version is part of the snapshot; changing weights cannot retroactively alter a completed season.
8. For a future real leaderboard, scores must be recomputed server-side from validated evidence, not accepted from the client.

### 10.10 Candidate model comparison

| Model | Inputs | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current: mean daily efficiency | Daily `U/F` only | Simple, existing tests, no hours | Volume exploit, spike sensitivity, ignores progress | Replace |
| 85/15 completion + consistency | `P`, `C` | Simple, bounded, fixes exploit, transparent | Completion-first; two-day burst can dominate | Acceptable if labeled completion-first |
| **75/25 completion + consistency** | `P`, `C` | Balanced, bounded, fixes exploit, meaningful consistency | Weights still a policy choice; manual evidence | **Recommended provisional default** |
| 60/40 completion + consistency | `P`, `C` | Strong sustainable-habit signal | Can under-reward genuine intensive completion | Alternative for habit-first product |
| Pace-adjusted progress | Normalized content pace + progress | Rewards efficient learning | Rate attribution complexity; can reward speed over understanding | Secondary diagnostic, not official |
| Raw focus hours | Focus only | Easy to understand | Rewards time, not learning; unhealthy | Reject |

### 10.11 Worked examples for the recommended model

**Example 1 — consistent learner**

- Playlist: 10 hours = 36,000 s.
- Completed/covered: 27,000 s → `P = 0.75`.
- Qualifying days: 10 of 14 → `C = 0.7143`.
- Score = `100 × (0.75 × 0.75 + 0.25 × 0.7143) = 74.11`.

**Example 2 — burst learner**

- Same playlist.
- Completed: 36,000 s → `P = 1.00`.
- Qualifying days: 2 of 14 → `C = 0.1429`.
- Score = `100 × (0.75 + 0.0357) = 78.57`.
- The burst still leads under 75/25, but by a much smaller margin than under 85/15 (87.14). If the product wants the consistent learner to win, use 60/40 or a multiplicative model; that is a deliberate policy decision.

**Example 3 — strong consistent learner**

- `P = 0.80`, `Q = 12`, `C = 0.8571`.
- Score = `100 × (0.60 + 0.2143) = 81.43`.
- This learner leads the two-day burst, which matches the “sustainable completion” objective.

**Example 4 — tie**

- Two learners both score `74.11`, both have `P = 0.75`, both have `Q = 10`.
- They share the same competition rank. Display order uses stable ID, but the rank is tied. A tie is not broken by hours, XP, or a hidden “user wins” rule.

**Example 5 — provisional**

- `P = 0.92`, `Q = 2`, `W = 14`.
- Score would be `100 × (0.69 + 0.0357) = 72.57`, but the learner has fewer than 3 qualifying days, so the UI shows “Provisional — 2/3 qualifying days” and no rank. The provisional value must not be shown as an official rank.

**Example 6 — incomplete playlist**

- `L` cannot be resolved because one video duration is missing.
- Arena shows “Unavailable until all video durations are known.” It does not estimate `n × average`. This avoids the current denominator mismatch.

### 10.12 Performance

A 2,000-rival, 90-day cohort requires 180,000 day records. With deterministic scalar PRNGs and no heavy allocations, this is comfortably interactive in a browser; the current implementation already generates 2,000 × 90. The new model should:

- Cache the generated cohort by `{seed, modelVersion, cohortSize, tierDist, windowStart, windowEnd, playlistSnapshotVersion}`.
- Compute the user score separately from the cohort.
- Avoid recomputing on every UI tick; only recompute when inputs change.
- Cap cohort size at 2,000 and window at 90 days, as today.

### 10.13 Arena verdict

The current model is deterministic, clearly labeled, and better engineered than a random leaderboard, but it is not a defensible competition. A one-minute day can win. The recommended 75/25 completion-plus-consistency model is bounded, explainable, robust to the current exploit, and implementable with existing data. It still cannot prove learning quality, and it must never be presented as a real-world ranking.

---

## 11. Arena frontend configuration experience

### 11.1 Product integrity rule

There must be a hard separation between:

1. **Official Arena season** — a fixed model version, fixed cohort configuration, fixed window, fixed weights, and a stored snapshot. The user cannot alter it after creation.
2. **Practice simulation** — a sandbox where the user can change difficulty, cohort size, window, seed, and tier distribution. It is labeled “Practice simulation — does not affect your official rank.”
3. **Personal learning statistics** — progress, focus, efficiency, XP, achievements. These are never changed by Arena settings.

The current page lets every setting immediately change the only displayed rank. That is transparent but does not prevent a user from cycling seeds until they find a favorable rank. The redesign should keep the exploration value while removing the integrity problem.

### 11.2 Proposed page layout

```text
Arena
├─ Header
│   ├─ "Fictional simulation" badge
│   ├─ Season / practice selector
│   └─ “How ranking works” disclosure
├─ My result card
│   ├─ Rank / percentile / provisional state
│   ├─ Score decomposition: Progress 75% | Consistency 25%
│   ├─ Evidence mix: verified vs self-reported
│   └─ “What this does not measure”
├─ Rank movement
│   ├─ Last 6 snapshots (only when recorded)
│   └─ “Rank changed because the window moved” explanation
├─ Leaderboard
│   ├─ Search, page size, tier filter
│   ├─ Rows: rank, alias, score, progress, consistency, eligible days, provisional
│   └─ Expand row: simulated daily trajectory and evidence
└─ Settings panel
    ├─ Practice mode (default when exploring)
    ├─ Official season (read-only after creation)
    └─ Advanced disclosure
```

### 11.3 Controls and effects

| Control | Practice | Official | Effect |
|---|---|---|---|
| Competition intensity: Relaxed / Standard / Competitive | Yes | Locked at season creation | Shifts competitor ability/consistency distributions |
| Number of competitors: 10–2,000 | Yes | Locked | Changes cohort size only |
| Window: 1–90 days | Yes | Fixed official window | Changes date range and `C` denominator |
| Tier distribution | Yes, advanced | Locked | Changes simulated cohort composition |
| Seed / new cohort | Yes | New season only | Changes deterministic identities/behavior |
| Daily cap | Yes | Display-only realism | Caps simulated study, not user score |
| Show explanations / decomposition | Yes | Yes | Presentation only |
| Restart cohort | Yes | New season only | Creates a new season, never rewrites old rank |
| User score weights | No | No | Must never be user-editable |
| User’s progress/focus | No | No | Not an Arena setting |

### 11.4 Defaults and beginner presentation

- Default: **Practice off?** The user explicitly enables Arena; the current default is off. Keep it off.
- When enabled, default to a **Prepared practice cohort** with Standard intensity, 100 rivals, 14 days, existing tier distribution, and a fixed seed. The user can explore.
- “Start official season” is a separate, explicit action with a confirmation explaining that settings are locked and the season has a fixed end date.
- Beginner copy: “Arena compares your real progress with simulated learners. It is a practice game, not a real leaderboard.”
- Advanced controls hidden behind “Advanced simulation settings.”
- Do not show a wall of tier percentages to a first-time user; show intensity and cohort size first.

### 11.5 Score decomposition and explanations

Show three cards:

1. **Progress** — “You completed 27 of 36 hours (75%).”
2. **Consistency** — “You qualified on 10 of 14 days (71%).”
3. **Arena score** — “75% progress × 75% weight + 71% consistency × 25% weight = 74.1.”

Tooltip: “The weights are a product design choice, not a scientific measure of learning ability.”

Evidence line: “Verified coverage: 82% · Self-reported completion: 18%.” Do not imply that self-reported data is fraudulent; label it neutrally.

### 11.6 Loading, empty, error, and unavailable states

| State | Copy / behavior |
|---|---|
| No playlist | “Choose an active playlist to start Arena.” Link to Library. |
| Playlist durations incomplete | “Arena needs every video duration. Refresh the playlist or resolve the flagged entries.” Do not simulate with an estimate. |
| Fewer than 3 qualifying days | “Calibrating — 2/3 qualifying days. Your rank appears after 3.” |
| Fewer than 7 observed days | “Calibrating — 5/7 observed days.” |
| No scored rivals | “This cohort has no ranked rivals yet. Adjust practice settings.” |
| Invalid configuration | Inline validation, not a blank table. |
| Generation error | “The simulation could not be generated. Your learning data was not changed. Retry.” |
| Offline | “Arena needs your current data. Reconnect to refresh.” |
| Practice mode | Persistent banner: “Practice — does not affect your official rank.” |

### 11.7 Rank movement visualization

- Show rank history only when the user explicitly records a snapshot or when an official season closes.
- Do not imply continuous tracking if `rankHistory` is only written on a button click.
- A movement arrow must state the cause: “Window moved,” “New qualifying day,” “Playlist progress,” or “Official season closed.”
- If rank is provisional, show no arrow.

### 11.8 Confidence and uncertainty

- Use “Provisional” for insufficient observation, not a numeric confidence interval.
- If the product later adds a statistical interval, define the sampling model and label it as an estimate. Do not fabricate competitor statistics.
- Show eligible days and observed days as plain counts.

### 11.9 Accessibility and mobile

- The leaderboard should be a real table with row headers and sortable column buttons; do not rely on color alone for rank movement.
- Score decomposition must have text equivalents, not only bars.
- Settings controls need labels, units, and error text tied with `aria-describedby`.
- On mobile, collapse the settings panel, keep the user row sticky, and avoid horizontal scrolling for the score card. A horizontally scrollable table is acceptable only with a clear scroll affordance.
- Keyboard: all disclosure buttons, page controls, and row expanders reachable; focus returns to the trigger.
- Reduced motion: no animated rank counters; the existing reduced-motion preference should be honored.
- Color contrast: verify tier badges against the dark surface; do not use red/green alone for up/down movement.

### 11.10 Acceptance criteria

- A user cannot change an official season’s weights, cohort, window, or seed after creation.
- Changing practice settings never changes personal progress, focus, efficiency, XP, or achievements.
- A one-minute day cannot produce a ranked score.
- An incomplete playlist cannot generate an official rank.
- Every rank has a visible decomposition and provisional/unavailable state.
- The page never states or implies that simulated rivals are real people.

---

## 12. Focus reliability and mathematical assessment

### 12.1 Current state machine

Focus is a client-side timer with four states: `idle`, `running`, `paused`, `finished`. It stores:

- `timerId` — idempotency key reused as the session `clientId`.
- `startedAtMs` — wall-clock start.
- `segmentStartedAtMs` — current active segment start.
- `pausedAtMs` — pause anchor.
- `activeAccumMs` — accumulated active milliseconds.
- `intervals` — active and paused intervals.
- `lastUpdatedMs` — last persisted tick.
- `excludedWallMs` — wall time excluded during recovery.

The domain functions are deterministic and testable. `finishFocus` closes an open active interval, computes active seconds, computes elapsed seconds as `max(active, wall - excluded)`, derives paused seconds, sanitizes intervals, and returns a draft. Repeating Finish on an idle/finished state returns null. The store also dedupes by timer ID, so two clicks cannot create two sessions.

### 12.2 Current timing formulas

For a running timer:

```text
activeMs = activeAccumMs + max(0, now - segmentStartedAtMs)
wallMs   = max(0, now - startedAtMs - excludedWallMs)
```

On pause:

```text
end = clamp(now, segmentStartedAtMs, segmentStartedAtMs + 24h)
activeAccumMs += end - segmentStartedAtMs
active interval = [segmentStartedAtMs, end]
```

On finish from paused:

```text
activeSec  = floor(activeAccumMs / 1000)
elapsedSec = max(activeSec, floor((now - startedAtMs - excludedWallMs) / 1000))
pausedSec  = max(0, elapsedSec - activeSec)
```

On recovery of a running timer:

```text
last = min(now, max(segmentStartedAtMs, lastUpdatedMs))
recovered = pauseFocus(state, last)
excludedWallMs += now - last
```

The recovery design is good: time while the page was closed is not counted. The timer is persisted roughly every second via the `now` update effect (`Focus.tsx:95–117`). When the tab is hidden, the timer auto-pauses and persists (`Focus.tsx:128–153`). `beforeunload` also pauses or persists. A `lq:data-cleared` event resets the timer and removes the recovery key.

### 12.3 What is mathematically correct

| Property | Assessment |
|---|---|
| Paused intervals excluded from active time | Correct when using the state machine normally |
| Finish idempotency | Correct at the domain and store level |
| Recovery does not count closed-tab time | Correct in the tested path |
| Cross-midnight attribution | Correct via interval splitting; DST-aware calendar arithmetic |
| Manual correction labeled estimated | Correct; manual sessions are marked `estimated:true` |
| Minimum recorded duration | 10 active seconds; shorter sessions are discarded |
| Interval sanitization | Finite, non-negative, capped array length, sorted? Filtered but not sorted |
| Total session cap | Intended 24 h, not consistently enforced |
| Server-side cross-field validation | Missing |

### 12.4 Confirmed reliability problems

#### F-04a. Clock jumps forward

`activeMs` is `activeAccumMs + (now - segmentStartedAtMs)`. If the system clock jumps forward by two hours while the segment is open, the timer counts two hours of focus. `pauseFocus` clamps an interval end to `segmentStartedAtMs + 24h`, but that still permits a full day of fabricated focus. `finishFocus` does not compare against a monotonic clock. The backend accepts `activeSec` up to 31 days and does not require `activeSec <= elapsedSec` or interval sums to match.

#### F-04b. Device sleep without a visibility event

If the device sleeps while the page is visible and the browser does not fire `visibilitychange`, the next timer tick can see a large `now - segmentStartedAtMs` gap and count the sleep as focus. The auto-pause path handles a hidden tab, not a sleeping device whose page remained “visible.”

#### F-04c. Visible inactivity

The timer counts all visible time between Start and Pause/Finish. There is no idle detection, no interaction signal, and no content-playback requirement. This is not necessarily wrong if the product calls it “timer-active time,” but the current UI/copy can imply focused study. The system cannot know whether the user is reading, watching, or away.

#### F-04d. Multiple tabs

The timer is local component state backed by one global localStorage key. Two tabs can each start a timer; each has a different `timerId`; both can finish and save. The store dedupes by `clientId`, but the two IDs differ. The result is two sessions for overlapping time. This inflates focus, XP, goals, efficiency denominator (which lowers efficiency), and Arena qualification (which may help or hurt depending on volume). There is no Web Lock, BroadcastChannel leader, or server overlap check.

#### F-04e. Cross-device overlap

The same issue exists across devices. Two devices can record overlapping focus sessions; the server stores both. There is no device/session identity conflict check.

#### F-04f. Elapsed time can exceed the intended cap

A paused timer left open for days and then finished has `elapsedSec` based on wall time minus excluded time. `activeSec` remains correct, but `pausedSec` can be enormous. The UI may display a multi-day session. The data model says 24 h max; the finish path does not enforce it for a paused session that never reloaded.

#### F-04g. Recovery persistence is one-second and account-unscoped

The recovery key is written about once per second, which is a lot of localStorage churn for a long session. It is global, not scoped by user ID. Sign-out clears it, but a crash, forced close, or cross-account tab switch can leave a previous account’s note/timer for the next account. This is both a reliability and a privacy concern.

#### F-04h. Server validation is shape-only

The backend checks that `activeSec` and `elapsedSec` are finite non-negative values under 31 days, that intervals are arrays of finite start/end/kind, and that note length is bounded. It does not check:

- `activeSec <= elapsedSec`.
- Interval union equals `activeSec`.
- Paused and active intervals do not overlap.
- The session duration is plausible for its wall-clock start/finish.
- `clientId`/`id` uniqueness beyond duplicate item IDs in the collection payload.
- Overlap with another session.

A malicious or buggy client can post an internally inconsistent session that still passes validation.

### 12.5 Worked examples

**Normal pause**

- Start 10:00:00.
- Pause 10:25:00 → active 1,500 s.
- Resume 10:30:00.
- Finish 10:45:00 → active 900 s.
- `activeSec = 2,400`; `elapsedSec = 2,700`; `pausedSec = 300`.
- Correct.

**Recovery**

- Running at last persisted tick 10:25:00.
- Page closed until 11:00:00.
- Recovery closes at 10:25:00 and excludes 2,100 s.
- Active remains 1,500 s; closed time not counted.
- Correct.

**Clock jump**

- Start 10:00:00; clock jumps to 12:00:00; user clicks Finish.
- Current code counts 7,200 s active.
- No monotonic cross-check prevents it.
- Incorrect for trust purposes unless the user really studied two hours.

**Two tabs**

- Tab A: 10:00–10:30, 1,800 s.
- Tab B: 10:15–10:45, 1,800 s.
- Current total: 3,600 s.
- Union of overlapping intervals: 2,700 s.
- Overcount: 900 s (25% in this example; worse at higher overlap).

**Visible idle**

- Start 10:00, leave the tab visible, answer a call until 11:00, Finish.
- Current active: 3,600 s.
- Actual intentional study: unknown; the system has no evidence.
- The correct claim is “timer was active for 60 minutes,” not “the user focused for 60 minutes.”

### 12.6 What Focus data already supports

- Focused minutes per day, week, playlist, and all-time.
- Session length distribution.
- Pause and interruption counts (from intervals).
- Cross-midnight and timezone-safe attribution.
- Recovery of an interrupted session.
- Manual correction with an estimated label.
- Playback-linked sessions (playlist/position) and notes at session level.

### 12.7 What requires new data

- Monotonic elapsed time and clock-jump detection.
- Sleep/wake gap classification.
- Pause reasons (manual, visibility, system, idle).
- Device/tab identity and overlap resolution.
- A server-side overlap/dedupe rule.
- Optional idle detection based on interaction, not page visibility.
- “Qualified” vs “recorded” status if the product wants to exclude suspect sessions.

### 12.8 Focus verdict

The state machine is well-written for the problem it solves: **timer accounting with pause and recovery**. It is not a measurement of attention, and it does not withstand clock manipulation, sleep gaps, or multi-tab overlap. The UI should say “timer-active time,” not “focus” if the product wants to be precise. The next implementation phase should fix the timing model before adding richer analytics.

---

## 13. Focus improvement blueprint

### 13.1 Correct timing model

Use two clocks:

- **Wall clock** (`Date.now()`): needed for persistence, calendar attribution, and cross-reload recovery.
- **Monotonic clock** (`performance.now()`): needed to measure elapsed duration without system clock jumps.

Keep a wall anchor at start and a monotonic anchor at the start of each active segment. On each transition:

```text
monotonicDelta = performance.now() - segmentMonoStart
wallDelta      = Date.now() - segmentWallStart
```

If the two deltas differ by more than a tolerance (for example 2 seconds for a 1-second tick, or 10 seconds for a 30-second heartbeat), treat the interval as **suspect**:

- If the tab was hidden or the document was suspended, close at the last known good tick and exclude the gap.
- If the wall clock jumped but monotonic time did not, use monotonic elapsed and exclude the wall discrepancy.
- If both jumped and the user was present, count at most a configured maximum gap (for example 60 seconds) and mark the rest as uncertain/excluded.
- Never count an unbounded gap as focus.

The exact policy should be explicit and tested with fake clocks. A practical default:

| Gap | Action |
|---|---|
| 0–5 s | Normal tick. |
| 5–60 s while visible | Count, because timer throttling can delay ticks; no user prompt. |
| 60 s–5 min | Count at most 60 s; mark the remainder “unverified”; show a recovery notice. |
| >5 min | Exclude the gap; require the user to confirm if they want to add a manual correction. |
| Clock jumped backward | Ignore the negative delta; preserve accumulated active time. |
| Clock jumped forward >5 min | Exclude the discrepancy; do not count it. |

This policy is conservative but honest. It prioritizes data trust over maximizing recorded minutes.

### 13.2 Qualified focus formula

```text
Qualified Focus =
  measure( Union(Active Intervals)
           \ Union(Paused Intervals ∪ Disqualified Idle/Gap Intervals) )
```

In practice:

1. Collect all active intervals with start/end.
2. Remove any interval portions that overlap a paused interval (should not happen, but defend).
3. Remove portions classified as disqualified (sleep, clock jump, user-declared idle).
4. Merge the remaining intervals.
5. Sum their lengths.

Use `max(0, end - start)` and reject non-finite/reversed intervals. Do not count overlapping intervals twice. This union rule is the only defensible way to combine multiple tabs/devices.

### 13.3 Session lifecycle

```text
idle
  → start(timerId, playlistId, intention?)
running
  → pause(reason) → paused
  → visibility hidden → paused (auto)
  → finish → finishing
  → crash/reload → recovered-paused
paused
  → resume → running
  → finish → finishing
  → reset → idle (discard)
finishing
  → validate → saved
  → save failure → draft retained / retry
  → duplicate → ignore
recovered-paused
  → resume (new segment) → running
  → finish → finishing
  → discard → idle
```

Every transition writes a small event with a monotonic/wall anchor. The server should store the final session plus an event digest or interval set; it should not need every tick.

### 13.4 Recovery and interruption reliability

- Persist at 5-second intervals, not every second, reducing localStorage churn.
- Persist a `timerVersion` and `lastGoodMonoMs`/`lastGoodWallMs`.
- On reload, close at the last good tick; never count closed-tab time.
- On wake/visibility, compare the gap and apply the table above.
- Use `pagehide` and `visibilitychange` as primary unload signals; `beforeunload` is best-effort.
- Keep a draft if the final save fails; offer “Retry save” and “Discard” rather than silently losing the session.
- If a recovered session is older than 24 hours, mark it “recovered, needs review” rather than presenting it as a normal session.
- Store the recovery snapshot under a key that includes the current `userId` (for example `lq-focus-timer-v2:<userId>`), and clear all account-specific snapshots on sign-out/account switch.

### 13.5 Multi-tab and multi-device

**Same browser:**

- Use the Web Locks API (`navigator.locks.request('lq-focus-timer', ...)`) to ensure only one tab owns an active timer. If Web Locks is unavailable, use a BroadcastChannel leader lease with a heartbeat. If neither works, show a blocking notice: “Another LearnQuest tab is already tracking focus.”
- A second tab may view history, but must not start a second timer while the first holds the lock.
- On lock loss, pause and persist immediately.

**Different devices:**

- Before saving, the client can check for overlapping sessions from the same account and show a warning.
- The server can reject a session whose active interval overlaps an existing session for the same user, or merge them for analytics. Rejection is simpler and safer; a legitimate overlap (two devices) should be rare.
- Do not silently union cross-device sessions in storage; keep both records but compute analytics from a union, with a “possible overlap” flag.

### 13.6 Server-side validation

Validate:

- `activeSec <= elapsedSec`.
- `pausedSec == max(0, elapsed - active)` within 1 second.
- Sum of active intervals approximately equals `activeSec` (tolerance for rounding).
- Sum of paused intervals approximately equals `pausedSec`.
- Active and paused intervals do not overlap.
- `startedAt <= finishedAt`.
- `finishedAt - startedAt` is within a plausible bound (for example 48 hours; 24 hours for a normal session).
- `clientId` is unique per user (or use an idempotency collection).
- `estimated` sessions are labeled and excluded from “verified” views.

If validation fails, reject with a clear 400 code; do not store an inconsistent record.

### 13.7 Analytics and feedback

Safe, trustworthy metrics:

- Timer-active minutes (not “concentration”).
- Session count and active days.
- Median and distribution of session length.
- Pauses per session and total paused time.
- Time-of-day and weekday patterns, only when there are enough observations.
- Weekly/monthly trend with sample counts.
- Playlist-linked focus time and completion correlation, labeled as association, not causation.
- Recovery/interruption rate.

Avoid:

- “Focus score” or “concentration score.”
- Streak pressure that punishes rest.
- Rankings based on hours.
- Inferred attention from tab visibility alone.

### 13.8 UX blueprint

**Pre-session:**

- Active playlist and next unfinished video.
- Optional intention (“What will you work on?”).
- Target duration and minimum viable duration.
- A short note that time is timer-active, pauses excluded, and hidden tabs auto-pause.

**Active:**

- Large monospaced timer.
- Active vs wall time.
- Pause/resume with a reason (optional).
- “End & review” and “Discard.”
- No flashing, no compulsive countdown pressure; reduced-motion support.
- `aria-live="off"` for the ticking number, with a less frequent accessible status update.

**Paused/recovered:**

- Clear reason: “Paused when the tab was hidden,” “Recovered after reload; closed-tab time was not counted,” “Clock change detected; 12 minutes excluded.”
- Resume / finish / discard.
- If a gap was excluded, show it rather than hiding it.

**Completion:**

- Active time, wall time, pauses, playlist/video, optional note.
- “This is timer-active time, not a measure of concentration.”
- Save confirmation; retry on failure.
- XP only after the session is durably saved; no optimistic award that can be duplicated.

**History/analytics:**

- Timeline and distribution.
- Personal baseline, not public comparison.
- Export and delete controls.
- Empty states that explain how to start.

### 13.9 Data requirements and migration

Existing fields are sufficient for basic timing and history. Additive fields for the next schema version:

| Field | Purpose | Migration |
|---|---|---|
| `timerVersion` | Interpret timing semantics | Additive; old sessions default to v1 |
| `monotonicActiveMs` | Clock-jump-resistant duration | Additive |
| `gapExcludedMs` | Transparency | Additive |
| `interruptionCount` | Analytics | Additive |
| `pauseReasons` | User insight | Additive, optional |
| `recovered` | Distinguish recovered sessions | Additive |
| `qualified` | Exclude suspect sessions from Arena | Additive, computed |
| `deviceId` / `tabId` | Overlap diagnostics | Additive, non-PII random |
| `saveState` | Draft vs confirmed | Additive |

No destructive database migration is required for additive optional fields in the current JSON-shaped records, but backup schema validation, export/import, and TypeScript types must be updated together. Do not infer old data as verified; label legacy sessions as “recorded” rather than “qualified” until recomputed.

### 13.10 Focus acceptance criteria

- A clock jump forward cannot add more than the policy’s maximum allowed gap.
- A sleeping device cannot add the sleep interval to active time.
- Two tabs cannot both own an active timer; the second is blocked or pauses.
- A recovered running timer excludes closed-tab time and shows a reviewed state.
- A saved session always satisfies `active <= elapsed` and interval sums within tolerance.
- Analytics label the metric “timer-active” and never claim concentration.
- Sign-out/account switch clears the account-scoped recovery snapshot.

---

## 14. Efficiency formula analysis

### 14.1 Exact current formula

```text
Content efficiency (%) = 100 × Unique content seconds / Focused study seconds
```

Implementation: `contentEfficiency({ uniqueContentSec, focusedSec })` returns `null` for non-finite or negative inputs and for `focusedSec === 0`; otherwise it returns the raw ratio times 100, with no cap (`efficiency.ts:35–41`).

`Unique content seconds` is the interval union of playback segment timeline coverage for the selected scope and evidence filter, deduped by segment ID. `Focused study seconds` is the sum of `activeSec` over focus sessions in the same scope and evidence filter. Overlapping segments are merged; repeated coverage does not increase the numerator.

`Playback utilization (%) = 100 × Active playback wall seconds / Focused study seconds` is a separate metric (`efficiency.ts:43–50`). It can exceed 100 when playback was observed without an equal amount of tracked focus.

`Overall` uses the ratio of sums, not the mean of daily percentages (`efficiency.ts:52–64`). The Efficiency screen also computes the aggregate ratio directly with `contentEfficiency` (`Efficiency.tsx:82`), duplicating `overallEfficiency`, which is only used by tests.

### 14.2 Unit analysis

| Quantity | Unit | Meaning |
|---|---|---|
| `uniqueContentSec` | content timeline seconds | Unique video timeline covered at least once in the selection |
| `focusedSec` | wall-clock active seconds | Timer-active time after recorded pauses |
| Ratio | dimensionless | Content timeline seconds per active second |
| ×100 | percent | Percent of an active second’s worth of content covered per active second |

The numerator and denominator are **different clocks**. Content seconds are timeline seconds; focus seconds are wall-clock seconds. At 1× playback, one content second generally takes one wall second. At 2×, one content second takes half a wall second, so the ratio can reach 200%. At 0.5×, it can be 50%. Notes, exercises, and debugging consume focus time without increasing content coverage, so a lower ratio is not worse.

### 14.3 Worked examples

**Example 1 — normal**

```text
Unique content = 3,600 s
Focused study  = 3,600 s
Efficiency = 100 × 3,600 / 3,600 = 100.0%
```

**Example 2 — 2× playback**

```text
Unique content timeline = 3,600 s (one hour of video content)
Focused wall time       = 1,800 s (30 minutes)
Efficiency = 100 × 3,600 / 1,800 = 200.0%
```

This is mathematically valid for a throughput ratio. It is not “200% learning.”

**Example 3 — zero focus**

```text
Unique content = 600 s
Focused study  = 0 s
Efficiency = null (n/a)
```

The UI correctly shows n/a, not infinity or zero.

**Example 4 — aggregate vs mean**

```text
Day 1: 300 s content / 300 s focus = 100%
Day 2: 5,400 s content / 10,800 s focus = 50%

Mean of daily percentages = 75.0%
Aggregate ratio = 5,700 / 11,100 = 51.35%
```

The Efficiency screen uses 51.35%, which is the correct period-level ratio. Arena uses 75%, which is a different, volume-insensitive statistic. This is the clearest illustration of why the two “efficiency” numbers diverge.

**Example 5 — rewatch**

```text
First watch: 1,800 s timeline / 1,800 s focus
Rewatch:    1,800 s timeline / 1,800 s focus
Unique content = 1,800 s (union)
Focused study  = 3,600 s
Efficiency = 50.0%
```

Rewatching lowers throughput because it consumes focus without adding unique coverage. That is defensible for a coverage ratio, but it is not a judgment that the learner learned less.

**Example 6 — missing day**

A day with zero focus is excluded from the daily efficiency series and from Arena eligibility. This avoids dividing by zero, but it also hides content-only days. The UI should show a coverage count so users know how many days are excluded.

### 14.4 Edge cases and invalid values

| Input | Behavior | Assessment |
|---|---|---|
| `focusedSec = 0` | `null` | Correct |
| Negative input | `null` | Correct |
| NaN/Infinity | `null` | Correct |
| Content > 0, focus = 0 | `null` | Correct, but UI must explain |
| Content = 0, focus > 0 | 0% | Correct |
| Content > focus at >1× | >100% | Correct; do not cap silently |
| Overlapping segments | Merged union | Correct |
| Duplicate segment ID | Deduped | Correct |
| Missing segment | Not counted | Correct |
| Manual segment | Included if evidence filter allows | Labeled |
| Estimated focus | Included in “all,” excluded from “verified” | Correct |
| Empty selection | `null` | Correct |
| Entire playlist already complete | Ratio can exceed 100 with extra focus? Content is bounded by coverage, focus can be large → under 100 | Fine |

### 14.5 Biases and gaming opportunities

| Bias / exploit | Effect | Assessment |
|---|---|---|
| Playback speed | Inflates ratio above 100% | Expected; not a quality measure |
| Rewatching | Lowers ratio | Expected for unique throughput |
| Notes/practice | Lowers ratio | Expected; lower is not worse |
| Leaving a video playing | Adds unique coverage without attention | Content telemetry limitation |
| Focus timer idling | Inflates denominator, lowering ratio, but can inflate goals/XP | Not an efficiency exploit, but a data-quality problem |
| Two focus tabs | Inflates denominator; lowers ratio, inflates XP | Data integrity problem |
| Manual completion | Can increase progress without playback | Product-permitted self-report |
| Zero-focus days excluded | Hides days with content but no timer | Presentation bias |
| Scope/evidence filter | Users can select a favorable slice | Transparent filter, not a global score |
| Full-history ratio | One huge old session can dominate | Aggregate is mathematically correct but can be dominated by outliers |

### 14.6 Does it measure efficiency or time accounting?

It measures **content throughput per active timer second**. It does not measure:

- Comprehension.
- Retention.
- Difficulty of the material.
- Quality of note-taking.
- Whether the learner was attentive.
- Whether the video was actually watched rather than playing in the background.

The name “Efficiency” implies a broader judgment than the formula supports. The UI attempts to explain this, which is good, but the label still overclaims.

### 14.7 Playback-adjusted pace

The data model stores `playbackRate` and rate-split segments, so a rate-normalized alternative is technically possible:

```text
Expected playback time = Σ (unique matched content seconds / playback rate)
Playback-adjusted pace (%) = 100 × Expected playback time / Focused study seconds
```

Worked example:

```text
30 min at 2× → 30 / 2 = 15 expected minutes
30 min at 1× → 30 / 1 = 30 expected minutes
Total expected = 45 min
Focus = 60 min
Pace = 75%
```

Raw throughput for the same data = `60 / 60 = 100%`. The adjusted metric answers “how much wall-clock playback did this coverage require?” rather than “how much content was covered per focus second?”

**Validity condition:** the union must be rate-weighted correctly when the same content is watched at different speeds. A naive sum of segment seconds divided by each segment’s rate will double-count overlapping content. A production implementation must:

1. Split timeline coverage into intervals with a single observed rate.
2. Merge overlapping intervals and choose a deterministic rate attribution rule (first observation, fastest observation, or latest observation).
3. Sum the rate-adjusted unique time.
4. Label the rule and version.

Because this is complex and easy to misrepresent, it should be a **secondary experimental metric**, not the primary “Efficiency” number. The existing `playbackUtilization` is simpler and more honest: it compares wall-clock playback to focus without pretending to normalize speed.

### 14.8 Efficiency verdict

The formula is mathematically valid, unit-consistent for a throughput ratio, aggregate-correct, and correctly handles zero denominators and >100%. It is not a learning-quality score, and its name is too broad. The numerator depends on playback telemetry and the denominator depends on timer data with the Focus limitations in Section 12. Do not cap it; rename it and show its components.

---

## 15. Recommended efficiency methodology and UX

### 15.1 Recommended metric set

Keep separate metrics rather than manufacturing a composite:

| Metric | Formula | Purpose | Display |
|---|---|---|---|
| **Learning throughput** | `100 × U / F` | Content timeline covered per active timer second | Primary, with numerator/denominator |
| **Playback utilization** | `100 × activePlaybackWall / F` | How much active playback occurred relative to timer-active time | Secondary, separate |
| **Coverage** | `U` hours, `F` hours, eligible days | Data sufficiency and context | Always visible |
| **Progress** | `completed content / total content` | Playlist completion | Separate from throughput |
| **Consistency** | qualifying days / observed days | Habit signal | Separate, only with sample count |

Do not call any of these “learning quality.” Do not combine them into a single percentage without a product rationale and a visible decomposition.

### 15.2 Rename recommendation

Recommended primary label: **Learning throughput** (or **Content throughput**).

- “Efficiency” may remain as a page title if the subtitle immediately says “unique content per timer-active hour.”
- If the product wants a broader “Efficiency” section, show throughput and utilization as separate cards, not one score.
- Arena should not reuse the word “efficiency” for its new progress/consistency score.

### 15.3 Aggregation rules

- Period-level throughput: ratio of totals, never the mean of daily percentages.
- Daily series: one value per day with `F_d > 0`; show excluded days as gaps, not zero.
- Weekly/monthly: ratio of sums.
- Comparisons: same scope, same evidence filter, same timezone.
- If the evidence filter changes one side, change both sides (already implemented).
- Never compare a verified numerator to an all-evidence denominator.

### 15.4 Confidence and data sufficiency

Show:

- Number of eligible days.
- Total focus hours and unique content hours.
- Number of verified vs self-reported segments.
- “Low sample” when fewer than 3 eligible days or fewer than 60 minutes of focus.
- “Trend unavailable” when either comparison window has fewer than 3 observations.

Do not show a confidence interval unless a sampling model is defined. “Low sample” is a product warning, not statistical certainty.

### 15.5 UX layout

```text
Learning throughput
├─ Big number: 74.1%
├─ Subtitle: 27.0 unique content hours / 36.4 timer-active hours
├─ Evidence chips: Verified 82% · Self-reported 18%
├─ Data sufficiency: 10 eligible days · 3 low-sample warnings?
├─ 14-day trend (gaps for zero-focus days)
├─ Distribution: daily throughput, median, interquartile range
├─ Playback utilization: 68% (separate card)
└─ Explanation: what this measures / does not measure
```

Add a “Why this can exceed 100%” disclosure with the 2× example. Add a “Why a lower number is not worse” disclosure for notes/practice.

### 15.6 Charts and comparisons

- Use a distribution (dot plot or histogram) in addition to the average, so one outlier is visible.
- Show the median and the count; do not imply the mean is typical.
- Personal baseline comparison: last 7 days vs previous 7, with sample counts and a “not enough data” state.
- Outlier flag: a day more than 2 standard deviations from the personal median, labeled as an observation, not a judgment.
- Do not draw a trend line through fewer than 3 observations.
- If zero-focus days are excluded, show a separate “content without focus” count so they are not invisible.
- Make the chart accessible with a data table or text summary.

### 15.7 Contextual feedback

Examples:

- “Your throughput is above 100% because some content was watched faster than 1×.”
- “Throughput fell while focus time rose. That can mean more practice, rewatching, or note-taking, not a worse session.”
- “Only 2 eligible days so far. Treat this as an early signal.”
- “12% of your coverage is self-reported; verified-only view is available.”

Avoid:

- “Your learning efficiency is excellent.”
- “You are 20% better than average.”
- “Low efficiency means low intelligence.”
- Any comparison to other users unless it is the clearly labeled fictional Arena.

### 15.8 Acceptance criteria

- The primary label is “Learning throughput,” and the page explains its numerator and denominator.
- The aggregate ratio is used for all period summaries.
- Zero-focus days are excluded with a visible count, not silently hidden.
- >100% is displayed without clamping and explained.
- The evidence filter applies symmetrically.
- The UI never calls the metric learning quality or concentration.
- Verified/self-reported mix is visible.
- Low-sample warnings appear below the thresholds.
- A chart with fewer than 3 observations does not show a trend line.

---

## 16. Playlist ingestion and duration integrity

### 16.1 Ingestion pipeline

1. The client submits a YouTube URL or playlist ID to `GET /api/playlist?url=...` (or a refresh variant).
2. `parsePlaylistId` accepts a raw ID matching `[A-Za-z0-9_-]{10,64}`, a `youtube.com`/`music.youtube.com`/`youtu.be` URL with a `list` parameter, or a query-string `list=` value.
3. The backend fetches `playlists.list` for title/channel/thumbnail/item count.
4. It rejects a playlist that already reports more than `MAX_ENTRIES = 1000` before paging.
5. It pages `playlistItems.list` at 50 items per page, with a 25-page guard and a 1,000-entry cap.
6. It dedupes video IDs for the `videos.list` request, batches them 50 at a time, and preserves positional entries.
7. Each entry retains its playlist position, video ID, title, thumbnail, published date, and ISO duration or a null duration plus an unresolved reason.
8. The frontend parses ISO-8601 durations to integer seconds with `parseISO8601ToSeconds`; unsupported year/month components are rejected rather than guessed.
9. The frontend computes totals only when every entry duration is resolved. An unresolved duration is **unknown**, not zero.
10. A playlist refresh reconciles stable entry identities and preserves orphaned records for review.

### 16.2 Integrity checks

| Check | Current behavior | Assessment |
|---|---|---|
| Playlist ID validation | Strict regex; host allowlist; `list` parameter | Good |
| Arbitrary URL redirect | Only known YouTube hosts; no fetch of arbitrary URL | Good |
| Item cap | 1,000 entries; early rejection from reported count | Good |
| Paging guard | 25 pages | Good |
| Batch size | 50 for `videos.list` | Good |
| Missing/unavailable video | Entry retained; duration null; unresolved reason if detectable | Good |
| Deleted/private video | Title-based reason where possible; otherwise missing metadata | Partial; YouTube does not always expose a precise reason |
| Duplicate video IDs | Preserved as distinct positions; deduped only for metadata request | Good |
| Ordering | Position preserved; duplicate occurrences distinct | Good |
| ISO duration | Regex supports weeks/days/hours/minutes/seconds; rejects year/month | Good |
| Partial metadata | Null duration; totals withheld | Good |
| Cache | In-memory TTL + LRU, 50 entries default | Good for one process; not shared across instances |
| Retry | 2 retries, exponential backoff/jitter, only 429/5xx/timeouts | Good |
| Quota | 403 quota is non-retryable and surfaced with guidance | Good |
| Refresh | Cache bypass; success-only cache write | Good |
| In-flight dedupe | Keyed by raw input, not canonical playlist ID | Minor duplicate fetch risk |
| Playlist updates | Reconcile by identity; orphans preserved | Good |
| Archive/delete | Archive preserves; permanent delete removes attributable records | Good |

### 16.3 Pitfalls confirmed in source

1. **Incomplete playlist + Arena fallback.** Arena competitors use `n × averageResolvedDuration` when total is null. The user is scored from actual data. This is the playlist-side cause of the Arena fairness defect in Section 9.
2. **Raw-input in-flight key.** The same playlist supplied as a URL and as an ID can trigger two upstream fetches. The cache has separate `raw:` and `id:` keys, but the in-flight map is keyed by raw input only. This is a small quota/performance issue.
3. **Missing duration remains unresolved.** The UI correctly withholds totals, but the user needs a clear route to repair or exclude an unresolved entry. The current unresolved count is shown; a “refresh metadata” action is the natural repair.
4. **Cache is per process.** Multiple Render instances can each fetch the same playlist. There is no shared Redis or CDN cache. At one instance this is fine; at scale it multiplies quota use.
5. **No persistent playlist metadata beyond the snapshot.** If the account has a snapshot, the app can display it offline; a new import needs YouTube.
6. **1000-entry cap is product policy.** It is enforced consistently, but playlists above it cannot be imported at all. The UI should explain the cap before the user waits for a fetch.

### 16.4 Duration math examples

**Complete playlist**

```text
Entries: 600 s, 900 s, 1,200 s
Total = 2,700 s
Completed = 900 s
Count progress = 1/3 = 33.3%
Duration progress = 900/2,700 = 33.3%
```

**Incomplete playlist**

```text
Entries: 600 s, unknown, 1,200 s
Resolved total = 1,800 s
Reported total = null
Duration progress = null (not 1,800 / something)
Count progress can still be computed from completion records.
```

**Duplicate occurrence**

```text
Position 1: video X, 600 s
Position 2: video X, 600 s
Total = 1,200 s
Completing position 1 does not complete position 2.
```

This is correct for playlist occurrence semantics, though users may expect video-level deduplication. The UI should state that duplicate occurrences are distinct learning items.

### 16.5 Playlist verdict

Playlist ingestion is careful, fail-closed, and duration-honest. The main defects are the Arena fallback for incomplete totals and the per-instance cache. Neither requires a redesign of ingestion; both are contained fixes.

---

## 17. Progress/checkpoint/module calculations

### 17.1 Progress definitions

`computePlaylistProgress`:

```text
countPct = 100 × completedCount / n                 (n > 0; else 0)
durationPct = 100 × completedSec / totalSec         only if every duration is known and totalSec > 0
totalSec = null                                     if any duration is unresolved
completedSec = null                                 if any duration is unresolved
```

A record is complete only when it has a completion timestamp and status `done`, is not orphaned, and matches the current entry identity. Notes alone do not count as completion. Verified completion is derived from unique coverage at or above the threshold; manual completion is allowed but labeled.

### 17.2 Identity and reconciliation

- Each playlist occurrence has a stable `entryId` derived from playlist/video identity and position context.
- Progress lookup prefers the direct entry identity, then a legacy compatible key whose `videoId` agrees.
- A refresh can move a video; the record follows identity and is rekeyed.
- A removed video’s record is preserved as an orphan and is not counted for another video.
- Segments and play sessions are reconciled by the same identity rules.
- The code explicitly avoids matching every other course on refresh by requiring playlist scope.

### 17.3 Boundary cases

| Case | Behavior | Assessment |
|---|---|---|
| Empty playlist | `countPct = 0`, `durationPct = null` | Correct; not 100% |
| Zero-duration playlist | `durationPct = null` | Correct; no fabricated 100% |
| Duplicate video occurrences | Separate completion records | Correct for occurrence semantics |
| Moved position | Record follows identity | Good |
| Removed video | Orphan preserved, not counted | Good |
| Manual complete with no playback | Counts as complete, labeled manual | Product decision |
| Verified 90% coverage | Complete at default threshold | Configurable; label threshold |
| Note-only record | Not complete | Correct |
| Missing duration | Totals withheld | Correct |
| Imported legacy record | Compatible key read if video matches | Good with caveat |
| Concurrent device edit | Version conflict, reload required | Safe |
| Rewatch after completion | Does not create a second completion | Correct |
| Reset playlist | Completeness cleared; old orphan records may remain for review | Intended |

### 17.4 Checkpoints and modules

- A checkpoint is a start/end position range with an automatic label and status derived from current completion.
- A module is a named set of positions; module progress counts completed videos and resolves remaining duration only when all member durations are known.
- Range status is recalculated on playlist refresh; stale labels are preserved when edited manually.
- Deleting a playlist removes attributable checkpoints, modules, ranges, goals, sessions, and XP; archiving preserves everything.

Potential issues:

- A checkpoint’s XP award is client-side and is not automatically reversed when the range becomes incomplete after a playlist refresh. The user may keep XP for a checkpoint that is no longer complete. This is a low-stakes reward-integrity issue.
- Module progress can be displayed as a count even when duration totals are unknown; the UI must not present a duration percentage in that case. The underlying `sumEntries` returns `isComplete=false` and `totalSec=null`, which is correct if the UI respects it.
- Orphaned records are preserved but can accumulate. Reports exposes them for review; there is no automatic prune. That is the safer default.

### 17.5 Progress examples

**Example — count vs duration**

```text
Playlist: 3 videos, durations 600, 900, 1,500 s (total 3,000 s)
Completed: video 1 (600 s) and video 3 (1,500 s)
Count = 2/3 = 66.7%
Duration = 2,100/3,000 = 70.0%
```

Both are valid; the UI should label which is which.

**Example — moved video**

```text
Before: position 2, video X
After:  position 5, video X
Progress follows video X, not position 2.
```

**Example — orphan**

```text
Video X removed from playlist.
Its completion record remains orphaned for review.
It is not credited to position 2’s new video Y.
```

### 17.6 Progress verdict

The frontend progress engine is careful and mathematically honest about unknown durations. Its main limitations are that the server does not recompute completion and the client owns the award/rollback semantics. For a personal tracker this is acceptable; for an official competitive rank it is not.

---

## 18. Goals, XP, achievements, and challenges

### 18.1 Goals

- Daily goals store a focus target and a minimum viable target as seconds.
- Flexible goals support metrics such as video count, focus time, content duration, playlist progress, and checkpoint completion.
- Goal progress is computed from real records, scoped by playlist and date where configured.
- Timezone-aware date keys are used for daily boundaries; cross-midnight focus is split by intervals.
- Goals created after a record’s timestamp do not retroactively count that record (`afterCreation` check).

### 18.2 XP rules

| Reason | Points | Dedup key shape |
|---|---:|---|
| Video done | 10 | `done:<playlist>:<entry>` |
| Exercise done | 5 | `ex:<playlist>:<entry>` |
| Code reproduced | 5 | `code:<playlist>:<entry>` |
| Built example | 8 | `built:<playlist>:<entry>` |
| Revision done | 4 | `rev:<playlist>:<entry>:<day>` |
| Checkpoint done | 50 | `cp:<checkpointId>` |
| Focus session | 15 per 30 min, floor | `focus:<clientId>` |
| Study day | 20 | `day:<activityKey>` |
| Achievement | 25 | `ach:<playlist>:<key>` |
| Flexible goal | 30 | `goal:<goalId>` |

`xpForFocusSession` returns `floor(activeSec / 1800) × 15`; a 29-minute session awards zero focus XP. That is a deliberate floor, but it can surprise users. The UI should show the threshold.

### 18.3 Duplicate prevention

Client-side:

- `awardXp` checks `dedupKey` in the current XP array before appending.
- Focus sessions use `clientId`; a second finish with the same timer ID is ignored.
- Revision dedup includes the day key.
- Video completion dedup checks both a new and a legacy key.

Server-side:

- The XP collection validates unique item `id` values within a collection payload.
- The backend does not enforce a unique `(userId, dedupKey)` index.
- A malicious client can submit two XP events with different IDs and different dedup keys, or the same dedup key with a different ID, and the server will store them if the collection payload has no duplicate IDs.
- Optimistic versioning prevents lost updates but not deliberate duplicate appends.

This is **self-manipulation** in a personal tracker, not cross-account fraud. It becomes a real integrity issue only if XP or achievements are used for an official rank, rewards, or public profile.

### 18.4 Achievements

Achievements are evaluated from real records:

- First video, first focus, first checkpoint.
- 5 distinct study days.
- 10 focused hours.
- Halfway by count or duration.
- Course complete.
- 5 revisions.

They are stored as a map keyed by achievement key (and playlist for playlist-specific ones). Evaluation only adds new keys; it does not remove an achievement when the underlying progress is corrected. This is common for achievements, but the product should state whether they are permanent or derived. If they are permanent, do not present them as a live measure of current progress. If they are derived, recompute and allow revocation.

### 18.5 Challenges and rank history

- `challenge` and `challengeEnabled` are persisted account domains.
- Challenge settings are validated: cohort 10–2,000, tier distribution sums to 100, seed integer, window 1–90, cap 1–12 hours.
- Rank history is a manual snapshot: the UI calls `pushRank` only when the user clicks a button. It stores `{at, rank, of, metric}` and keeps the last 100.
- The “of” count uses all rows including provisional rivals, while the rank is among scored rows. This can make a rank look better or worse than its denominator suggests. It is a presentation bug, not a scoring bug.

### 18.6 Findings

| ID | Finding | Severity | Evidence | Classification |
|---|---|---|---|---|
| G-01 | No server-side unique XP ledger; replayed or duplicated client events can inflate XP. | Medium (integrity) | `userData.ts:275–281`; client-only dedup | Confirmed — source |
| G-02 | Achievement awards are never revoked when progress is corrected. | Low | `store.tsx:1040–1070`; only new keys | Confirmed — source |
| G-03 | Checkpoint XP is not reversed when a refresh invalidates the checkpoint. | Low | `store.tsx:1090–1100`; no negative award | Confirmed — source |
| G-04 | Rank snapshot denominator includes provisional rivals. | Low (presentation) | `Competition.tsx:286`; `rankBoard.rows.length` | Confirmed — source |
| G-05 | A 29-minute focus session awards zero focus XP. | Low (UX) | `xpForFocusSession` floor | Confirmed — source |
| G-06 | Timezone boundaries are client-derived and depend on the saved preference; a device with a different local timezone does not change the account preference, which is correct but can confuse. | Low | `dateKeyInTimezone` uses `prefs.timezone` | Confirmed — source |

### 18.7 Recommendations

- Add a server-side `xp_awards` collection with a unique `(userId, dedupKey)` index and immutable award events. The client can still calculate display values, but the server becomes the ledger.
- If XP is only cosmetic, state that clearly and do not use it in any competitive formula.
- Define achievement semantics: permanent badges or live derived milestones. If live, recompute and allow removal.
- Reverse checkpoint XP if the checkpoint becomes invalid, or label XP as “awarded at the time” and never present it as current.
- Fix the rank snapshot denominator to scored rivals only.
- Show the focus XP threshold (“30 minutes earns 15 XP; 29 minutes earns 0”).
- Keep daily boundaries based on the account timezone, not the device timezone, and show the timezone near goal history.

---

## 19. Analytics and charts

### 19.1 Current weekly calculations

Analytics computes a 7-day current window and a 7-day previous window using `calendarWindowDates(7/14, timezone)`:

- `thisWk` = current 7 calendar days including today.
- `lastWkKeys` = the first 7 of the last 14 days.
- Playback is attributed by day using `attributePlaybackByDay` and segment splitting.
- Focus is attributed by `attributeFocusByDay`.
- `contentIn(set)` sums every segment’s `timelineEndSec - timelineStartSec` for every day in the set.
- `focusIn(set)` sums attributed focus seconds.
- Session count includes focus sessions and play sessions with any day slice in the week.
- Average session length combines focus active minutes and playback active minutes.

### 19.2 Confirmed inconsistency

`contentIn` sums raw segment lengths. It does **not** merge overlapping segments or deduplicate by entry. Therefore it counts rewatches and overlapping telemetry as additional “content.” The insight text at `insights.ts:33–34` says:

> “Recorded study time increased while **unique content coverage** stayed similar…”

But the input is total content, not unique coverage. The label and the math disagree. A user can rewatch the same video for an hour and see “more content” even though unique coverage did not increase.

### 19.3 Other analytics findings

| ID | Finding | Severity | Evidence | Classification |
|---|---|---|---|---|
| A-01 | Weekly “content” is total segment seconds including rewatches, while insight copy says unique coverage. | Medium | `Analytics.tsx:44–50`, `insights.ts:33–34` | Confirmed — source |
| A-02 | “Average session” mixes focus sessions and playback sessions, which are different activities. | Low/Medium | `Analytics.tsx:62–66` | Confirmed — source |
| A-03 | A playback session spanning midnight is counted once if any slice is in the week, not fractionally. | Low | `Analytics.tsx:53–61` | Confirmed — source |
| A-04 | Zero-focus days are gaps in the efficiency series and excluded from Arena; content-only days can disappear from habit metrics. | Medium | `eligibleDailyEfficiencies`; daily series | Confirmed — source |
| A-05 | Charts do not provide a tabular/text alternative for screen readers. | Medium (accessibility) | Recharts SVG; no table fallback found | Confirmed — source |
| A-06 | The weekly insight can say “steady week” when only one side has data, because the fallback runs when no other insight matches. | Low | `insights.ts:45–47` | Potential risk |
| A-07 | The analytics “verified/manual” counts are based on completion records, not the evidence mix of the underlying segments/sessions used in the weekly totals. | Low | `Analytics.tsx:31–39` vs 44–50 | Confirmed — source |
| A-08 | No cross-check exists between frontend analytics and a backend calculation, because the backend does not calculate analytics. | Medium (architecture) | No server domain engine | Confirmed — source |

### 19.4 Worked example: rewatch inflation

```text
Video length: 1,800 s
Watch 1: 1,800 s timeline
Watch 2: 1,800 s timeline
Unique coverage: 1,800 s
Total content (current weekly calculation): 3,600 s
```

The Efficiency screen shows 1,800 unique seconds. Analytics shows 3,600 “content” seconds. Both can be correct for their definitions, but the insight’s “unique” wording is false.

### 19.5 Recommendations

- Decide the weekly content metric:
  - **Unique coverage**: merge intervals by stable entry identity; label “unique content.”
  - **Total watched content**: keep raw sum; label “watched content (including rewatches).”
- Do not use the word “unique” unless the union is computed.
- Separate focus-session average from playback-session average; or show both distributions.
- Count a cross-midnight session per day slice, with a clear rule.
- Show zero-focus days as “content without focus” rather than hiding them.
- Add a data table toggle for charts, and `aria-label`/summary text for each chart.
- Add a low-sample state for weekly comparisons; do not claim a trend from one observation.
- If analytics ever become authoritative, move the aggregation into a shared domain module used by client and server tests.

---

## 20. Cloud persistence and multi-device data, including Legacy-vs-Unified storage

### 20.1 What is persisted

Cloud mode sends 20 collections through `CLOUD_COLLECTIONS`:

```text
playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions,
goals, xp, achievements, segments, playSessions, queue, flexGoals, challenge,
challengeEnabled, rankHistory, settings, prefs
```

All 20 are account-owned and stored server-side in the selected learning-data backend. Account identity, sessions, action tokens, OAuth states, migrations, state versions, deletion jobs, fences, and rate limits are separate operational collections.

What remains browser-local in cloud mode:

- Focus recovery snapshot (`lq-focus-timer-v1`).
- UI collapse preference (`lq-nav-collapsed`).
- Legacy-claim marker (`lq-legacy-claim-v1`).
- The auth-sync signal (transient).

Cloud mode does not write IndexedDB. Local mode writes IndexedDB and is used by tests/development; it is not an offline mirror of the cloud account.

### 20.2 Legacy architecture

Legacy selects **20 per-domain MongoDB collections**: `lq_data_playlists`, `lq_data_meta`, ..., `lq_data_activeId`.

| Aspect | Assessment |
|---|---|
| Collection separation | Clear; one domain per collection |
| Document model | One document per `(userId, key)`; map/singleton/array shapes are flattened into records |
| Indexes | Unique `{userId, key}` per collection; playlist/order indexes for high-volume domains |
| Read path | `readUserState` issues 20 concurrent domain queries plus a version read |
| Write path | Replace one collection: read previous rows, deleteMany, insert each row, rollback on failure, inside a transaction |
| Transactions | Required for replace; fail closed if the adapter cannot transact |
| Consistency | Version document + per-collection transaction; no cross-collection atomicity for a single collection write |
| Account deletion | `ACCOUNT_SCOPED_COLLECTIONS` covers every legacy collection and the unified collection |
| Import/restore | Replaces all 20 collections in one transaction (8 MB state cap) |
| Concurrency | Optimistic version; one writer wins, others get `VERSION_CONFLICT` |
| Performance | Many collections but concurrent reads; 20 index families; simple per-domain queries |
| Operational complexity | More collections to index, back up, inspect, and retire |
| Long-term maintainability | Domain isolation is clear, but adding a domain means adding a collection and index |

Legacy strengths: simple query shapes, isolated collections, easy per-domain inspection, bounded document size, and mature deletion/migration coverage. Legacy weaknesses: more collection/index sprawl, 20-query reads, and a multi-collection transaction for full-state import.

### 20.3 Unified architecture

Unified selects **one collection**, `lq_user_data`. It does **not** store one giant user document. Each record is:

```json
{
  "userId": "...",
  "domain": "progress",
  "key": "<stable record key>",
  "value": { "...": "..." },
  "playlistId": "...",
  "updatedAt": "...",
  "order": 0,
  "version": 3
}
```

The repository adapter adds `domain` to every query and update, strips it from returned records, and requires `userId` and `key` on insert. Callers see the same per-domain interface as Legacy.

| Aspect | Assessment |
|---|---|
| Schema | One document per `(userId, domain, key)`, not one giant document |
| Document growth | Bounded by the largest single record, not the account; no 16 MB account-document risk |
| Indexes | Unique `{userId, domain, key}`; `{userId, domain, playlistId}`; `{userId, domain, order}` |
| Read path | Same 20 queries, each with an extra `domain` predicate; prefix index supports them |
| Write path | Same per-domain replace semantics; deleteMany scoped by `{userId, domain}` |
| Contention | One physical collection, but MongoDB concurrency is per document; different users/domains do not block each other |
| Atomicity | Same transaction requirement; one collection rewrite still touches many documents |
| Partial updates | Repository still replaces a whole domain; no per-item patch API |
| Account deletion | Both legacy and unified collections are in the deletion scope; playlist purge deletes both |
| Import/restore | Same 20-domain transaction; same 8 MB cap |
| Performance | Comparable query selectivity; larger physical collection and index, but prefix indexes are efficient |
| Operational complexity | One collection to back up/index/inspect; simpler long-term |
| Risks | Mode switch without migration shows empty data (no fallback); one collection is a single blast radius; destination-only records can be stale |

Unified strengths: simpler physical layout, one collection to manage, bounded documents, same repository contract, and no giant-document write bottleneck. Unified weaknesses: a single collection concentrates backup/restore and index maintenance; adding a domain does not require a new collection but does require index awareness; the cutover is operationally riskier because the data must be copied.

### 20.4 Which modules read/write each structure

| Module | Access | Notes |
|---|---|---|
| `services/userData.ts` | `store.domainData` | Main read/write/import/delete path |
| `routes/account.ts` | `readUserState`, `replaceUserCollection`, `replaceAllUserState` | Account data/import/migrate/export |
| `routes/playlists.ts` | `domainData` | Playlist summary/archive/restore |
| `routes/auth.ts` | `accounts`, `sessions`, actions | Not learning-data mode-specific |
| `services/userDataMigration.ts` | `store.data` for legacy source, `store.userData` for destination | Explicitly bypasses the active adapter because it must read the legacy source |
| `services/legacyRetirement.ts` | `store.data`/`adapter.collection` | Explicit legacy inspection/drop |
| `services/accountDeletion.ts` | `adapter.collection` over `ACCOUNT_SCOPED_COLLECTIONS` | Deletes both layouts |
| `services/userData.ts:deleteAllUserData` | `store.data` + `store.domainData` + `store.userData` | Deliberate dual delete for safety |

No unintended bypass was found. The migration and retirement modules intentionally use the legacy source because their job is to inspect or retire it.

### 20.5 Migration and cutover behavior

`userDataMigration.ts` provides:

- Deterministic dry-run (`inspectUserDataMigration`) with source/destination counts and checksums.
- Per-record validation: ownership, key, value, updatedAt, playlistId, order, version.
- Duplicate detection on both source and destination.
- Conflict detection: if a destination key has a different checksum, the run is blocked and the destination is never overwritten.
- Destination-only records: reported as a warning, not deleted or overwritten.
- Account safety: missing/inactive/deleting accounts and deletion jobs block migration.
- Idempotent apply: inserts only missing keys; exact matches are skipped; duplicate-key races are rechecked.
- Post-copy verification: every valid source key must be present with an identical checksum, and the source counts/checksum must be stable during the run.
- No source document is modified or deleted.

This is good migration engineering. The gaps are operational, not sloppy code:

1. **Snapshot, not change capture.** The apply copies a snapshot. Writes to legacy after the post-copy verification are not copied. If the app is still writing legacy until the environment switch, data is lost from the active Unified view.
2. **No reverse migration.** Legacy collections remain for rollback, but a Unified-era write cannot be copied back automatically. A rollback after cutover would lose new writes unless a reverse tool or backup restore is used.
3. **Destination-only records need review.** They are not necessarily stale, but they may be test data, an earlier partial migration, or records from a different version. A warning is not a decision.
4. **Conflict resolution is manual.** The tool blocks; it does not choose a winner. That is the right safety default, but the operator needs a documented reconciliation procedure.
5. **Backup confirmation is an assertion.** Retirement accepts `--backup-confirmed` but cannot verify the backup. The operator must independently restore-test it.
6. **Retirement live check is good.** It requires a verified artifact, a live inspection with zero pending/conflicts, a source checksum match, `LQ_USER_DATA_STORE=unified`, the cutover acknowledgement, and the exact phrase `RETIRE LEGACY LQ_DATA`. It drops only legacy learning collections, never accounts, sessions, tokens, or `lq_user_data`.

### 20.6 Legacy vs Unified comparison

| Dimension | Legacy | Unified | Winner |
|---|---|---|---|
| Correctness / data safety | Mature; many collections | Same repository semantics; cutover risk | Legacy today |
| Read performance | 20 concurrent simple queries | 20 concurrent prefix-indexed queries | Comparable |
| Write performance | Per-domain collection rewrite | Per-domain documents in one collection | Comparable; Unified slightly more index overhead |
| Scalability | 20 collections/index families | One collection, bounded docs | Unified long-term |
| Concurrency | Optimistic version + transactions | Same | Tie |
| Security | userId scoping + repository guard | Same + domain guard | Tie |
| Maintainability | More collections | One collection | Unified |
| Operational complexity | More collections to manage | One collection, but riskier migration | Unified after cutover |
| Migration risk | N/A | Snapshot/freeze/reverse gaps | Legacy today |
| Rollback | N/A | Legacy retained, but no reverse copy | Legacy today |
| Testing | Broad existing coverage | Strong migration/unified tests, less production history | Legacy today |

### 20.7 Storage verdict and blockers

**Direct verdict: `NOT READY — SPECIFIC BLOCKERS` for a production Unified cutover. `SAFE TO RETAIN LEGACY` is the current operating position.**

Blockers:

| # | Blocker | Why it matters | Required before cutover |
|---:|---|---|---|
| ST-1 | No write freeze or change capture | Writes after the migration snapshot are not in Unified | Maintenance window with writes disabled, or a change-log/outbox |
| ST-2 | No reverse migration | Rollback after Unified writes loses those writes | Reverse tool or restore drill with a defined recovery point |
| ST-3 | No verified backup/restore drill | `--backup-confirmed` is an assertion | Independent backup, restore to staging, checksum comparison |
| ST-4 | Destination-only records need reconciliation | They become visible after cutover and may be stale | Per-user review or an explicit accepted-list |
| ST-5 | No staging run on a production-like copy | Tests use in-memory/mock data | Full staging migration + parity reads/writes + deletion test |
| ST-6 | No production deployment verification | Source passing does not prove the deployed mode | Deploy check, `/api/ready`, session/data smoke, mode log |
| ST-7 | Large-account/transaction limits unproven | 8 MB body and whole-collection transactions | Large-account fixtures, transaction timing, body-limit tests |

**Controlled staging is conditionally allowed** after ST-1 through ST-5 are satisfied for an isolated staging database. **Production cutover is not allowed today.**

### 20.8 Target architecture and staged cutover plan

**Target:** keep the repository contract and the per-record Unified schema. It is a sound long-term layout. Do not introduce dual-write as a permanent architecture; it doubles failure modes and creates two truths. Use a maintenance window for the first cutover, then version the migration for future changes.

**Stage 0 — Baseline and backup**

- Freeze schema/code changes that affect user data.
- Take a full MongoDB backup; restore it to an isolated staging database; verify account counts and a sample of each domain.
- Record collection counts, index definitions, and a checksum of canonical records.
- Do not change `LQ_USER_DATA_STORE`.

**Stage 1 — Staging migration**

- Point a staging backend at the restored copy with `LQ_USER_DATA_STORE=legacy`.
- Run `inspect:user-data` with `--store both` (read-only) and review every conflict/destination-only record.
- Run `migrate:user-data --apply --out <artifact>` against staging.
- Verify `applied and verified`, zero pending, checksums match, source unchanged.
- Switch staging to `unified` with the cutover acknowledgement.
- Run parity tests: read all 20 domains, compare counts/values to legacy, write a test account, restart, read again, delete the test account, verify residue zero.
- Run a rollback drill before any production step.

**Stage 2 — Production maintenance window**

- Announce a write freeze. Disable account data writes at the edge or put the app in read-only/maintenance mode. Reads may continue.
- Confirm no in-flight writes remain; wait for the write lease/drain.
- Run a final dry-run; require zero pending/conflicts and a stable source checksum.
- Take a fresh backup immediately before apply.
- Apply migration; capture the artifact.
- Switch `LQ_USER_DATA_STORE=unified` plus `LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1`.
- Restart/redeploy; verify `/api/ready`, login, read, write, export, delete on an isolated test account.
- Unfreeze writes only after smoke tests pass.

**Stage 3 — Observation and rollback window**

- Keep legacy collections untouched for at least 30 days or one full usage cycle.
- Monitor read/write errors, version conflicts, duplicate-key errors, latency, and account-deletion residue.
- Record a rollback decision point. If rollback is required before any Unified-era write, switch back to legacy. If after, restore the pre-cutover backup and replay/accept the lost window explicitly.
- Do not run retirement during the observation window.

**Stage 4 — Retirement (only after acceptance)**

- Run `inspect:legacy-data` with the verified artifact; require zero blockers.
- Take and restore-test a final backup.
- Run `retire:legacy-data --apply --backup-confirmed --confirm "RETIRE LEGACY LQ_DATA"`.
- Verify `lq_user_data`, accounts, sessions, tokens, and operational collections remain.
- Keep the final backup according to retention policy.

**Acceptance criteria:**

- Zero pending/conflict/invalid records at cutover.
- Source checksum equals the verified artifact.
- All 20 domains read identical values before/after (normalized for timestamps/order).
- A test account can register, write, read on a second device, export, and delete with zero residue.
- Rollback drill succeeds from backup.
- No production error-rate or latency regression outside an agreed threshold.
- Legacy retirement is a separate, owner-approved action after the observation window.

---

## 21. Frontend quality and accessibility, including microcopy audit

### 21.1 Design consistency

The UI uses a coherent set of primitives (`Card`, `Btn`, `Field`, `Empty`, `Dropdown`, `NumberField`, dialogs, charts) and a consistent dark surface. Navigation is grouped into Learn / Plan / Insights / Manage. Lazy loading keeps chart-heavy routes out of the initial shell. The account shell, recovery screens, and migration card are visually distinct without feeling like a different product.

Strengths:

- Consistent spacing, cards, and control styles.
- Clear active-tab treatment and mobile drawer with focus trapping.
- Explicit empty states rather than blank screens.
- Loading and error states for account data.
- A global save indicator with retry/reload actions.
- Method explanations are present where the numbers are unusual (efficiency, Arena, focus timing).

### 21.2 Navigation and information hierarchy

- The hash-based route model is simple and works without a router dependency.
- Account sections (`profile`, `settings`, `security`) are reachable from the account menu and preserve focus behavior.
- The public recovery/verification screens are standalone and do not inherit the authenticated shell.
- Arena is in “Manage” rather than “Insights,” which fits its optional simulation status.
- Reports is in “Manage,” which is appropriate for backup/restore.

Potential improvements:

- The active playlist is a global context but is not always visible in the header; a persistent playlist chip would reduce “which course am I editing?” errors.
- Arena and Efficiency both use the word “efficiency” for different models; renaming will reduce confusion.
- The Account page is long; consider anchored sections or a two-column layout on desktop. This is a P2/P3 improvement, not a defect.

### 21.3 Forms, loading, errors, and empty states

- Numeric fields reject empty/invalid values before saving.
- Dialogs use typed-title confirmation for destructive playlist/account actions.
- Account data load failure is treated as a failure, not an empty account.
- A malformed account payload produces an integrity error, not defaults.
- The save indicator distinguishes saving, saved, error, and conflict.
- A version conflict tells the user to reload rather than silently overwriting.

Gaps:

- Some errors expose deployment/backend phrasing (see 21.5).
- Offline cloud saves have no automatic retry queue; the user must press retry.
- The focus recovery notice is transient; a persistent recovery card would be clearer.
- Chart loading/empty states are inconsistent across sections.

### 21.4 Accessibility

What exists:

- Focus trapping and focus return in the mobile drawer and dialogs.
- `aria-live` on status regions, with the ticking timer deliberately `aria-live="off"`.
- Semantic buttons and labels in most forms.
- Reduced-motion preference honored in some animation paths.
- Dialog accessibility tests.

Gaps:

- No automated axe/accessibility test suite.
- Recharts SVG charts lack a complete tabular/text alternative.
- Color contrast of small `text-slate-500` copy on dark surfaces is not verified.
- Some icon-only controls may rely on `title` rather than an accessible name.
- The Arena leaderboard’s visual rank movement needs a text equivalent.
- Keyboard testing across all routes is not automated.

### 21.5 Microcopy audit

The audit distinguishes:

- **Operational microcopy:** loading, buttons, transient status, errors, routine UI.
- **Contextual help:** explanations that teach a feature or methodology.
- **Developer-facing explanation:** internal storage/API/deployment details that do not help the user.

#### Priority table

| # | Exact current wording | Page / source | Problem | Recommendation | Proposed replacement | Belongs in |
|---:|---|---|---|---|---|---|
| M-01 | “Learning data is loaded from the server; the browser is not used as an authoritative store.” | Cloud loading screen, `store.tsx:1856–1857` | Exposes internal architecture on a routine loading screen; the heading already says “Connecting to your LearnQuest account…” | **REMOVE** | None; keep only “Connecting to your LearnQuest account…” | Normal UI (remove) |
| M-02 | “Learning records, progress, notes, focus history, and preferences live in this browser's IndexedDB. The small localStorage keys used here are UI preferences … and an interrupted-focus recovery snapshot … they never leave the device. CSV/JSON exports are created locally, and the backend proxy receives only the playlist URL/ID you request.” | Settings → “Local data & privacy,” `Settings.tsx:90–97` | False in cloud mode: records are stored in MongoDB and synced to the account. Also overloaded with implementation details. | **REWRITE** with mode-aware copy | Cloud: “Your learning data is saved to your LearnQuest account. This browser keeps only UI preferences and a temporary focus-recovery snapshot. Exports are created on your device.” Local: “Learning data is stored in this browser. Export a backup before clearing browser data.” | Normal UI + privacy |
| M-03 | “The server is verifying the link before showing the password form. Nothing has changed yet.” | Password reset, `AuthScreens.tsx:476` | “Server” is internal; the sentence is longer than needed. | **SHORTEN** | “Checking this link…” | Normal UI |
| M-04 | “This link was verified by the server. It expires in …” | Password reset, `AuthScreens.tsx:507` | Exposes server verification detail; “verified” can sound like the password is already changed. | **REWRITE** | “This link is valid for … and can be used once.” | Normal UI |
| M-05 | “This password reset link is missing its token.” / “This email verification link is missing its token.” | Recovery screens, `AuthScreens.tsx:362, 541` | “Token” is developer vocabulary. | **REWRITE** | “This link is incomplete. Request a new one.” | Normal UI |
| M-06 | “The account service returned an incompatible configuration response (…). Deploy the matching frontend and backend versions, then retry.” | API validation, `authApi.ts:152, 163, 183` | Instructions to “deploy” are for operators, not users. | **REWRITE** for users; keep detail in logs | “LearnQuest is updating. Refresh in a moment. If this continues, contact the administrator.” | Normal UI; technical detail in developer docs/logs |
| M-07 | “The account service reported a session without a complete profile or security token. Sign in again after the deployment finishes.” | API validation, `authApi.ts:249` | Deployment and security-token internals; tells the user to wait for an unknown process. | **REWRITE** | “Your session could not be verified. Sign in again.” | Normal UI |
| M-08 | “These belong to your account and are stored on the server, not only in this browser.” | Account profile, `Account.tsx:220` | “Server” is internal; the contrast with the browser is unnecessary. | **SHORTEN** | “These are saved to your LearnQuest account.” | Normal UI |
| M-09 | “Cloud saves confirmed” | Account status, `Account.tsx:55` | Inconsistent with the global “Saved” indicator; “cloud” is architecture. | **REWRITE** | “Saved” | Normal UI |
| M-10 | “Refreshed … (served from cache)” / “fresh from YouTube” | Reports import message, `Reports.tsx:44` | Cache/provider details are useful for debugging but noisy for normal use. | **SHORTEN**; keep details in an advanced log | “Refreshed <title> (N videos).” / “Added <title> (N videos).” | Normal UI; details in advanced/debug |
| M-11 | “This account uses Google sign-in. Deletion requires a fresh Google authentication within the server's recent-auth window.” | Account deletion, `Account.tsx:365` | “Server's recent-auth window” is internal. | **REWRITE** | “For security, sign in with Google again before deleting your account.” | Normal UI |
| M-12 | “Active time excludes pauses. Wall time … The timer auto-pauses when this tab is hidden; only real active intervals are saved.” | Focus, `Focus.tsx:319` | Mostly useful contextual help; “real active intervals” slightly overclaims attention. | **KEEP with wording tweak** | “Pauses are excluded. Wall time … The timer pauses when this tab is hidden. Active intervals are saved; this measures timer-active time, not attention.” | Contextual help |
| M-13 | “A manual correction is saved as an estimated session and is never presented as player-verified playback.” | Focus, `Focus.tsx:349` | Good transparency; slightly technical but decision-relevant. | **KEEP** | Same, or “Manual corrections are labeled estimated.” | Contextual help |
| M-14 | “FICTIONAL SIMULATION — all … opponents are generated locally from seed … No real people, no real leaderboard.” | Arena, `Competition.tsx:159` | Essential integrity disclosure. Do not remove. | **KEEP** | Same, plus “Practice simulation” when applicable | Contextual help |
| M-15 | “Ranked by average daily content efficiency … total hours, videos, XP, and tier never affect rank.” | Arena, `Competition.tsx:176` | Accurate for the current model, but the model is being replaced. | **REWRITE after Arena v2** | “Ranked by progress (75%) and consistency (25%). Hours, XP, and tier do not affect your score.” | Contextual help |
| M-16 | “Content efficiency = unique content ÷ focused study × 100 … Over 100% is normal above 1× speed; lower is not worse…” | Efficiency, `Efficiency.tsx:166–171` | Mathematically honest and useful. Keep, but rename the metric. | **KEEP / RENAME** | “Learning throughput = unique content ÷ timer-active study × 100…” | Contextual help |
| M-17 | “Local test mode: progress lives in this browser (IndexedDB)…” | App shell, `App.tsx:561–563` | Developer-facing; only relevant in local/test mode. | **MOVE** to developer documentation or a debug badge | “Local mode” (small badge) | Developer-facing |
| M-18 | “The server could not confirm sign-out. Your session may still be active; reload and sign out again.” | Sign-out failure, `store.tsx:1219` | Technical but security-actionable. | **KEEP**, optionally shorten | “We couldn’t confirm sign-out. Your session may still be active. Reload and try again.” | Normal UI |
| M-19 | “This browser has unclaimed legacy data. Importing is an explicit choice… Existing cloud records win on identical IDs…” | Legacy migration card, `LegacyMigrationCard.tsx:81–82` | Long and technical, but this is a consequential merge decision; detail is justified. | **KEEP / COLLAPSE DETAILS** | Keep headline; put ID/merge rules under “What happens to duplicates?” | Contextual help |
| M-20 | YouTube API setup instructions (`Google Cloud project`, `backend/.env`, API key restrictions) | Settings, `Settings.tsx:31–39` | Developer/operator instructions in a user app. | **KEEP only in an advanced/admin setup panel**; do not show to ordinary cloud users | “Playlist import is not configured. Ask the administrator.” + expandable admin steps | Developer/operator help |

#### Microcopy priorities

- **P1:** M-01 (remove), M-02 (false privacy statement), M-06/M-07 (deployment language shown to users).
- **P2:** M-03/M-04/M-05/M-08/M-09/M-10/M-11.
- **P3:** M-12/M-15/M-17/M-19/M-20 refinements.

Do not shorten M-14 or M-16 merely to reduce verbosity; they carry integrity/methodology meaning. Do not remove Arena, Efficiency, Modules, Revision, or learning explanations as a blanket “de-clutter” measure.

### 21.6 Responsive and mobile behavior

- The shell collapses to a drawer with focus trapping.
- Charts use responsive containers and min-width handling.
- The Arena table is horizontally bounded and paginated; on mobile it should keep the user row visible.
- Long account forms stack correctly.
- Touch targets are generally adequate, but icon-only controls need review.

### 21.7 Frontend performance observations

Measured build artifacts (not runtime latency):

- Main entry chunk: ~408 KB.
- Chart vendor chunk: ~376 KB.
- CSS: ~46 KB.
- Several route chunks: 12–27 KB.

Chart routes are lazy-loaded, which is the right choice. The initial shell still carries React, the shell, and the store. Recharts is the largest single vendor cost. No performance profile or real-device measurement was performed.

---

## 22. Backend architecture and quality

### 22.1 Structure

```text
backend/src
├─ server.ts            startup, readiness supervisor, shutdown, maintenance
├─ app.ts               Express composition, security middleware, routers
├─ config/env.ts        validated environment + production assertions
├─ auth/                accounts, sessions, crypto, middleware, OAuth, leases
├─ routes/              auth, account, playlist, playlist management
├─ services/            user data, migration, deletion, retention, email
├─ db/                  Mongo adapter, supervisor, readiness
├─ middleware/          rate limit, errors, readiness
├─ cache/               bounded in-memory playlist cache
└─ scripts/             migrate, inspect, diagnose, retire
```

### 22.2 Strengths

| Area | Assessment |
|---|---|
| Separation of concerns | Routes are thin; services own domain operations; store owns persistence selection |
| Validation | Zod on request bodies; repository validators on every learning domain |
| Authorization | Every account query is scoped by authenticated `userId`; no client-supplied owner ID |
| Atomicity | Per-collection transactions; fail closed if transactions are unavailable |
| Optimistic concurrency | Compare-and-set state version; explicit conflict code |
| Idempotency | Migration marker and per-record checksum; focus client IDs; deletion saga |
| Rate limiting | Shared MongoDB-backed limiter for auth/email; global API limiter |
| Fail-closed startup | Production config assertions; readiness gate; MongoDB supervisor |
| Shutdown | SIGTERM/SIGINT close server, stop supervisor, close Mongo |
| Maintenance | Periodic expired security-record purge; startup deletion/fence recovery |
| Error handling | Central error handler; no stack traces to clients; sanitized logs |
| Testing | 25 backend files/201 tests, including migration, deletion, auth, origins, rate limits |

### 22.3 API contract summary

| Route | Auth | CSRF | Purpose |
|---|---|---|---|
| `GET /api/auth/config` | Public | No | Public setup status |
| `GET /api/auth/session` | Cookie optional | No | Session/user/CSRF status |
| `POST /api/auth/login` | Public | No (origin + JSON + limiter) | Password login |
| `GET /api/auth/google/start` | Public | No | Start OAuth with browser binding |
| `GET /api/auth/google/callback` | OAuth state + binding | No | Complete OAuth |
| `POST /api/auth/logout` | Cookie optional | No | Revoke current session, clear cookie |
| `POST /api/auth/logout-all` | Yes | Yes | Revoke every session |
| `POST /api/auth/reauth` | Yes | Yes | Mark recent authentication |
| `POST /api/auth/password/change` | Yes | Yes + recent | Change password, rotate session |
| `POST /api/auth/forgot` | Public | No | Generic reset-link request |
| `POST /api/auth/password/reset/validate` | Public | No | Read-only token validation |
| `POST /api/auth/password/reset` | Public | No | Consume token, reset, revoke all |
| `GET /api/account/data` | Yes | No | Read all 20 domains + version |
| `PUT /api/account/data/:collection` | Yes | Yes | Replace one domain |
| `POST /api/account/import` | Yes | Yes | Replace all domains |
| `POST /api/account/migrate` | Yes | Yes | Idempotent local merge |
| `GET /api/account/export` | Yes | No | Full export |
| `GET /api/account/sessions` | Yes | No | List active sessions |
| `DELETE /api/account/sessions/:id` | Yes | Yes | Revoke one session |
| `POST /api/account/email/change` | Yes | Yes + recent | Request email change |
| `POST /api/account/email/confirm` | Public token | No | Consume email change |
| `POST /api/account/delete` | Yes | Yes + recent | Delete account saga |
| `GET /api/playlist` | Public (global limiter) | No | Fetch/normalize playlist |
| `GET /api/health`, `/api/ready` | Public | No | Liveness/readiness |
| `GET /api/cache` | Public | No | Cache stats only |

### 22.4 Gaps and technical debt

| ID | Gap | Impact | Recommended direction |
|---|---|---|---|
| B-01 | No server-side domain engine | Cannot independently verify progress, XP, efficiency, or Arena | Keep client for personal views; add server recomputation for any official rank |
| B-02 | Whole-collection replacement | Large payloads and write amplification | Add per-item delta/append endpoints for segments/sessions; keep full replace for import |
| B-03 | No pagination on account data | Large histories are loaded in full | Server-side pagination/summary endpoints; lazy-load history |
| B-04 | 20-query state read | Latency grows with database RTT | Consider a read-model cache or parallel batching (already parallel); measure first |
| B-05 | Session touch on every request | Mongo write per authenticated request | Throttle idle touch to once per 5 minutes |
| B-06 | In-memory playlist cache | Duplicate upstream fetches across instances | Shared cache only if scale requires it |
| B-07 | No structured audit/metrics store | Incident reconstruction relies on logs | Add structured security events and counters |
| B-08 | Migration is snapshot-only | Cutover requires a freeze | Add a freeze/change-capture runbook; reverse migration |
| B-09 | `overallEfficiency` is production-dead code | Duplicate formula, test-only | Remove or use it consistently |
| B-10 | `deleteAllUserData` dual-deletes both stores | Safe but redundant in legacy mode | Keep for safety; document the reason |

### 22.5 Backend verdict

The backend is above average for this class of application: narrow routes, explicit validation, real authorization boundaries, transactional writes, fail-closed readiness, deletion safety, and meaningful tests. Its limits are architectural rather than sloppy: it is a persistence and auth authority, not a learning-domain authority, and its write model is optimized for correctness/simplicity over large histories.

---

## 23. Security threat model

### 23.1 Threat table

| # | Threat | Existing mitigation | Effectiveness in actual code | Remaining gap | Severity | Evidence |
|---:|---|---|---|---|---|---|
| T-01 | Account takeover by password guessing | Argon2id, generic errors, shared login limiter, dummy hash for unknown users | Effective | Rate limit tuning and credential-stuffing monitoring are operational | Medium | Source/test |
| T-02 | Session theft via JavaScript | HttpOnly cookie; token not in storage; CSP | Effective for non-XSS theft | XSS would still allow authenticated actions | High if XSS | Source |
| T-03 | Session replay | Random 32-byte token; HMAC digest; HTTPS expectation; rotation on login | Effective | No device binding (not required) | Medium | Source |
| T-04 | Session fixation | Rotate on login/onboarding; old token revoked | Effective | In-flight request race is inherent | Low | Source/test |
| T-05 | CSRF | Separate per-session token; `X-CSRF-Token`; origin allowlist; SameSite=Lax; JSON bodies | Effective | Login/logout are not CSRF-token protected but origin + JSON/SameSite constrain them | Low | Source/test |
| T-06 | OAuth login CSRF / mix-up | State digest, browser-binding cookie, separate login/register intents, verified email | Effective | Live Google dashboard configuration not verified here | Low/Medium | Source/test |
| T-07 | Cross-account IDOR | Every query scoped by authenticated `userId`; repository domain scoping | Effective | Cross-tab stale identity can display the new account, not bypass server ownership | Medium | Source/test |
| T-08 | Password-reset abuse / enumeration | Generic responses, purpose-bound single-use tokens, expiry, cooldown, rate limit, revoke-all | Effective | Email provider deliverability/IP authorization remains external | Low | Source/test |
| T-09 | Email enumeration via login/forgot | Generic credentials message; generic forgot response; dummy hash | Effective | Timing differences are reduced but not formally measured | Low | Source |
| T-10 | Rate-limit evasion | Shared Mongo limiter across instances; keyed by hashed IP/identifier | Effective at one trust boundary | Distributed botnets and proxy hops remain operational risks | Medium | Source/test |
| T-11 | API key / Mongo credential exposure | Server-only env; no secrets in frontend bundle; CSP; redacted diagnostics | Effective in source | Live env/dashboard not inspected | High if misconfigured | Source |
| T-12 | Injection | Parameterized Mongo adapter; Zod validation; no raw SQL; no shell interpolation in request path | Effective | No live penetration test | Low | Source |
| T-13 | Open redirect | Google callback redirects to fixed `appOrigin`; no arbitrary return URL | Effective | `APP_ORIGIN` misconfiguration is a deployment risk | Low | Source |
| T-14 | Malicious import / resource exhaustion | 8 MB body cap, per-domain item limits, validation, transaction, 1,000 playlist cap | Partially effective | Large valid histories can exceed transaction/body limits; no per-account quota beyond limits | High (availability) | Source |
| T-15 | Data corruption from races | Optimistic version, write lease, transactions, idempotency | Effective for app writes | No crash-consistency test under real Mongo failover | Medium | Source/test |
| T-16 | Account deletion failure | Fenced saga, writer drain, scoped delete, verification, resumable job | Effective | Backup/restore and production failure injection untested | Medium | Source/test |
| T-17 | Stale private UI after revocation | Server rejects next request; local sign-out clears | Partially effective | No remote push/heartbeat; cached UI remains | High (privacy) | Source |
| T-18 | Cross-account tab contamination | Cookie rotation + CSRF; local sign-out sync | Partially effective | No sign-in broadcast, no userId assertion on data | High (privacy) | Source |
| T-19 | Focus data fabrication | Client timer; server shape validation only | Weak | Clock jump, sleep, multi-tab, replay; no cross-field validation | Medium (integrity) | Source |
| T-20 | XP/achievement inflation | Client dedup; server validates item shape | Weak against a malicious client | No server ledger/unique dedup | Low/Medium | Source |
| T-21 | Sensitive logging | Sanitized error handler; no token logging found; hashed IP | Effective in inspected paths | No centralized log review/retention policy | Medium | Source |
| T-22 | Cross-user cache leakage | Account data not cached server-side; playlist cache is public metadata | Effective | Future shared cache must remain user-scoped | Low | Source |
| T-23 | Browser storage leakage on shared device | Sign-out clears focus snapshot; HttpOnly cookies | Partially effective | Crash/forced close or cross-account tab can leave focus note; no encryption | Medium | Source |
| T-24 | Node runtime vulnerability | Manifest pins 24.22.1; Render env pins it | Effective in config | Local audit ran 24.11.0; live runtime not verified | Medium | Source/config |

### 23.2 Node.js baseline

The source and deployment configuration target Node 24.22.1 and refuse production startup without required secrets/configuration. The local shell used for this audit is 24.11.0, below the declared minimum. This is an **evidence limitation**, not proof that production is on 24.11.0. The owner should confirm the Render service actually runs 24.22.1 (a dashboard-level `NODE_VERSION` can override `.node-version`). No unrelated PHP CVE is attributed to this Node application.

### 23.3 Security verdict

No confirmed authentication bypass, IDOR, session-token leak, OAuth mix-up, or account-deletion bypass was found in the inspected source. The material risks are:

1. **Stale private UI after revocation** (privacy, not authorization).
2. **Cross-account tab identity confusion** (privacy/UX, constrained by CSRF for writes).
3. **Client-authored learning integrity** (only material if competitive/official).
4. **Large-history write amplification/availability**.
5. **Operational unknowns** (live deployment, runtime, email provider, Mongo network).

The security foundation is strong enough to continue using the product for personal learning data. It is not strong enough to claim tamper-proof competitive results or to skip live deployment verification.

---

## 24. Performance and scalability

### 24.1 Measured observations

| Measurement | Result | Context |
|---|---|---|
| Frontend main chunk | ~408 KB | Built asset, not gzip; includes React/shell/store |
| Chart vendor chunk | ~376 KB | Recharts, lazy-loaded with chart routes |
| CSS | ~46 KB | Built asset |
| Route chunks | ~12–27 KB each | Dashboard, Revision, Library, Competition, History, Reports, Focus |
| Backend test suite | 25 files / 201 tests | Passed |
| Frontend test suite | 42 files / 352 tests | Passed |
| API latency | Not measured | No production/load test was performed |
| Database query latency | Not measured | No live Mongo diagnostics in this audit |

No measured latency values are claimed. The following are architectural estimates based on source behavior.

### 24.2 Read path

- `GET /api/account/data` performs 20 domain queries plus a state-version read, in parallel.
- Each domain query is indexed by `{userId, key}` (legacy) or `{userId, domain, key}` (unified).
- The full state is returned in one JSON body. There is no pagination for sessions, segments, play sessions, XP, or rank history.
- A large account must serialize, transfer, parse, validate, and normalize every record on every full load.
- `readUserState` validates every record; that is good for integrity but adds CPU on large histories.
- Cloud mode loads all state at bootstrap; route-level lazy loading does not reduce the account payload.

**Estimate:** For a small account (hundreds of records), this is fine. For a heavy account (tens of thousands of segments/sessions), payload size and JSON parsing dominate. The 8 MB account cap becomes the practical ceiling before the per-domain item caps do.

### 24.3 Write path

- The client debounces 350 ms, computes changed collections by JSON fingerprint, and sends each changed collection sequentially with the current version.
- The server validates the whole collection, opens a transaction, reserves the next version, deletes all rows for the user/domain, inserts the new rows, and commits.
- Every save is a full collection rewrite, not a delta.
- A new playback segment changes the `segments` collection and triggers a rewrite of the entire segment collection.
- A focus session changes `sessions` and may change `xp`, `goals`, `achievements`, and `progress`, causing several full rewrites.
- `touchSession` performs a Mongo update on every authenticated request, including reads.

**Estimate:** A 10,000-segment history at roughly 200–300 bytes per record is 2–3 MB of JSON; every new segment rewrites that. A 200,000-segment history would be tens of MB, far above the 8 MB request cap. The 200,000 item limit is not reachable through the current write path.

### 24.4 Database and infrastructure

| Area | Observation | Impact |
|---|---|---|
| Index coverage | Legacy and Unified both have userId/key and lookup indexes | Good for scoped queries |
| Index growth | 20 legacy index families or 3 Unified indexes over all records | Unified reduces index family count |
| Transactions | Per-collection replacement and full import use transactions | Correctness over throughput; large transactions are a risk |
| Connection pool | MongoDB driver defaults; no explicit tuning found | Unknown at scale; measure |
| Playlist cache | Per-process TTL/LRU, max 50 | Duplicate upstream fetches across instances |
| Rate limiter | Shared Mongo-backed limiter | Adds writes per limited request; correct across instances |
| Session touch | Write per authenticated request | Unnecessary write amplification |
| Render cold starts | Free/standard service behavior not measured | First request after idle may be slow |
| Retry storms | Playlist retry is bounded; client save retry is manual | Good |
| Background jobs | 15-minute security purge; startup deletion/fence recovery | Light |
| Charts | Computed from full in-memory history via `useMemo` | Fine for small data; heavy for large |
| Offline queue | None; failed save shows retry | No automatic recovery across reload |

### 24.5 Top performance improvements

| Priority | Improvement | Expected effect | Trade-off |
|---|---|---|---|
| P1 | Append/delta endpoints for segments, sessions, playSessions, XP | Avoid rewriting entire collections; support large histories | New API, idempotency, migration of client write logic |
| P1 | Server-side pagination for history/analytics | Bounded payloads and memory | More endpoints; UI virtualization |
| P1 | Throttle session idle touch to once per 5 minutes | Fewer writes per request | Slightly less precise idle expiry; acceptable |
| P1 | Enforce/communicate a realistic per-account data budget | Prevents 413/transaction failures | Product limits and cleanup UX |
| P2 | Compress large JSON responses | Lower transfer size | CPU trade-off; proxy support |
| P2 | Shared playlist cache (if multi-instance) | Lower YouTube quota use | New infrastructure |
| P2 | Virtualize long tables/charts | Better rendering | UI complexity |
| P3 | Read-model/cache for analytics | Faster dashboards | Invalidation complexity |

### 24.6 Performance verdict

The app is engineered for correctness and modest personal accounts, not large histories or scale-out. The most important structural fix is the write model: full-collection rewrites make the per-domain item limits misleading and will fail before the advertised limits. The most important operational measurement is a real large-account load/save test, which does not exist today.

---

## 25. QA coverage and gaps

### 25.1 Current coverage

| Layer | Files / tests | What is covered |
|---|---|---|
| Frontend unit/domain | 42 files / 352 tests total | Duration parsing, progress identity, ranges, goals, focus state machine, efficiency, Arena math, time zones, backup validation, charts, UI controls, dialogs |
| Frontend component/integration | Included above | Store integrity, cloud persistence, cross-tab auth, auth sync, account UI, onboarding, playlist manager, player learning record, efficiency screen, focus workflow |
| Backend integration | 25 files / 201 tests total | Auth/session, multi-user isolation, account deletion, migration, unified store, origin config, rate limits, reset expiry, email, import integrity, cache, readiness |
| Build/type/lint | Both apps | Typecheck, build, lint |
| Real-browser E2E | None found | — |
| Load/performance | None found | — |
| Automated accessibility | None found | Manual/component focus tests only |
| Live production | Not run | — |

### 25.2 What is well covered

- Same-browser cross-tab sign-out, including storage fallback and token-free events.
- Logout-all server revocation across two sessions, and isolation from another account.
- Password-version and onboarding-expiry rejection.
- Account deletion residue and migration safety.
- Unified store selection and no-fallback behavior.
- Migration dry-run, conflicts, duplicates, idempotency, interrupted copy, destination-only warnings.
- Arena deterministic identities, tier bands, daily caps, ties/percentile, provisional users, rolling-window eligibility.
- Efficiency zero denominators, >100%, aggregate-vs-mean, evidence filtering.
- Focus pause/resume, recovery, duplicate Finish, manual correction.
- Timezone and cross-midnight attribution.

### 25.3 Critical gaps

| Gap | Why it matters | Required test |
|---|---|---|
| No real-browser E2E | jsdom does not reproduce real BroadcastChannel, storage events, visibility, sleep, iframe, or cookie behavior | Playwright/Cypress matrix |
| No remote-device revocation test | The reported all-devices visual defect is exactly this gap | Two browser contexts/devices; revoke; assert UI clears |
| No cross-account tab test | Shared cookie + old tab state is a privacy risk | Two tabs, two accounts, sign-in switching |
| No clock-jump/sleep test | Focus can overcount | Fake timers + visibility/pagehide + clock simulation |
| No multi-tab focus test | Two timers can double count | Two tabs start/finish; union assertion |
| No server cross-field focus validation test | Inconsistent sessions can be stored | Malicious payload cases |
| No large-account load/save test | 8 MB body and transaction limits | Fixture with 50k segments; measure and cap |
| No real Mongo failover/transaction test | In-memory adapter can hide production behavior | Staging replica set, failpoint/failover drill |
| No migration write-freeze/reverse drill | Cutover safety is unproven | Full staging cutover + rollback |
| No backup restore drill | `--backup-confirmed` is an assertion | Restore to isolated DB and compare |
| No automated accessibility scan | Chart/table/contrast gaps | axe + manual screen reader pass |
| No live security headers/cookie check | Source config can differ from deployment | Read-only production header/cookie inspection by owner |

### 25.4 Proposed QA matrix

| Environment / scenario | Chrome | Firefox | Safari | Android browser |
|---|---|---|---|---|
| Desktop single tab | Required | Required | Required where available | N/A |
| Two tabs, same account | Required | Required | Required | N/A |
| Two tabs, different accounts | Required | Required | Required | N/A |
| Two browser profiles | Required | Required | Optional | N/A |
| Two devices | Required | Optional | Optional | Required |
| Offline → online save | Required | Required | Required | Required |
| Background/suspended tab | Required | Required | Required | Required |
| Expired session | Required | Required | Required | Required |
| Revoked session (remote) | Required | Required | Required | Required |
| Focus sleep/clock change | Required | Required | Optional | Required |
| Large playlist (1,000) | Required | Optional | Optional | Optional |
| Large account history | Required | Optional | Optional | Optional |
| Keyboard-only navigation | Required | Required | Required | N/A |
| Screen reader spot check | Required | Optional | Required | Optional |

### 25.5 QA maturity verdict

The suite is strong for domain logic and backend safety, and unusually good for a project of this size. It is not release-grade for the reported logout, Focus reliability, cross-device behavior, large histories, or accessibility. The missing layer is **real-browser, multi-context, failure-injection testing**, not more unit tests of the same pure functions.

---

## 26. Complete prioritized improvement backlog

### 26.1 Field legend

To keep the register readable, fields are combined as follows:

- **Current / problem** = current behavior + problem.
- **Severity / type** = severity + type.
- **Impact / cause** = user impact + root cause.
- **Proposal / scope** = proposed improvement + technical scope.
- **Dependencies / risk** = prerequisites + regression/migration risk.
- **Acceptance / tests** = acceptance criteria + required tests.

Every row still carries the required information; the combination is a presentation compression, not an omission.

### 26.2 Backlog register

| ID | Feature / module | Current / problem | Severity / type | Impact / cause | Proposal / scope | Dependencies / risk | Acceptance / tests | Priority |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Session revocation UX | Server revokes all devices; idle remote tabs keep cached UI | High / security, privacy | Private data remains visible on an unattended device; no push/heartbeat | Add visibility revalidation + 60–120 s heartbeat + pre-write identity check; client only, server contract unchanged | Depends on SEC-02 identity assertion; risk of extra requests/write amplification | Remote tab clears within interval; tests for 401, offline, late response | P0 |
| SEC-02 | Cross-account tab identity | Shared cookie rotates; old tab has old user/CSRF; `/account/data` has no userId assertion | High / security, privacy | Old tab can read new account state on manual reload; confusing save errors | Add `userId` to data/session envelopes; compare in `loadCloud`; broadcast sign-in; clear on mismatch | Requires API contract change; risk of old client incompatibility | Two-account tab test; no cross-account render; no writes under stale identity | P0 |
| SEC-03 | Failed sign-out broadcast | Broadcast only after server success | Medium / security, UX | Other tabs stay authenticated-looking if logout fails | Broadcast `sign-out-unconfirmed` even on failure; show scoped notice; keep server truth | Depends on auth-sync v2; risk of confusing local-clear while server session lives | Both tabs clear; notice distinguishes unconfirmed; next request fails | P0 |
| DATA-01 | Focus timing integrity | Wall-clock active time; clock jumps, sleep, multi-tab; server shape-only | High / correctness, reliability | Inflated focus, XP, goals, Arena qualification; double count | Monotonic + wall anchors, gap policy, union intervals, Web Lock, server cross-field validation | Depends on schema additive fields; risk of excluding legitimate throttled time | Clock jump/sleep/two-tab tests; server rejects inconsistent sessions | P0 |
| DATA-02 | Storage cutover safety | Snapshot migration; no reverse; no freeze | Critical / data safety | Post-snapshot writes invisible after cutover; rollback loses new writes | Write freeze/change capture, reverse tool, backup restore drill, staging parity | Depends on ST-1..ST-7; risk of data loss if rushed | Staging cutover + rollback drill; zero pending; checksum parity | P0 |
| DATA-03 | Destination-only migration records | Reported as warning, not resolved | High / data safety | Stale/test records may appear after cutover | Reconciliation report with per-user decision; block cutover until reviewed | Depends on owner sign-off; risk of deleting legitimate records | Reviewed list; no unexplained destination-only records | P0 |
| DATA-04 | Large-history write limit | Whole-collection rewrite; 8 MB body; 200k item cap unreachable | High / performance, reliability | Large accounts cannot save; transactions may exceed limits | Append/delta endpoints; realistic quota; 413 UX; transaction sizing | Depends on API design and client migration; risk of duplicate writes | 50k-segment save under cap; idempotent append; latency budget | P1 |
| ARENA-01 | Arena scoring | Mean of daily efficiency; 3-day minimum; no volume gate | High / correctness, product | One-minute days rank highly; ranks feel nonsensical | Implement 75/25 completion+consistency model, fixed season, qualifying days, versioned replay | Depends on progress/coverage definitions and product sign-off; risk of rank changes | Exploit tests; worked examples; deterministic replay; sensitivity table | P1 |
| ARENA-02 | Incomplete playlist simulation | Competitor total estimated from average; user actual | High / correctness | Unfair advantage/disadvantage on incomplete playlists | Disable Arena until all durations resolved, or use exact same denominator for both | Depends on ARENA-01; low risk | Incomplete playlist test shows unavailable; parity when complete | P1 |
| ARENA-03 | Arena settings integrity | Any setting changes the only displayed rank | Medium / product integrity | Seed/window shopping; unstable apparent rank | Separate locked official season from practice simulator; store snapshot | Depends on ARENA-01; schema/API additions | Official settings read-only; practice cannot affect official | P1 |
| EFF-01 | Efficiency naming and copy | “Efficiency” implies quality; >100% explained but name overclaims | Medium / UX, correctness | Users may misinterpret 200% or a low score; Arena shares the word | Rename primary metric to Learning throughput; keep raw ratio; separate utilization | Copy and chart labels; no data migration | UI labels, tooltips, tests; no “quality” claim | P1 |
| EFF-02 | Weekly content definition | Analytics sums raw segments incl. rewatches; insight says unique | Medium / correctness, UX | Misleading “unique” insight; inconsistent with Efficiency | Compute union for unique view or label total watched; use correct copy | Depends on shared aggregation helper; low risk | Rewatch test; label matches calculation | P1 |
| FOCUS-01 | Focus recovery UX | Transient notice; no draft retry; 1 s localStorage churn | Medium / reliability, UX | Lost session on save failure; privacy residue | 5 s persistence, draft retry/discard, account-scoped key, persistent recovery card | Depends on DATA-01; schema additive | Recovery card; retry save; no cross-account key | P1 |
| FOCUS-02 | Focus multi-tab lock | Two tabs can both record | Medium / correctness | Double-counted time/XP | Web Locks or BroadcastChannel lease; block second timer | Depends on DATA-01; browser fallback needed | Two-tab E2E; second tab blocked/paused | P1 |
| FOCUS-03 | Focus server validation | No cross-field/interval checks | Medium / correctness, security | Inconsistent records accepted | Validate active <= elapsed, interval sums, overlaps, plausible duration, unique clientId | Depends on API contract; may reject legacy malformed data | Malicious payload tests; legacy compatibility test | P1 |
| CLOUD-01 | Offline save recovery | Manual retry only; no queue | Medium / reliability | Changes lost if tab closes offline | Persist a save queue with idempotency; replay on reconnect; conflict handling | Depends on DATA-04; risk of duplicate writes | Offline edit/reload/reconnect test; no duplicate | P1 |
| GOAL-01 | XP ledger integrity | Client dedup only; server stores duplicate dedupKeys | Medium / integrity | Replay can inflate XP/achievements | Server ledger with unique `(userId,dedupKey)`; immutable awards; rollback policy | Depends on schema/index; risk of legacy duplicates | Duplicate replay rejected; idempotent award; tests | P1 |
| QA-01 | Real-browser E2E | jsdom only; no cross-device tests | High / QA | Reported logout and sleep bugs unverified | Playwright matrix for auth, tabs, devices, focus, offline, Arena | Depends on test environment; no production mutation | CI runs Chrome/Firefox; two contexts; artifacts | P1 |
| STORE-01 | Unified staging readiness | No staging migration evidence | High / data safety | Cutover risk unknown | Build staging DB from backup; migrate, parity, write, delete, rollback | Depends on DATA-02/03; requires isolated DB | Staging report with all gates green | P1 |
| MICRO-01 | Loading screen copy | Internal storage sentence | Low / UX | Unnecessary technical detail | Remove secondary sentence | None | Snapshot/text test | P2 |
| MICRO-02 | Settings privacy copy | False IndexedDB claim in cloud mode | Medium / UX, trust | Users misinformed about where data lives | Mode-aware privacy copy | None | Cloud/local text tests | P2 |
| MICRO-03 | Developer-facing errors | “Deploy matching versions,” “security token,” “server's window” | Low/Medium / UX | Confusing, exposes internals | Rewrite user-facing messages; keep details in logs | Error-code mapping; low risk | Copy tests; no internal terms | P2 |
| UX-01 | Arena configuration UX | All settings mutate the only rank | Medium / UX, integrity | Seed/window shopping; poor beginner experience | Practice/official split, decomposition, explanations, accessible table | Depends on ARENA-01/03 | Usability test; settings integrity test | P2 |
| UX-02 | Efficiency analytics UX | Average-only trend; low-sample gaps | Medium / UX | Outliers mislead; users overinterpret | Distribution, median, sample counts, baseline, outlier labels | Depends on EFF-01/02 | Chart tests; low-sample state | P2 |
| UX-03 | Focus history UX | Basic list; limited patterns | Low/Medium / UX | Users cannot see interruptions/trends | Session summary, pause reasons, weekly patterns, export | Depends on DATA-01/FOCUS-01 | Component tests; accessibility | P2 |
| UX-04 | Session list feedback | Revoke current session has no immediate UI transition | Low / UX | User may think revoke failed | Refresh list, clear if current, confirm | Low risk | Component/integration test | P2 |
| UX-05 | Rank history denominator | `of` includes provisional rivals | Low / UX | Rank appears different from denominator | Use scored count; label | Low risk | Unit/UI test | P2 |
| A11Y-01 | Chart/table accessibility | SVG charts lack table alternative; contrast unverified | Medium / accessibility | Screen-reader/contrast barriers | Add data tables/text summaries, axe CI, contrast audit | Depends on UI work; low risk | axe zero serious; manual pass | P2 |
| DOC-01 | Broken deployment link | README links absent `docs/DEPLOYMENT_MULTIUSER.md` | Low / documentation | Setup dead end | Restore/create doc in a docs-only change; or remove link | Separate documentation task; not this audit | Link check passes | P2 |
| ARENA-04 | Official server-side season | Arena is client-only | Medium / architecture (future) | No tamper-resistant official rank | Store season snapshot and recompute server-side from evidence | Depends on domain sharing; large scope | Server replay matches client; audit trail | P3 |
| EFF-03 | Playback-adjusted pace | Not implemented; rate data exists | Low / advanced | Cannot distinguish speed from coverage | Add experimental rate-weighted pace with explicit attribution rule | Depends on telemetry validation; complexity | Formula tests for mixed rates/overlap; label experimental | P3 |
| FOCUS-04 | Cross-device focus sync | No device coordination | Low / advanced | Overlap possible across devices | Server overlap check + device ID; union analytics | Depends on DATA-01; privacy | Two-device test; overlap warning | P3 |
| OBS-01 | Security/audit observability | Logs only; no metrics store | Medium / operations | Hard to investigate revocation/rate events | Structured events, counters, dashboards, retention | Infra decision; privacy review | Event schema; alert tests | P3 |
| PERF-01 | Shared playlist cache | Per-process cache | Low / scale | Duplicate YouTube quota use | Shared cache if multi-instance | Infra; invalidation | Cache hit ratio; no user data | P3 |
| STORE-02 | Legacy retirement | Safe tooling; no production evidence | High / operations | Premature drop risk | Retire only after observation window, backup, acceptance | Depends on STORE-01 | Retirement dry run zero blockers; backup verified | P3 |

### 26.3 Backlog summary

| Priority | Count | Theme |
|---|---:|---|
| P0 | 6 | Revocation truth, cross-account identity, focus integrity, cutover safety |
| P1 | 14 | Arena/efficiency correctness, focus reliability, cloud scale, XP, E2E, staging |
| P2 | 8 | Microcopy, Arena/efficiency UX, accessibility, docs |
| P3 | 8 | Official server rank, advanced pace, cross-device, observability, cache, retirement |

The backlog deliberately does **not** propose a broad visual redesign. The current design system is coherent; the highest-value work is correctness, trust, and test coverage.

---

## 27. P0/P1/P2/P3 implementation roadmap and readiness verdict

### 27.1 Sequencing principles

1. Fix identity and revocation truth before adding features that depend on “who is signed in.”
2. Fix timing integrity before using Focus data for more analytics or Arena.
3. Fix efficiency naming and analytics definitions before exposing more numbers.
4. Redesign Arena behind a versioned model and a practice/official split.
5. Do not touch storage mode until the cutover gates and reverse path exist.
6. Add real-browser tests in parallel with each fix, not as a final afterthought.

### 27.2 P0 — Security and data integrity

| Workstream | Dependencies | Expected outcome | Risk | Acceptance | Tests |
|---|---|---|---|---|---|
| P0-A Session truth | None | Remote revocation visible within heartbeat; cross-account tabs cannot display each other | Extra requests; identity contract change | Remote tab clears; two-account tab test passes; no secrets in events | Unit, component, two-context E2E, backend revocation |
| P0-B Focus integrity | P0-A for account-scoped keys | Clock/sleep/multi-tab cannot inflate active time; server rejects inconsistent records | Excluding legitimate throttled time; legacy compatibility | Gap policy tests; server validation; union count correct | Fake clocks, two-tab, malicious payload, migration compatibility |
| P0-C Storage safety | None | No cutover until freeze/reverse/backup gates; staging evidence | Operational complexity | Staging cutover + rollback drill; zero pending/conflicts | Migration, restore, parity, deletion |

### 27.3 P1 — Core learning correctness

| Workstream | Dependencies | Expected outcome | Risk | Acceptance | Tests |
|---|---|---|---|---|---|
| P1-A Arena v2 | Progress/coverage definitions; product weight sign-off | Bounded, explainable, exploit-resistant score; fixed season; deterministic replay | Rank changes; user confusion; manual evidence | Worked examples; one-minute exploit rejected; replay matches | Unit/property tests, sensitivity, E2E |
| P1-B Efficiency rename/analytics | Shared aggregation helper | “Learning throughput” with accurate labels; unique-vs-total clarity | Copy churn; user re-learning | Labels/tooltips; rewatch test; aggregate ratio | Unit/component/copy tests |
| P1-C Cloud scale | API design | Append/delta writes; pagination; 8 MB UX; large-account support | Duplicate writes; API versioning | 50k-segment test; idempotent append; no 413 for supported account | Load/integration, conflict, retry |
| P1-D XP ledger | Schema/index | Server-authoritative XP; replay rejected | Legacy duplicates; migration | Unique dedup; immutable awards; delete cascade | Backend integration, replay, deletion |
| P1-E QA/E2E | Test environment | Real-browser confidence for auth/focus/offline | CI time/flakiness | Chrome+Firefox core matrix; traces on failure | Playwright suite |

### 27.4 P2 — Product experience

| Workstream | Dependencies | Expected outcome | Risk | Acceptance | Tests |
|---|---|---|---|---|---|
| P2-A Microcopy | None | Remove internal loading sentence; mode-aware privacy; user-facing errors | Translation/copy consistency | Text snapshots; no internal terms in normal UI | Component/text tests |
| P2-B Arena UX | P1-A | Practice/official split, decomposition, accessible leaderboard | Scope creep | Settings integrity; beginner comprehension | Usability + component + a11y |
| P2-C Efficiency UX | P1-B | Distribution, baseline, low-sample, outlier clarity | Chart complexity | No trend under 3 obs; table alternative | Chart/component/a11y |
| P2-D Focus UX | P0-B | Recovery card, pause reasons, session summary, history patterns | Data additions | Save/retry; recovery; analytics | Component/integration |
| P2-E Accessibility/docs | P2-B/C | axe-clean core routes; fixed deployment link | Ongoing | Serious issues zero; link check | axe/manual/link check |

### 27.5 P3 — Advanced capability and scale

| Workstream | Dependencies | Expected outcome | Risk | Acceptance | Tests |
|---|---|---|---|---|---|
| P3-A Official server season | P1-A, domain sharing | Tamper-resistant official rank | Large scope; privacy | Server replay matches client | Replay/audit |
| P3-B Playback pace | Telemetry validation | Experimental rate-adjusted metric | Misleading attribution | Mixed-rate/overlap tests | Unit/property |
| P3-C Cross-device focus | P0-B | Overlap detection/union | Privacy/device IDs | Two-device warning | E2E |
| P3-D Observability | Infra | Structured security/metrics | Retention/privacy | Dashboards/alerts | Event tests |
| P3-E Retirement | P0-C, staging | Safe legacy drop | Destructive | Dry run zero blockers; backup verified | Retirement drill |

### 27.6 Implementation readiness verdict

**Ready to start now:**

- P0-A session truth and identity assertion.
- P0-B focus timing integrity and multi-tab lock.
- P2-A microcopy (including removing the loading sentence and fixing cloud-mode privacy copy).
- P1-B efficiency rename and analytics definition correction, behind tests.
- P1-A Arena v2 as a **versioned, practice-first** implementation; do not switch an official rank until product signs off on the weights.
- P1-E real-browser E2E foundation.

**Not ready to start without prerequisites:**

- Unified production cutover: blocked by ST-1..ST-7; staging only after freeze/reverse/backup gates.
- Official Arena rank with real stakes: no server-side score, no anti-cheat, no official season snapshot.
- Claims that Focus measures concentration: the data does not support it.
- Production release claims: live deployment/runtime/cookie behavior not verified in this audit.

**Final readiness verdict:** **CONDITIONAL GO for implementation of the approved P0/P1/P2 workstreams; NO-GO for a Unified production cutover or an official competitive Arena release.** The codebase is stable enough to begin controlled remediation, but the storage and rank claims must remain gated until their specific acceptance tests pass.

---

## 28. Regression and acceptance-test matrix

### 28.1 Authentication and sessions

| Test | Type | Setup | Expected |
|---|---|---|---|
| Logout one tab clears all same-browser tabs | Component/E2E | Two tabs, one account | Both show sign-in; server logout called once |
| Logout with server failure clears local tabs | Component | Mock 500 logout | Both clear; notice says unconfirmed; server session still active |
| Logout-all revokes every session | Integration | Two sessions, one account | Both 401 on next request; current cookie cleared |
| Remote revocation visual clear | E2E | Two browser contexts | Heartbeat/visibility clears within interval |
| Remote idle tab without heartbeat | E2E | Hide tab, revoke remotely | On show, revalidation clears; no manual refresh |
| Expired idle session | Integration | Advance timestamps | Session endpoint unauthenticated; protected route 401 |
| Absolute expiry | Integration | Advance beyond absolute | Rejected even with recent touch |
| Password change | Integration | Two sessions | Other revoked; current rotated; old CSRF invalid |
| Password reset | Integration | Reset link | All sessions revoked; link single-use; generic responses |
| OAuth state/binding mismatch | Integration | Wrong/missing binding | No session; safe error |
| CSRF missing/stale | Integration | Mutating request | 403 `CSRF_FAILED`; no mutation |
| Cross-account tab | E2E | Tab A user A, tab B user B | A clears or revalidates; no B data under A |
| Cookie attributes | Security | Production config | `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain |
| Token-free auth event | Unit | Broadcast | Only type/reason/at |
| Late response after logout | Component | Delayed fetch | No re-auth; state stays cleared |

### 28.2 Focus

| Test | Type | Setup | Expected |
|---|---|---|---|
| Pause/resume accounting | Unit | 25 min active, 5 pause, 15 active | Active 2,400 s, elapsed 2,700 s, paused 300 s |
| Duplicate finish | Unit/store | Two finish events same timer | One session |
| Recovery running | Unit | Last tick 10:25, reopen 11:00 | Closed gap excluded |
| Recovery paused | Unit | Paused 10:25, reopen 11:00 | Gap excluded from elapsed |
| Clock forward | Unit/E2E | Jump +2 h | Gap excluded per policy |
| Clock backward | Unit | Jump -1 h | No negative count; accumulated preserved |
| Device sleep | E2E | Suspend tab, wake | Sleep not counted |
| Visible idle | Product test | Start, no interaction | UI says timer-active, not concentration |
| Two tabs | E2E | Both start | Second blocked or paused; union count |
| Two devices | E2E | Overlap sessions | Warning/rejection; analytics union |
| Manual correction | Component | 30 min correction | Estimated label; active set |
| Server inconsistent payload | Integration | active > elapsed | 400; nothing stored |
| Interval overlap | Unit/server | Active/paused overlap | Excluded/rejected |
| Cross-midnight | Unit | 23:50–00:10 | 10 min each day |
| DST transition | Unit | Fall/spring | Correct local-day split |
| Timezone change | Unit | Same UTC intervals, new zone | Reattributed |
| Account switch | E2E | Sign out/in another user | No old recovery snapshot |

### 28.3 Efficiency and Arena

| Test | Type | Expected |
|---|---|---|
| Zero denominator | Unit | null |
| Negative/NaN | Unit | null |
| >100% at 2× | Unit | 200% |
| Aggregate vs mean | Unit | Aggregate ratio wins for period summary |
| Rewatch | Unit | Unique coverage unchanged; total watched increases |
| Evidence filter symmetry | Unit | Both numerator and denominator filtered |
| One-minute Arena exploit | Unit/property | Not ranked / score below threshold |
| Arena 75/25 worked examples | Unit | Exact values in Section 10 |
| 85/15 vs 75/25 sensitivity | Unit/snapshot | Documented ordering |
| Incomplete playlist | Unit/UI | Arena unavailable |
| Deterministic cohort | Unit | Same seed/snapshot = same rows |
| Different seed | Unit | Different cohort; same user inputs |
| Date anchoring | Unit | Same date reproduces |
| Ties | Unit | Shared competition rank |
| Provisional | Unit | No rank, excluded percentile |
| Settings integrity | Component | Official locked; practice cannot change official |
| Score bounds | Property | 0 ≤ score ≤ 100 |
| Playback-adjusted pace | Unit | Mixed rates; overlap rule documented |
| Large cohort performance | Perf | 2,000 × 90 within budget |

### 28.4 Storage and migration

| Test | Type | Expected |
|---|---|---|
| Legacy repository contract | Integration | All 20 domains read/write |
| Unified repository contract | Integration | Same values via domain adapter |
| No fallback | Integration | Unified selected + no data = empty/error, never legacy |
| Dry run no writes | Integration | Source/destination unchanged |
| Apply copies all domains | Integration | Counts/checksums match |
| Idempotent rerun | Integration | No duplicate, no overwrite |
| Source conflict | Integration | Blocked, destination untouched |
| Destination conflict | Integration | Blocked, no overwrite |
| Duplicate source/destination | Integration | Blocked |
| Invalid record | Integration | Blocked, sanitized issue |
| Account deletion race | Integration | No resurrection; copied record removed |
| Destination-only | Integration | Warning; no delete |
| Source changes during copy | Integration | Incomplete, not success |
| Interrupted apply | Integration | Rerun resumes |
| Full import transaction | Integration | All-or-nothing |
| Large account | Perf | Body/transaction limits measured |
| Backup restore | Drill | Restored counts/checksums match |
| Cutover freeze | Drill | No post-snapshot writes |
| Reverse migration | Drill | Unified writes preserved on rollback |
| Retirement dry run | Integration | Zero blockers; only legacy dropped |
| Account deletion both modes | Integration | Zero residue in both |

### 28.5 Frontend, accessibility, and security

| Test | Type | Expected |
|---|---|---|
| Chrome/Firefox/Safari core routes | E2E | No console errors; auth/data flows work |
| Mobile viewport | E2E | No overflow; drawer focus trap |
| Keyboard-only | Manual/E2E | All controls reachable; focus returns |
| axe core routes | Automated | No serious/critical issues |
| Chart data table | Component | Text alternative present |
| Reduced motion | Component | No essential animation |
| CSP/header snapshot | Unit | No wildcard script/connect; expected headers |
| Cookie snapshot | Integration | Expected attributes |
| XSS payload in note/title | Integration | Rendered as text; no script execution |
| Malicious import | Integration | Rejected; no partial write |
| Rate limit | Integration | 429 after threshold |
| Session token not in storage | Security | Static/runtime check |
| Logs sanitized | Security | No token/cookie/email values |
| Large account load | Perf | Within payload/time budget |
| Offline edit/reconnect | E2E | Queue replays; conflict handled |

### 28.6 Test environment rules

- Use an isolated MongoDB database and test accounts; never production.
- Never send real email; use the configured test adapter or captured messages.
- Do not run migrations against production.
- Do not use live sessions or credentials in tests.
- Capture traces/screenshots for E2E failures.
- Run the backend suite on Node 24.22.1 before release; the local 24.11.0 run is not sufficient.

---

## 29. Evidence classification and limitations

### 29.1 Master evidence table

| Finding | Classification | Evidence type | What was verified | What remains unverified |
|---|---|---|---|---|
| Same-browser sign-out clears tabs | Confirmed | Source + test | Code path and tests | Real-browser BroadcastChannel/storage delivery |
| Failed logout does not broadcast | Confirmed | Source | `signOut` branch | Runtime behavior in a real browser |
| All-devices server revocation | Confirmed | Source + test | `revokeAllSessions`, 401 tests | Multi-process production with shared Mongo |
| Remote visual staleness | Partially confirmed | Source reasoning | No heartbeat/push; cached UI | Live device observation |
| Cross-account tab read | Partially confirmed | Source reasoning | Shared cookie; no userId assertion | Reproduced two-tab runtime |
| Cookie flags/topology | Confirmed | Source + test | Production cookie builder and tests | Live Vercel/Render cookie headers |
| Session token not in JS storage | Not found (leak) | Source scan | No storage writes of token | Runtime XSS/extension behavior |
| Focus pause/recovery math | Confirmed | Source + test | State machine and tests | Sleep/clock jumps in real browser |
| Focus clock/sleep overcount | Confirmed | Source | No monotonic/gap guard | Exact browser/OS behavior |
| Focus multi-tab overlap | Confirmed | Source | No lock; separate timer IDs | Real two-tab reproduction |
| Server focus validation gap | Confirmed | Source | Shape-only checks | Production data distribution |
| Efficiency formula/aggregation | Confirmed | Source + test | Formula, null handling, aggregate ratio | User interpretation/UX |
| Efficiency >100% | Confirmed | Source + test | 2× example | Frequency in real accounts |
| Analytics unique-vs-total mismatch | Confirmed | Source | Raw segment sum vs “unique” copy | Visual reproduction |
| Arena one-minute exploit | Confirmed | Source + math | Score inputs and formula | User-visible rank on a real account |
| Arena equal-weight bias | Confirmed | Source + math | Formula | Product acceptability |
| Arena incomplete-playlist fallback | Confirmed | Source | Estimated total | Real incomplete playlist rank |
| Arena determinism | Confirmed | Source + test | Seeded generation/tests | Cross-browser numeric identity (same JS engine expected) |
| Storage default Legacy | Confirmed | Source + render config | No mode env; default | Live deployed mode |
| Unified schema | Confirmed | Source + test | Per-record documents/indexes | Production scale behavior |
| No fallback/dual-write | Confirmed | Source + test | Mode selection; tests | None |
| Migration dry-run/apply | Confirmed | Source + test | Checksums/conflicts/idempotency | Real Mongo/transaction behavior |
| Snapshot cutover gap | Confirmed | Source | No change capture; verification timing | Production write rate impact |
| No reverse migration | Confirmed | Source | No reverse tool | Rollback drill |
| Account deletion coverage | Confirmed | Source + test | Scoped collections and saga | Production failure injection |
| Large-history write limit | Confirmed (architectural) | Source + estimate | Full rewrite + 8 MB cap | Measured large-account failure threshold |
| Microcopy loading sentence | Confirmed | Source | Exact sentence | Visual screenshot |
| Settings privacy false in cloud | Confirmed | Source | Copy not mode-aware | User impact study |
| Broken deployment doc link | Confirmed | Filesystem + Git | File absent from HEAD/worktree | Whether docs are hosted elsewhere |
| No real-browser E2E | Confirmed (gap) | Test inventory | No Playwright/Cypress | — |
| No live production verification | Not tested | Scope | No live calls made | Deployment/runtime/headers |
| Node baseline mismatch locally | Confirmed | Shell | v24.11.0 vs 24.22.1 | Production runtime |

### 29.2 Evidence limitations

1. **No live production checks.** No authenticated production request, cookie inspection, database query, or deployment check was performed. Production claims are limited to source/config and historical reports.
2. **No real-browser E2E.** jsdom tests cannot prove BroadcastChannel/storage timing, visibility, sleep, iframe behavior, or cross-device propagation.
3. **No live MongoDB writes or migration.** Migration conclusions come from source, unit/integration tests, and reasoning. No production or staging data was touched.
4. **No load/performance test.** Bundle sizes are measured; latency, throughput, transaction time, and memory are estimates.
5. **No accessibility audit.** Component tests cover focus traps/dialogs, but no axe or screen-reader pass was run.
6. **No security penetration test.** No exploit was attempted against production or a live account.
7. **Node version mismatch.** Local QA ran on 24.11.0, below the declared 24.22.1 minimum.
8. **Reports 13–21 are absent from the working tree.** They were read from Git history and treated as historical context, not current truth.
9. **No product-owner weight decision.** The 75/25 Arena recommendation is a product proposal, not a scientific finding. The 85/15 candidate remains a valid completion-first choice.
10. **No user research.** Microcopy recommendations are heuristic, not measured comprehension studies.

### 29.3 What was not found

- No confirmed session-token leak via JavaScript-accessible storage, URL, referrer, or third-party analytics.
- No confirmed IDOR in account/playlist routes.
- No confirmed auth bypass or session-fixation path.
- No confirmed open redirect.
- No confirmed cross-user server cache leak.
- No confirmed email enumeration oracle in the inspected login/forgot responses.
- No confirmed data loss in the tested migration paths; the cutover gap is operational, not a proven production incident.
- No evidence that logout deletes learning data.

### 29.4 Overall evidence quality

The evidence is strong for source-level and unit/integration behavior, moderate for mathematical models, and weak for real-browser, live deployment, production scale, and accessibility. The report labels those distinctions rather than collapsing them into a single “verified” claim.

---

## 30. Final Git status and report-only compliance confirmation

### 30.1 Repository baseline

The audit began and ended on branch `main` at the same commit:

```text
3107d11c151a2fd86dddd7630255998026dcd6a7
Fix production API routing and CSP connectivity
```

`HEAD` did not move during the audit. No commit was created, amended, reverted, cherry-picked, or pushed.

### 30.2 Audit-caused working-tree changes

Exactly two paths were created or modified by this audit:

| Path | Git state | Change |
|---|---|---|
| `docs/user-doc/audit2/22_LEARNQUEST_COMPLETE_PRODUCT_SECURITY_QUALITY_AUDIT_2026-10-30.md` | Untracked (`??`) | New Report 22 |
| `docs/user-doc/audit2/README.md` | Modified (`M`) | Added the Report 22 archive row; `1 insertion`, `0 deletions` |

The archive row is the only change to `README.md`. No existing archive row, report link, availability note, or historical text was removed or rewritten.

### 30.3 Pre-existing working-tree state (not caused by this audit)

At the start of the audit, the working tree already contained 18 tracked deletions and one unrelated untracked prompt file. These pre-existing items remained unchanged at the end:

- **9 deleted prompt files** at the repository root, dated 2026-10-28.
- **9 deleted audit reports** in `docs/user-doc/audit2/` (Reports 13–21), dated 2026-10-28.
- **1 untracked prompt file:** `LEARNQUEST_COMPLETE_PRODUCT_SECURITY_QUALITY_AUDIT_PROMPT_2026-10-30.txt`.

These deletions and the unrelated prompt are **not** part of Report 22. The audit did not restore, edit, stage, or delete them. Reports 13–21 were read from Git history for historical context only.

`git diff --stat` at close therefore reports **19 files changed, 1 insertion, 8,793 deletions**, of which the insertions are the archive row and the deletions are entirely pre-existing. A naive diff summary must not be read as audit-caused deletion of those reports.

### 30.4 Final `git status --short` shape

The final status contains **21 entries**:

```text
 M docs/user-doc/audit2/README.md
?? docs/user-doc/audit2/22_LEARNQUEST_COMPLETE_PRODUCT_SECURITY_QUALITY_AUDIT_2026-10-30.md
?? LEARNQUEST_COMPLETE_PRODUCT_SECURITY_QUALITY_AUDIT_PROMPT_2026-10-30.txt
 D <9 root prompt files>
 D <9 audit reports 13-21>
```

The first two entries are the complete audit output. The remaining 19 entries pre-date the audit and are disclosed above.

### 30.5 Forbidden-operation confirmation

No application source, test source, package manifest, lockfile, dependency installation, environment file, database record, deployment configuration, or production setting was changed. No dependency was added, removed, upgraded, or downgraded.

The audit did **not**:

- commit, amend, tag, stash, push, or force-push;
- deploy, redeploy, roll back, or change a hosting/dashboard setting;
- run a migration, dry-run against real data, seed, or database write;
- send email, request a password reset, or consume a reset token;
- revoke a live session or sign out a real device;
- delete or restore any record, report, prompt, or file;
- call an authenticated production endpoint or inspect a production cookie;
- store a credential, token, secret, or personal datum in this report.

Test, typecheck, build, and lint commands were read-only with respect to tracked source. They may have produced ordinary untracked build/test output only; no such output is included in the audit changes above.

### 30.6 Verification evidence

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `3107d11c151a2fd86dddd7630255998026dcd6a7` (unchanged) |
| `git status --short` | 21 entries: 18 pre-existing deletions, 1 audit-modified README, 2 untracked files (Report 22 and pre-existing prompt) |
| `git diff --numstat -- docs/user-doc/audit2/README.md` | `1 0` |
| `git diff --stat` | 19 files, 1 insertion, 8,793 deletions (18 pre-existing deleted files plus README) |
| H2 structure | 30 sequential sections, `1` through `30` |
| Relative links | The `README.md` link resolves; no broken relative report link |
| Encoding | UTF-8 without BOM; no U+FFFD replacement characters |
| Placeholders | No `TODO`, `TBD`, `PLACEHOLDER`, `FIXME`, or lorem-ipsum text |
| Test baseline | Backend 25 files / 201 tests passed; frontend 42 files / 352 tests passed |
| Runtime | Local Node `v24.11.0`; declared baseline `>=24.22.1 <25` |

### 30.7 Final compliance statement

This audit satisfies the report-only constraint: it produced **one new report** and **one archive-index row**. The final readiness verdict remains **CONDITIONAL GO for controlled remediation; NO-GO for a Unified production cutover or an official competitive Arena release** (Sections 1 and 27.6).

No claim in this report should be read as production verification. The evidence limitations in Section 29 remain in force, including the absence of live production checks, real-browser E2E, load testing, accessibility testing, and a live MongoDB migration rehearsal.

---
