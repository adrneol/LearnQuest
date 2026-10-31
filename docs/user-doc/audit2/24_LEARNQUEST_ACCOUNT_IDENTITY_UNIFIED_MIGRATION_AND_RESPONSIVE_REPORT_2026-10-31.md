# Report 24 - LearnQuest Phase 24 Account Identity, Unified Migration, Arena Documentation and Responsive Fixes

**Date:** 2026-10-31  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**Baseline commit:** `d2eb55be3e030b63eab845037389ec2da8e43af9` (Phase 23)  
**Runtime:** Node `v24.22.2`, npm `11.19.1`  
**Production storage mode:** `LQ_USER_DATA_STORE=legacy` (unchanged)  
**Production migration/cutover:** not performed, not authorized

---

## 1. Executive summary

Phase 24 implemented four workstreams:

1. A Google-first account identity flow that resolves a linked Google `sub` from either sign-in or sign-up, never auto-links by matching email, and never creates an account from an unknown sign-in identity.
2. Library/Player responsive containment fixes for long titles, metadata, controls and phone-width tables.
3. A complete, standalone Arena guide plus safe fixes for fixed-run settings integrity and rank-history bounds.
4. A durable, cross-process Legacy-to-Unified migration system with forward/reverse copies, write freeze/drain, resumable journal, checksum/count verification, a controlled operator CLI, an isolated replica-set rehearsal, a logical restore-comparison rehearsal, and production runbook/rollback documents.

| # | Workstream | Status | Evidence / limitation |
|---|---|---|---|
| 1 | Google identity resolution | **PASS WITH LIMITATIONS** | Linked-sub resolution, explicit creation, no auto-link, unique-index and race tests; no live Google run |
| 2 | Library/Player responsive overflow | **PASS WITH LIMITATIONS** | jsdom regression tests for full titles/telemetry and phone cards; no real-browser screenshots or viewport sweep |
| 3 | Arena guide and fixed-run integrity | **PASS WITH LIMITATIONS** | Complete guide, formula/settings/status matrix, fixed-run binding and end action, 100-snapshot cap; no browser E2E |
| 4 | Legacy-to-Unified migration | **STAGED, NOT CUT OVER** | Local replica-set forward/reverse/transaction rehearsal, logical restore comparison, runbooks; production backup and cutover gates pending |
| 5 | Full verification | **PASS WITH LIMITATIONS** | Backend 237 tests, frontend 392 tests, typechecks/builds, lint, audits; real-browser/monitoring checks absent |

**Bottom line:** the implementation and local rehearsal are complete, and the production runbook is ready for owner review. **Production cutover is not authorized and has not been started.** The production database was not contacted, and no production data, configuration, index or collection was changed.

---

## 2. Baseline, scope and safety boundaries

- Baseline was the committed Phase 23 HEAD `d2eb55be3e030b63eab845037389ec2da8e43af9`, one commit ahead of `origin/main`.
- The working tree already contained the intended Phase 24 changes when this report was prepared. No commit, push, deploy, rebase, reset, clean, stash or destructive checkout was performed.
- No `.env` file, MongoDB URI, credential, token, cookie, OAuth secret or private learning payload is included in this report.
- No production database query, production account lookup, real sign-up, email send, Google exchange or Brevo call was performed.
- `LQ_USER_DATA_STORE` remains `legacy`. No Legacy collection was dropped or retired.

---

## 3. Local-versus-production database diagnosis

### 3.1 What was verified

Source inspection confirms:

- `backend/src/config/env.ts` reads the MongoDB connection from deployment configuration (`MONGODB_URI`) and a deployment-specific `MONGODB_DB_NAME`.
- `MONGODB_DB_NAME` defaults to `learnquest` when unset, but accepts any validated 1-63 character name using letters, digits, underscores or hyphens.
- The application connects to exactly one configured database; there is no checked-in production connection string and no shared database name constant that would force local and production onto the same database.
- Unique indexes are per database/collection, so an account accepted in one database does not imply it exists in another.
- The existing `diagnose:mongo` script incorrectly rejected any database name other than `learnquest`. That was fixed: it now reports the configured **non-secret database name** and performs a read-only `ping` without printing the URI, host, username or password.
- The local `.env` is untracked and was not printed. The local runtime and the Render production deployment are separate configuration scopes.

### 3.2 What cannot be claimed

Production topology was **not** verified from this workstation. No authorized production evidence (dashboard, deploy manifest or non-production replica) was available, and the prompt forbids querying production for this email. Therefore:

- We cannot claim local and production share a database.
- We cannot claim production duplicate-email validation was or was not the cause of the observed sign-up behavior.
- The accurate conclusion is: **local sign-up acceptance does not by itself prove a production duplicate bug**, because the two environments may use different databases or clusters.

### 3.3 Identity defects that were still real

The code audit found and fixed independent identity risks:

- The old Google-subject index used `sparse: true`, which still indexes an explicit `null` value and could allow only one unlinked account while permitting unsafe subject semantics.
- Sign-up and sign-in intents had disagreeing behavior for an already-linked Google subject; sign-up could show an "account exists" failure instead of signing in.
- The account lookup was keyed too narrowly to one request intent, and duplicate-key races did not re-check the email owner.
- Email updates did not translate a raced unique-index conflict into a safe `EMAIL_TAKEN` response.

No production record was modified to test any of these.

---

## 4. Account identity resolution

### 4.1 Resolution rules

| Situation | Behavior |
|---|---|
| Google `sub` already linked, user starts Sign Up | Sign in to the existing account; no duplicate account. Unfinished onboarding resumes. |
| Google `sub` already linked, user starts Sign In | Sign in to the same account. |
| Verified Google identity, no linked account, Sign In | No account is created. The callback returns `google_account_not_found`; the client lands on the explicit **Create your account** screen. The person must press **Continue with Google** again. |
| Verified Google identity, no linked account, Sign Up | Explicit account creation proceeds through the existing onboarding flow. |
| Verified Google email matches an existing account with a different/unlinked `sub` | `LINK_REQUIRED`; no auto-link, no merge, no session for the email owner. Copy tells the person to sign in with the account's password or contact support with ownership proof. |
| Account is deleting/unavailable | No session is created. |
| Google email is unverified | No account is created. |

Google `sub` remains the primary stable identity. Email is a secondary uniqueness/association signal only. Gmail dots and plus-tags are not rewritten, and accounts are never merged because an email string matches.

### 4.2 Unique indexes and concurrency

- `emailNormalized` retains its database-enforced unique index.
- The Google-subject constraint is now a **partial unique index** named `google_sub_partial_unique_v2` on `{ googleSub: 1 }` with `partialFilterExpression: { googleSub: { $type: 'string' } }`.
- The replacement index is created **before** the old sparse index is dropped, so there is never a window without a unique subject constraint. If the replacement cannot be built, the old index remains and startup fails rather than weakening identity.
- Account creation is serialized per-process by locks on both `google:<sub>` and `email:<normalizedEmail>`.
- Across processes, the database unique indexes are the authority. Duplicate-key errors re-read both the subject and the email owner and return:
  - the existing account when it is the same `sub`;
  - a safe `LINK_REQUIRED` conflict when the email belongs to another account;
  - `ACCOUNT_DELETING` when the matched account is being deleted.
- Email changes also convert a raced duplicate-key error into `EMAIL_TAKEN`.

The index replacement was exercised on the isolated MongoDB replica set with two real Google subjects and an explicit `null` subject: replacement creation and old-index removal both succeeded.

### 4.3 UX changes

- An unknown Google identity arriving through Sign In is routed to the `register` screen with clear copy that no account was created automatically.
- Sign-up copy explains that an already-linked identity signs in instead of creating a duplicate.
- `LINK_REQUIRED` copy explains the block, tells the person to use their existing password sign-in, and states that LearnQuest did not link or sign them in automatically.
- The server keeps generic responses where enumerated account existence would be unsafe; actionable detail is shown only after a verified Google identity.

Existing OTP/password recovery, CSRF, exact-origin checks, HttpOnly/SameSite cookies, OAuth state and browser binding, rate limits, validators, session revocation and account isolation were preserved.

### 4.4 Identity test coverage

Backend `backend/tests/multiuser.test.ts` now covers:

- explicit Google registration and session rotation;
- unknown Google identity on sign-in does not create an account;
- linked identity resolves from both sign-in and sign-up with no duplicate;
- unfinished linked registration resumes from either intent;
- unverified Google email is rejected;
- matching email with a different/unlinked subject does not auto-link;
- concurrent case/whitespace email variants create at most one account;
- duplicate-key race returns a safe email conflict;
- existing password/OTP reset flows, OAuth state replay/browser binding, forged claims and account isolation remain covered.

Frontend `frontend/tests/auth-repair.test.tsx` covers the unknown-sign-in-to-creation path and the safe `LINK_REQUIRED` explanation.

---

## 5. Responsive Library and Player fixes

### 5.1 Root causes

- **Library:** the only item view was a `<table>` with `min-w-[640px]` inside a horizontal scroller. At phone widths the table forced sideways scrolling and clipped long titles; filter/sort controls used fixed `w-40`/`w-44` widths; there was no phone-specific action layout.
- **Player:** the title lived in an `mr-auto` flex child without `min-w-0`, and used `truncate`. The completion badge and telemetry competed for the same row. The telemetry span used `ml-auto` and forced a wide inline line. `LearningRecordEditor` used the same non-shrinking `mr-auto` pattern.
- **Shared button:** the base `Btn` class lacked `min-w-0`/`max-w-full`, so long labels could push a flex row wider than its container.

### 5.2 Changes

- Library now renders a phone card list below `md`:
  - full wrapping titles with `break-words` and a `title` attribute;
  - position, duration, completion, confidence and revision status as wrapping metadata;
  - 44px minimum action targets for YouTube, done/not-done and revision;
  - the desktop table is hidden below `md` and remains available at `md` and above.
- Filter and sort widths become half-width on phones and fixed widths from `sm` upward.
- Player now wraps the full title instead of truncating it; the title container can shrink (`min-w-0 flex-1`), the completion badge can wrap, and telemetry is full-width on phones and auto-width from `sm` upward.
- Learning-record header now uses `min-w-0 flex-1` rather than `mr-auto`.
- Shared `Btn` now includes `max-w-full min-w-0`.

No global font-size reduction and no page-level `overflow-x: hidden` masking were used.

### 5.3 Verification and limitation

`frontend/tests/responsive-layout.test.tsx` (2 tests) verifies:

- Library exposes a phone card list with the full long title and structured metadata, and does not rely on the 640px table for the phone path;
- Player renders the complete long title and complete telemetry text, including the unique-coverage segment.

**Limitation:** no real browser was available. The requested 320/360/375/390/430/768/1024/1280/1440/1920 px screenshots, focus-outline review, drawer interaction and touch-target visual audit were **not** performed. jsdom structure tests are not a substitute for real-browser layout evidence. Installing Playwright or browser binaries was not authorized.

---

## 6. Arena documentation and integrity

### 6.1 Canonical guide

Created `docs/user-doc/ARENA_COMPLETE_GUIDE.md` as the single standalone Arena reference. It covers:

1. What Arena is and is not.
2. Model version `arena-v2` and why versioning exists.
3. Exact formula, units, caps, null propagation and worked components.
4. Playlist duration denominator, unresolved duration and duplicate occurrence identity.
5. Completed/manual/verified evidence labels.
6. Qualifying-day definition with qualifying and non-qualifying examples.
7. Window, timezone, fixed dates and provisional eligibility.
8. Synthetic competitor generation, tiers, seeds, stable identities, caps and display-only fields.
9. Competition rank, ties, percentile denominator, provisional rows, ordering and rank history.
10. Every current setting with default, range, effect, scoring impact and fixed-run behavior.
11. Official season versus private practice reality.
12. Reset, playlist changes, seed changes and replay determinism.
13. Empty/incomplete/imported/zero-duration/new-user states.
14. Anti-manipulation protections and client-computation limitations.
15. Worked examples for consistent, burst, one-minute, completed, unresolved and tied cases.
16. Section-by-section UI map.
17. FAQ and plain-language explanation.
18. Developer reference, constants, persistence, version rules and test files.
19. An implementation status matrix separating **implemented and tested**, **not browser-verified**, **proposed/not implemented** and **known limitation**.

The guide does not present proposed global seasons, real-person matchmaking, server-certified scores or automatic rollover as existing features. The 75/25 weights were not changed.

### 6.2 Integrity fixes

- Added `endFixedChallenge` to the store. Previously `setChallenge` correctly refused edits during a fixed run, which also prevented the UI from ending the run. The explicit action now returns to editable practice without touching learning records.
- Fixed runs are bound to the playlist/basis captured at start:
  - `Competition.tsx` uses the frozen playlist snapshot, not the currently active playlist;
  - if the captured playlist disappears, Arena shows unavailable and does not substitute another playlist;
  - the snapshot now stores `playlistEntryCount` and `playlistAvgVideoSec` for rival simulation only.
- Fixed-run observed days now count frozen calendar date keys already reached in the user's timezone, instead of UTC elapsed-time arithmetic.
- Rank history is capped at 100 snapshots (`slice(-99)` before appending), with a regression test.
- Fixed-run start is disabled when the configuration is invalid.
- The fixed-run UI labels itself a **private, client-computed snapshot**, not a global official season.
- Reset still clears simulation history/config only, never learning data.

Arena tests cover the score formula, clamps, ties, percentile, provisional exclusion, unavailable denominators, locked/ended fixed runs, frozen playlist binding and the 100-snapshot cap.

**Limitation:** Arena remains client-computed. No server-side score certification or anti-cheat review exists. Fixed runs read live learning evidence while keeping the denominator frozen; the guide documents that tension.

---

## 7. Legacy-to-Unified migration

### 7.1 Complete 20-domain mapping

Legacy uses one physical collection per domain: `lq_data_<domain>`. Unified uses one collection `lq_user_data` with a `domain` field. Both expose the same repository contract.

| # | Domain | Legacy collection | Unified record | Stable key / identity | Notes |
|---:|---|---|---|---|---|
| 1 | `playlists` | `lq_data_playlists` | `lq_user_data` (`domain: playlists`) | Playlist ID | Map; snapshot payload |
| 2 | `meta` | `lq_data_meta` | `lq_user_data` | Playlist ID | Map; archive/add metadata |
| 3 | `progress` | `lq_data_progress` | `lq_user_data` | Entry identity (`entryId`, or position/video fallback) | Map; notes/revision |
| 4 | `ranges` | `lq_data_ranges` | `lq_user_data` | Range `id` | List |
| 5 | `checkpoints` | `lq_data_checkpoints` | `lq_user_data` | Checkpoint `id` | List |
| 6 | `modules` | `lq_data_modules` | `lq_user_data` | Module `id` | List |
| 7 | `sessions` | `lq_data_sessions` | `lq_user_data` | Session `id` | Append-capable list |
| 8 | `goals` | `lq_data_goals` | `lq_user_data` | Date key | Map |
| 9 | `xp` | `lq_data_xp` | `lq_user_data` | XP `id` / `dedupKey` | Append-capable; dedup preserved |
| 10 | `achievements` | `lq_data_achievements` | `lq_user_data` | Achievement key | Map |
| 11 | `segments` | `lq_data_segments` | `lq_user_data` | Segment `id` | Append-capable list |
| 12 | `playSessions` | `lq_data_playSessions` | `lq_user_data` | Play-session `id` | Append-capable list |
| 13 | `queue` | `lq_data_queue` | `lq_user_data` | Playlist ID | Map |
| 14 | `flexGoals` | `lq_data_flexGoals` | `lq_user_data` | Goal `id` | List |
| 15 | `challenge` | `lq_data_challenge` | `lq_user_data` | `singleton` | Simulator config |
| 16 | `challengeEnabled` | `lq_data_challengeEnabled` | `lq_user_data` | `singleton` | Boolean flag |
| 17 | `rankHistory` | `lq_data_rankHistory` | `lq_user_data` | Rank snapshot `id` | List, capped at 100 |
| 18 | `settings` | `lq_data_settings` | `lq_user_data` | `singleton` | Settings |
| 19 | `prefs` | `lq_data_prefs` | `lq_user_data` | `singleton` | Preferences |
| 20 | `activeId` | `lq_data_activeId` | `lq_user_data` | `singleton` | Active playlist ID |

Preserved for every record: `userId`, stable key, `value` payload exactly, `updatedAt`, `order` where present, optional `playlistId` attribution, and append/optimistic-version semantics. Empty domains remain empty logical domains; they are not synthesized from another source.

### 7.2 Durable freeze

- `lq_migration_control` stores one document with `_id: "active"` containing migration ID, schema version, direction, source/target store, generation, domains, optional account scope, timestamps, phase, release reason and smoke result.
- Every identified learning-data write path checks the fence:
  - account profile/preferences mirror writes;
  - full-state PUT, append, import and local-data migration;
  - playlist archive/restore/permanent delete;
  - account deletion.
- The service layer (`replaceUserCollection`, `appendUserCollection`, `replaceAllUserState`, archive/delete, account deletion) also enforces the fence, so a newly added route cannot bypass admission silently.
- Active fence returns `503 MIGRATION_READ_ONLY`. Reads continue.
- The frontend detects that code, preserves in-tab edits, shows a read-only banner, and offers the existing retry-save action. It does not discard queued changes.
- Fence acquisition is atomic: one document and a generation check. Two processes cannot both acquire; a released fence can be reused only through a conditional update.
- Drain waits for all per-account `writeLease` counters to reach zero, recovers a stale crashed lease after the existing 30-second stale window, and fails closed with `MIGRATION_DRAIN_TIMEOUT` without taking a snapshot.
- Release requires a matching migration ID and a passing insert/read/delete smoke test on the selected mode. A failed smoke leaves the fence active.

### 7.3 Forward copy and journal

- `npm run migrate:controlled -- forward` is a deterministic, zero-write dry run. `--apply` requires `LQ_USER_DATA_STORE=legacy` and `--confirm lq-data-to-user-data-v1`.
- Apply re-inspects before copying; any duplicate, malformed record, destination conflict or blocking issue aborts the whole run.
- Copies are idempotent inserts. An identical destination record is skipped; a different one is a conflict and is never overwritten.
- Before copying, the tool writes a payload-free per-account/per-domain plan to `lq_migration_journal`.
- Each domain is marked `copying`, copied, re-inspected, and marked `verified` only when pending = 0, matched = valid source keys, and the source checksum matches.
- A failed domain is marked `failed` with a bounded error string. Verified domains can resume, but each resumed domain is revalidated against live counts/checksums before being skipped.
- Source mutation during copy is detected by the post-copy inspection and fails the run closed.
- Legacy collections are only read; they remain unchanged.
- `status` shows both forward and reverse journal progress.
- `status`/dry run use a read-only adapter and do not create indexes or collections.

### 7.4 Reverse copy and rollback

- `npm run migrate:controlled -- reverse` performs a dry run; `--apply` requires `LQ_USER_DATA_STORE=unified` and the same confirmation.
- Reverse treats Unified as authoritative while the fence is active.
- The dry run reports pending Unified keys, changed Legacy records (conflicts that will be replaced), stale Legacy-only keys, duplicates and malformed records.
- Stale Legacy-only records block by default. `--allow-stale-destination` is explicit and removes only keys absent from Unified after approval and logging.
- Reverse apply copies missing records, updates changed records, optionally removes approved stale records, journals each domain, and requires post-copy parity.
- A run is `incomplete` unless pending = 0, conflicts = 0, destination-only = 0 and the checksums match. The fence stays active on failure.
- `release --reason cutover` requires the selected mode to be `unified`; `release --reason rollback` requires `legacy`. The CLI refuses a mismatched mode.
- Unified data is never dropped during rollback. Legacy is never retired in this phase.

### 7.5 No silent fallback

`LQ_USER_DATA_STORE=unified` requires `LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1` in production. The active repository selects exactly one backend; there is no automatic fallback to Legacy and no merging of both sources. An empty Unified account fails clearly instead of rendering an empty dashboard.

### 7.6 Operator entry points and documentation

- `backend/src/scripts/controlledMigration.ts`, package script `migrate:controlled`:
  - `status`
  - `forward [--apply]`
  - `reverse [--apply]`
  - `release --reason <cutover|rollback|aborted>`
  - `smoke`
- `backend/src/scripts/compareMigrationReports.ts`, package script `compare:migration-reports`, compares two dry-run reports without printing payloads.
- `docs/user-doc/MIGRATION_RUNBOOK.md` documents inventory, freeze/drain, forward, cutover gates, backup/restore, failure handling and the final stop gate.
- `docs/user-doc/MIGRATION_ROLLBACK.md` documents reverse migration, stale/conflict approval, mode switch, smoke release and data-loss boundaries.

### 7.7 Backup and restore

**What was performed:** an isolated **logical** restore rehearsal cloned two synthetic accounts and 23 learning records (25 documents including accounts) from one database into a separate empty database with the MongoDB driver. The restored dry-run report matched the baseline:

- source documents: 23;
- valid source keys: 23;
- account/domain units compared: 40;
- canonical source checksum: `3f290ef61bab91a08cc080262f4af347f05829b4e39244603436e765fe92b756`;
- comparator: `PASS`;
- deleting one restored `progress` record made the comparator `FAIL` with a document-count mismatch.

**What was not performed:** `mongodump`/`mongorestore` are not installed on this workstation, and no production backup was taken. A CLI logical clone is not a tool-level backup proof. The production backup/restore gate remains pending and mandatory.

---

## 8. Verification evidence

### 8.1 Runtime and default suites

| Check | Command | Result |
|---|---|---|
| Runtime | `node --version` | `v24.22.2` |
| Package manager | `npm --version` | `11.19.1` |
| Backend tests | `npm test` (backend) | 29 files passed, 2 skipped; 237 tests passed, 2 skipped |
| Frontend tests | `npm test` (frontend) | 45 files passed; 392 tests passed |
| Backend typecheck | `npm run typecheck` | exit 0 |
| Frontend typecheck | `npm run typecheck` | exit 0 |
| Backend lint | `npx eslint .` | 0 errors, 88 warnings |
| Frontend lint | `npx eslint .` | 0 errors, 4 warnings |
| Backend build | `npm run build` | exit 0 |
| Frontend build | `npm run build` | production build succeeded |
| Backend production audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Frontend production audit | `npm audit --omit=dev` | 0 vulnerabilities |

The two skipped backend files are the gated MongoDB integration suites; each contains one test that skips unless `LQ_TEST_MONGO_URI` is supplied. Both passed when the isolated replica set was available (sections 8.2 and 8.3).

### 8.2 Isolated MongoDB replica-set rehearsal

Environment: local replica set `lqp24` at `127.0.0.1:27018`, database `learnquest_phase24_rehearsal`, synthetic data only.

```powershell
$env:LQ_TEST_MONGO_URI = 'mongodb://127.0.0.1:27018/?replicaSet=lqp24'
npx vitest run tests/mongo-migration.integration.test.ts --reporter=verbose
```

Result: **1/1 passed**. The test proves:

- 20 legacy domains seeded for one synthetic account;
- dry run writes zero destination records;
- an active fence blocks `replaceUserCollection` with `MIGRATION_READ_ONLY`;
- forward apply reports 20 matched keys, 0 pending, source checksum = matched destination checksum;
- Legacy remains unchanged;
- deleting one destination record and rerunning resumes with 19 revalidated domains and 1 copy;
- a Unified-era `progress` change survives reverse migration into Legacy;
- reverse journal reports 20 verified domains;
- fence release smoke passes;
- a real MongoDB transaction writes version 1 after release.

This is local staging evidence. It is **not** production-scale or production-transaction proof.

### 8.3 Logical restore comparison

```powershell
npx vitest run tests/mongo-backup-restore.integration.test.ts --reporter=verbose
```

Result: **1/1 passed**. Baseline and restored reports matched across 40 account/domain units and 23 source documents. The damaged-restore negative case failed comparison as required.

```powershell
npm run compare:migration-reports -- restore-baseline.json restore-restored.json
```

Result:

```text
Restore comparison: PASS
Direction: forward
Source documents: 23
Valid source keys: 23
Canonical checksum: 3f290ef61bab91a08cc080262f4af347f05829b4e39244603436e765fe92b756
Account/domain units compared: 40
No record payloads were printed.
```

### 8.4 Migration test inventory

- `backend/tests/migration-control.test.ts` (10 tests): fence visibility and write blocking, second-process refusal, released-fence reuse, live/stale drain, reverse copy/update, stale-destination block/removal, smoke-failure release block, payload-free resumable journal, Unified source-mutation detection, 20-domain inventory.
- `backend/tests/user-data-migration.test.ts` (16 tests): deterministic zero-write dry run, all-domain copy/idempotency, 1,205-record paged copy, duplicate/malformed/conflict blocking, incomplete verification, source mutation, scoped copy, destination-only warnings, deleted/deleting account blocks, mid-copy deletion cleanup, invalid owner, options validation.
- `backend/tests/mongo-migration.integration.test.ts` (gated): replica-set forward/reverse/transaction/resume proof.
- `backend/tests/mongo-backup-restore.integration.test.ts` (gated): logical restore comparison and negative control.

### 8.5 Focused frontend/identity evidence

- `frontend/tests/auth-repair.test.tsx`: unknown sign-in identity becomes explicit creation; blocked auto-link copy does not offer takeover.
- `frontend/tests/cloud-persistence.test.tsx`: migration read-only preserves the local edit and retries after release.
- `frontend/tests/responsive-layout.test.tsx`: full Library title/phone card structure; full Player title and telemetry.
- `frontend/tests/arena.test.ts` and `frontend/tests/store-integrity.test.tsx`: formula/rank/tie/provisional behavior, fixed-run lock/end, frozen snapshot, 100-snapshot cap.

---

## 9. Production cutover readiness gates

| Gate | Required evidence | Current status |
|---|---|---|
| Exact target database/environment named without secrets | Non-secret database name and environment label | **Pending owner confirmation** |
| 20-domain inventory matched | Code inventory + preflight dry run | **Pass in local review** |
| Staging parity artifact | Replica-set integration output | **Pass locally; not production-scale** |
| Backup restore proof | Real `mongodump`/`mongorestore` artifact + comparator PASS | **Pending; tools not installed and production backup not taken** |
| Freeze/drain proof | Fence document + drain artifact | **Pass locally** |
| Destination-only/conflict reconciliation approvals | Written owner approval per key group | **Pending production run** |
| Reverse-migration rehearsal | Reverse apply artifact with checksum parity | **Pass locally** |
| Rollback decision and maintenance window | Named owner, window, duration | **Pending** |
| Final source/target counts and checksums | Forward apply artifact from the target | **Pending production run** |
| Exact operator command/config change | Approved runbook and change record | **Prepared, not approved** |
| Real-browser/device verification | Browser suite or explicit accepted limitation | **Not performed** |
| Owner final authorization | Explicit written approval | **Not given** |

**Production cutover is blocked until every gate passes and the owner gives explicit authorization.** The runbook stops at that gate by design.

---

## 10. Files changed

### Backend

- `backend/package.json` - added `migrate:controlled` and `compare:migration-reports`.
- `backend/src/auth/accounts.ts` - Google/email locks, duplicate-key resolution, safe email conflict.
- `backend/src/routes/auth.ts` - linked-sub resolution from both intents; unknown sign-in never creates.
- `backend/src/db/mongo.ts` - partial Google-subject index replacement, migration indexes, direct adapter with real transactions.
- `backend/src/routes/account.ts` - migration write gate on account learning writes and deletion.
- `backend/src/routes/playlists.ts` - migration write gate on archive/restore/delete.
- `backend/src/services/userData.ts` - service-level migration write gate.
- `backend/src/services/accountDeletion.ts` - deletion blocked while a migration fence is active.
- `backend/src/services/userDataMigration.ts` - durable journal/resume, per-domain post-copy verification, shared inspection helpers.
- `backend/src/services/userDataReverseMigration.ts` - reverse inspection/apply, conflicts, stale handling, journaling, parity.
- `backend/src/services/migrationControl.ts` - durable fence, drain, smoke, journal, status.
- `backend/src/services/migrationReportComparison.ts` - payload-free restore comparison.
- `backend/src/scripts/controlledMigration.ts` - operator CLI.
- `backend/src/scripts/compareMigrationReports.ts` - restore-comparison CLI.
- `backend/src/scripts/diagnoseMongo.ts` - accept legitimate custom DB names and report only non-secret configuration.
- `backend/src/store.ts` - migration collections and store bindings.
- `backend/tests/multiuser.test.ts` - identity/race coverage.
- `backend/tests/user-data-migration.test.ts` - migration incl. 1,205-record paging test.
- `backend/tests/migration-control.test.ts` - fence/reverse/journal tests.
- `backend/tests/mongo-migration.integration.test.ts` - gated replica-set rehearsal.
- `backend/tests/mongo-backup-restore.integration.test.ts` - gated logical restore rehearsal.
- `backend/tests/fixtures/migrationSample.ts` - shared synthetic 20-domain fixture.

### Frontend

- `frontend/src/features/auth/AuthScreens.tsx` - unknown sign-in lands on explicit creation; safe link copy.
- `frontend/src/app/store.tsx` - `migrationReadOnly`, read-only sync handling, `endFixedChallenge`, rank cap.
- `frontend/src/app/App.tsx` - migration read-only banner.
- `frontend/src/features/playlists/Library.tsx` - phone card list, wrapping metadata, responsive controls, 44px actions.
- `frontend/src/features/player/Player.tsx` - wrapping title/metadata and responsive telemetry.
- `frontend/src/features/player/LearningRecordEditor.tsx` - shrinkable header.
- `frontend/src/components/ui/ui.tsx` - shared button containment.
- `frontend/src/features/competition/Competition.tsx` - fixed-playlist binding, observed-day/timezone handling, private-run labels, disabled invalid start.
- `frontend/src/domain/competition/competition.ts` - frozen entry count/average duration.
- Tests: `auth-repair.test.tsx`, `cloud-persistence.test.tsx`, `responsive-layout.test.tsx`, `arena.test.ts`, `store-integrity.test.tsx`.

### Documentation

- `docs/user-doc/ARENA_COMPLETE_GUIDE.md` - canonical Arena guide.
- `docs/user-doc/MIGRATION_RUNBOOK.md` - production forward/cutover runbook.
- `docs/user-doc/MIGRATION_ROLLBACK.md` - reverse/rollback runbook.
- `docs/user-doc/audit2/24_LEARNQUEST_ACCOUNT_IDENTITY_UNIFIED_MIGRATION_AND_RESPONSIVE_REPORT_2026-10-31.md` - this report.
- `docs/user-doc/audit2/README.md` - archive entry.

The final `git status` is recorded in section 12. All changes remain uncommitted.

---

## 11. Remaining limitations and next owner decisions

1. **Production database topology is unverified.** The owner must confirm the production database/environment and whether local and production share a database. No production query was made.
2. **Real backup/restore proof is missing.** Install/approve MongoDB Database Tools, take an isolated backup, restore into a separate empty database, and record a comparator PASS before cutover.
3. **Production-scale staging is missing.** The local replica set proves protocol mechanics and transactions, not production payload sizes, timing, pool limits or Render behavior.
4. **Real-browser responsive/accessibility verification is missing.** No Playwright/browser binaries were installed. The 320-1920 px sweep, screenshots, focus outlines, touch targets and drawer behavior remain unverified in a browser.
5. **Google/Brevo/live production verification is missing.** No live Google exchange or email send was performed.
6. **Self-service secure account linking is not implemented.** Accounts with a matching email but different/unlinked Google `sub` are safely blocked with instructions; a recent-auth linking flow remains future work.
7. **No automatic resave after a migration freeze.** Local edits are preserved and the existing retry-save path works; the app does not continuously poll and resubmit. The banner says to keep the tab open and retry.
8. **Initial account-data read remains full-state.** History/Analytics pagination was not added; this was outside the four priorities.
9. **Remote-device visual freshness is still not live-verified.**
10. **Arena is client-computed.** No server score certification, global seasons, real-person cohorts, fixed-run archive or automatic rollover exists.
11. **Destination-only/conflict reconciliation needs owner decisions** once a real target is inspected.
12. **No production cutover.** The next step is owner review of this report, the runbook, the target database and backup proof. Do not change `LQ_USER_DATA_STORE` before the stop gate is signed.

---

## 12. Final Git state

Working tree is **uncommitted**. Baseline HEAD remains:

```text
d2eb55be3e030b63eab845037389ec2da8e43af9 feat: complete LearnQuest Phase 23 reliability improvements
```

Modified/untracked paths at report time:

```text
 M backend/package.json
 M backend/src/auth/accounts.ts
 M backend/src/db/mongo.ts
 M backend/src/routes/account.ts
 M backend/src/routes/auth.ts
 M backend/src/routes/playlists.ts
 M backend/src/scripts/diagnoseMongo.ts
 M backend/src/services/accountDeletion.ts
 M backend/src/services/userData.ts
 M backend/src/services/userDataMigration.ts
 M backend/src/store.ts
 M backend/tests/multiuser.test.ts
 M backend/tests/user-data-migration.test.ts
 M docs/user-doc/audit2/README.md
 M frontend/src/app/App.tsx
 M frontend/src/app/store.tsx
 M frontend/src/components/ui/ui.tsx
 M frontend/src/domain/competition/competition.ts
 M frontend/src/features/auth/AuthScreens.tsx
 M frontend/src/features/competition/Competition.tsx
 M frontend/src/features/player/LearningRecordEditor.tsx
 M frontend/src/features/player/Player.tsx
 M frontend/src/features/playlists/Library.tsx
 M frontend/tests/arena.test.ts
 M frontend/tests/auth-repair.test.tsx
 M frontend/tests/cloud-persistence.test.tsx
 M frontend/tests/store-integrity.test.tsx
?? backend/src/scripts/compareMigrationReports.ts
?? backend/src/scripts/controlledMigration.ts
?? backend/src/services/migrationControl.ts
?? backend/src/services/migrationReportComparison.ts
?? backend/src/services/userDataReverseMigration.ts
?? backend/tests/fixtures/
?? backend/tests/migration-control.test.ts
?? backend/tests/mongo-backup-restore.integration.test.ts
?? backend/tests/mongo-migration.integration.test.ts
?? docs/user-doc/ARENA_COMPLETE_GUIDE.md
?? docs/user-doc/MIGRATION_ROLLBACK.md
?? docs/user-doc/MIGRATION_RUNBOOK.md
?? docs/user-doc/audit2/24_LEARNQUEST_ACCOUNT_IDENTITY_UNIFIED_MIGRATION_AND_RESPONSIVE_REPORT_2026-10-31.md
?? frontend/tests/responsive-layout.test.tsx
```

No commit, push or deployment was made.

---

## 13. Conclusion

Phase 24 delivered a safer Google-first identity flow, responsive containment fixes, a complete Arena specification with fixed-run integrity repairs, and a controlled migration system with real local replica-set and restore-comparison evidence. The work is **not** a production cutover: production remains on Legacy, no production data was touched, and the backup/restore, production-scale, real-browser and owner-authorization gates are still open.

**Status: PASS WITH LIMITATIONS for product workstreams; BLOCKED for production Unified cutover pending the gates in section 9.**
