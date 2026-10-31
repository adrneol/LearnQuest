# Report 25 - LearnQuest Final Release Quality, Security, Data-Integrity and Readiness Audit

**Date:** 2026-11-01  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `d2eb55be3e030b63eab845037389ec2da8e43af9` (Phase 23)  
**Upstream relationship:** `origin/main` is one commit behind local `main`; no commit, push, rebase, reset or clean was performed  
**Runtime:** Node `v24.22.2`, npm `11.19.1`  
**Production storage scope:** no production migration was performed; the inspected repository configuration remains Legacy (`LQ_USER_DATA_STORE=legacy`). The actual deployed production setting was **not independently verified**.  
**Production migration/cutover:** not performed, not authorized

---

## 1. Executive summary

This was an independent final audit of LearnQuest after Phase 24. It covered the whole application, not only the Phase 24 files: authentication and account identity, the 20 learning-data domains, append persistence, Focus XP, calculations, Arena, the responsive UI, API/deployment behavior, dependency health, and both migration runbooks. The existing uncommitted work was inspected and preserved.

**Result: no P0 defect was found. One P1 release-gating defect, three P2 defects and one regression-coverage gap were identified and resolved in the working tree. The local test, typecheck, build, lint, dependency and isolated-replica-set checks pass. The application is a clean *local* release candidate, but it is not production-verified and it is not a production migration approval.**

| Area | Result | Evidence boundary |
|---|---|---|
| Account identity and session security | **PASS WITH LIMITATIONS** | Mocked Google/OAuth/email tests; no live Google or Brevo exchange |
| 20-domain persistence and account isolation | **PASS WITH LIMITATIONS** | Full suites and multi-account tests; no production data access |
| Bounded append writes and retries | **PASS** | Idempotency, conflict, duplicate-ID, XP-dedup and timeout tests |
| Cloud-mode Focus XP | **PASS** | XP is credited only after the session write is server-confirmed |
| Migration fence, forward/reverse, resume | **PASS LOCALLY** | Isolated replica-set rehearsal; not production scale |
| Migration release gate | **FIXED (P1)** | Direction, full account scope, all 20 domains, verified journal, live parity, matching smoke mode |
| Arena v2 formulas and edge cases | **PASS WITH LIMITATIONS** | Deterministic client calculation; not server-certified |
| Responsive and accessibility | **NOT VERIFIED** | No browser binary; jsdom is not visual or axe evidence |
| Documentation links | **PASS** | Local Markdown link checker; historical reports retained as summaries |
| Production readiness | **BLOCKED** | Every production gate remains pending; inspected repository configuration remains Legacy, while the deployed production setting is not independently verified |

**Release decision:** the working tree may be used as a **local release candidate**. Production cutover, production deployment and any claim of real-browser verification remain blocked. No production database, account, email, Google identity, configuration or collection was read or changed.

---

## 2. Baseline, scope and safety boundaries

- The committed baseline is `d2eb55be3e030b63eab845037389ec2da8e43af9` (Phase 23). The working tree contains the intended Phase 24 changes plus this audit's fixes.
- `main` is ahead of `origin/main` by one commit; the Phase 24 work is uncommitted and unpushed.
- All pre-existing modifications were preserved. No reset, clean, stash, destructive checkout, commit, push, rebase or force-push was used.
- No `.env` value, MongoDB URI, password, token, cookie, OAuth secret, API key or personal learning payload is reproduced in this report.
- No production database read/write, account lookup by email, migration, index change, collection deletion/retirement, real email/OTP call, real Google exchange, Brevo call or production configuration change was performed.
- The only database used for integration work was the isolated local replica set `lqp24` at `127.0.0.1:27018`, database `learnquest_phase24_rehearsal`, populated with synthetic fixtures and dropped before and after the test.
- The Atlas screenshot in the request provides database names and sizes only. It does not establish which database is production, which storage layout is active, or whether the deployed application is current. No topology conclusion was drawn from it.

### 2.1 What was verified versus not verified

| Category | Status |
|---|---|
| Implemented and unit/component tested locally | **Verified** |
| Isolated MongoDB replica-set integration | **Verified** on synthetic local data |
| Real-browser layout, keyboard, touch and screenshots | **Not verified** - no approved browser/Playwright binary |
| Production database, Render, Vercel, Atlas, Google or Brevo | **Not verified** - no production access or live provider call |
| Production backup/restore (`mongodump`/`mongorestore`) | **Not verified** - tools are not installed; logical clone only |
| Production-scale migration and reconciliation | **Not verified** |
| Production storage setting | **Only the inspected repository configuration is Legacy; the deployed production setting was not independently verified.** No production migration was performed. |

---

## 3. Findings register

Severity uses the requested scale: P0 data loss/account takeover/cross-account access; P1 serious correctness, persistence, authentication, migration or release blocker; P2 meaningful UX/accessibility/performance/reliability issue; P3 cosmetic or low-impact.

| ID | Severity | Status | Finding | Evidence / impact | Resolution |
|---|---|---|---|---|---|
| F25-01 | **P1** | **FIXED** | A migration fence could be released as `cutover` or `rollback` after only a smoke test, even when the run was scoped, partial, unfinished or used the wrong mode's evidence. | A scoped/partial forward run could expose accounts that were never copied; a failed reverse run could return a partial Legacy view; wrong-mode smoke evidence could bless the wrong store. | Added full release-evidence validation and live source/destination parity. See §5.1. |
| F25-02 | **P2** | **FIXED** | Arena counted any progress record with `completedAt` as a completed video for the qualifying-day signal, even when the canonical completion predicate was false. | A record with `completedAt` but `status: "in-progress"` (or an orphaned record) could inflate qualifying days and disagree with unique-coverage completion. | Both completion signals now use the canonical `isProgressComplete` predicate. See §5.2. |
| F25-03 | **P2** | **FIXED** | `release --reason aborted` could release the fence while the deployment was already on the migration target, blessing a partially populated destination. | An incomplete forward migration followed by an early mode switch and an abort could expose a partial Unified view. | Aborted release now requires smoke evidence from the fence **source** store; runbooks require switching back first. See §5.3. |
| F25-04 | **P2** | **FIXED** | Release documentation links and the audit archive were stale: the old deployment document was referenced, and the archive index had no row for Report 24 (or the new Report 25). Ten relative links in the vendored `.agents/skills` reference docs also had duplicated/missing path segments. | Operators could follow a dead deployment link; the archive did not expose the latest evidence; skill-reference links did not resolve. | README/user guide links corrected; archive rows added; vendor skill paths corrected; a dependency-free `scripts/check-markdown-links.mjs` now checks all 169 local links across 143 files. See §5.4. |
| F25-05 | **P3** | **RESOLVED (coverage)** | Duplicate stable IDs inside one append request had no dedicated regression test. | The server already rejected this through `validateCollectionPayload`; the missing test was a coverage gap, not a demonstrated behavior defect. | Added a two-case regression test proving rejection before storage mutation. See §5.5. |
| F25-06 | **P3** | **OPEN (non-production)** | Full dependency audits report moderate advisories in development tooling only (`minimatch` through ESLint/TypeScript-ESLint; Vite dev-server advisory). | Production audits are clean; the advisories do not ship in the production dependency tree. | No upgrade was forced. Plan a separate ESLint/Vite maintenance upgrade; do not run `npm audit fix --force` because it proposes an incompatible ESLint downgrade. See §9.6. |
| F25-07 | **P3** | **OPEN (non-blocking)** | Lint/test warnings remain: 88 backend warnings (`no-explicit-any`), 4 frontend hook-dependency warnings, and Recharts zero-size warnings in jsdom. | Zero lint errors; no known runtime failure. The Recharts warnings are a jsdom layout limitation, not production evidence. | Classified and retained; no warning was hidden or suppressed. See §9.5. |
| F25-08 | **P2** | **OPEN (contained limitation)** | The initial account-data read remains a full-state read of all 20 domains; large histories are not paginated or lazy-loaded. | Large accounts may face a heavier first load and larger response. Append writes bound *new* high-volume records, not the initial read. | Documented as a remaining scalability limitation. A pagination/lazy-history project needs separate design and compatibility work. |
| F25-09 | **P2** | **OPEN (verification blocked)** | Real-browser responsive, keyboard, dialog, touch-target and accessibility verification was not performed. | jsdom tests prove structure and text; they cannot prove 320-1920 px layout, focus order, overflow or contrast. | No browser binaries were installed without approval. Real-browser evidence remains a release gate. See §10. |

---

## 4. Confirmed defects, root causes and user/data impact

### 4.1 F25-01 - Migration release evidence was not sufficient (P1)

**Affected flow:** `backend/src/services/migrationControl.ts`, `backend/src/scripts/controlledMigration.ts`, forward and reverse migration release.

**Before the fix:** `releaseMigrationFence()` checked the migration ID, smoke `passed`, and (after a later hardening) the smoke mode. It did not prove that the fence was a full-account forward/reverse run, that all 20 domains were covered, that every journal unit was verified, or that the two stores still matched at release time. The operator could therefore run:

```text
forward --user <one-account> --apply
release --reason cutover
```

or leave a failed/partial journal and still release, exposing unmigrated accounts after the global mode switch. It was also possible to supply a passing smoke result for the wrong store.

**Root cause:** the gate treated "the selected store can read and write" as equivalent to "the migration is complete." Those are different properties. Smoke evidence proves adapter reachability; it does not prove migration coverage or parity.

**Impact:** a production cutover could serve an empty or partial Unified account while the fence said the migration was released. This is a release-blocking safety defect even though it requires an operator sequence.

**Fix:**

- `cutover` requires a `forward` fence with target `unified`.
- `rollback` requires a `reverse` fence with target `legacy`.
- `fence.userIds` must be `null` (all accounts, not a scoped list).
- The fence must name all 20 `USER_COLLECTIONS` domains, with no missing/duplicate substitution.
- Every journal entry for that migration ID and direction must be `verified`.
- The CLI re-inspects the live source and destination immediately before release and requires:
  - a `ready` plan;
  - `pendingKeys = 0`;
  - `conflicts = 0`;
  - `destinationOnlyKeys = 0`;
  - `matchedKeys = validSourceKeys`;
  - identical canonical checksums.
- The supplied or freshly run smoke test must be for the release target (`unified` for cutover, `legacy` for rollback).
- A failed check leaves the fence active and writes blocked. `--reason aborted` remains the explicit escape hatch, but is source-mode-gated (F25-03).

**Regression tests:** `backend/tests/migration-control.test.ts` now covers scoped account runs, incomplete domain lists, wrong direction, unverified journals, smoke failure, target-mode smoke mismatch, and the successful evidence-gated cutover. `backend/tests/mongo-migration.integration.test.ts` exercises real forward parity, resume, cutover release, reverse parity and rollback release on the isolated replica set.

### 4.2 F25-02 - Arena used two different completion predicates (P2)

**Affected flow:** `frontend/src/domain/competition/competition.ts`, `computeArenaUserEvidence()`.

**Before the fix:** unique content used the canonical `isProgressComplete` predicate, but the daily "completed video" signal used `rec.completedAt` alone. A record with a completion timestamp but a non-`done` status, or an orphaned record, could contribute a qualifying day while contributing no unique content.

**Root cause:** a duplicated ad-hoc completion check drifted from the single canonical predicate in `frontend/src/domain/progress/identity.ts`.

**Impact:** Arena consistency and qualifying-day counts could be inflated or internally inconsistent. The score remained client-computed and bounded, so this was not a security or cross-account defect, but it was a real correctness defect in a documented formula.

**Fix:** daily completion and unique coverage now both use `isProgressComplete(rec)`; the completion timestamp is read only after that predicate succeeds.

**Regression test:** `frontend/tests/arena.test.ts` adds a record with `completedAt` set and `status: "in-progress"`; the test asserts `manualCompleted = 0`, `verifiedCompleted = 0`, `uniqueContentSec = 0`, `completedVideo = false`, and `qualifyingDays = 0`.

### 4.3 F25-03 - Aborted release could run on the target store (P2)

**Affected flow:** `releaseMigrationFence()` with `reason: "aborted"`, and the operator CLI.

**Before the fix:** an operator who had already switched `LQ_USER_DATA_STORE` to the migration target could release an incomplete run as `aborted`. The fence would be removed while the application read the partially populated target.

**Root cause:** "aborted" was treated as an unconditional escape from evidence checks, without tying the release to the store that was serving before the migration.

**Impact:** premature exposure of a partial destination if the documented mode-switch order was violated. This is an operator-sequence risk, not a remote exploit, but it is exactly the kind of safety property the fence exists to enforce.

**Fix:** an aborted release now requires `smoke.mode === fence.sourceStore`. The CLI and both runbooks require the deployment to be back on the source store before aborting. A new regression test proves the target-mode release is refused and the source-mode release succeeds. The error code is `MIGRATION_SMOKE_MODE_MISMATCH`.

### 4.4 F25-04 - Stale release documentation and archive index (P2)

**Before the fix:**

- `README.md` and `HOW_TO_USE_LEARNQUEST.md` linked to a deployment document that is no longer present at the linked path.
- `docs/user-doc/audit2/README.md` indexed Reports 01-23 but had no row for the present Report 24, and naturally had no row for this new Report 25.

**Root cause:** documents were reorganized during Phases 23/24 and the archive index was not updated for the newest report.

**Impact:** an operator could follow a dead deployment link, and the audit archive did not present the latest release evidence.

**Fix:** user-facing links now point to the current README configuration/deployment sections; the archive includes Report 24 and Report 25 rows. Ten broken relative links in the vendored `.agents/skills` reference docs were also corrected: the MongoDB reference files linked to `references/source-*.md` from inside `references/`, and the Vercel React skill linked to rule files without the `rules/` prefix. A dependency-free repository script, `scripts/check-markdown-links.mjs`, verifies every relative Markdown path and archive link (143 Markdown files, 169 local links). Historical Reports 01-21 remain represented as summaries, with the Git-history recovery command preserved; no historical evidence was deleted.

### 4.5 F25-05 - Duplicate append IDs were already rejected; coverage added (P3)

The server's canonical collection validator rejects duplicate stable IDs inside one append request before any storage mutation. Because this is a critical idempotency/conflict boundary, a dedicated regression test was added to `backend/tests/account-append.test.ts`:

- two identical copies of the same session ID are rejected with a duplicate-ID error;
- two different payloads sharing one ID are rejected with the same error;
- the account's stored `sessions` collection remains empty.

No service behavior was changed for this item; the test closes a verification gap.

---

## 5. Fixes and changed files

### 5.1 Migration release gate and live parity

| File | Change |
|---|---|
| `backend/src/services/migrationControl.ts` | Direction/target/scope/domain/journal release evidence; source-mode check for abort; existing smoke and fence checks retained. |
| `backend/src/scripts/controlledMigration.ts` | Re-inspects live forward/reverse parity immediately before release; refuses pending, conflicts, destination-only, unmatched keys or checksum mismatch; writes payload-free evidence. |
| `backend/tests/migration-control.test.ts` | 15 tests covering fence visibility, drain, reverse copy, stale-destination handling, release evidence, direction/scope/domain/journal/smoke-mode refusals, and the aborted source-mode rule. |
| `backend/tests/mongo-migration.integration.test.ts` | Isolated replica-set forward/resume/cutover/reverse/rollback transaction rehearsal. |
| `docs/user-doc/MIGRATION_RUNBOOK.md` | Documents the release gate, live parity requirement, source-mode abort rule, and the requirement that every running instance be fence-aware. |
| `docs/user-doc/MIGRATION_ROLLBACK.md` | Documents the reverse release gate and source-mode abort rule. |

### 5.2 Arena completion attribution

| File | Change |
|---|---|
| `frontend/src/domain/competition/competition.ts` | Uses `isProgressComplete` for both unique coverage and completed-day attribution. |
| `frontend/tests/arena.test.ts` | Regression test for `completedAt` with a non-`done` status. |

### 5.3 Documentation and archive

| File | Change |
|---|---|
| `README.md` | Current setup, configuration, deployment and verification-boundary links. |
| `HOW_TO_USE_LEARNQUEST.md` | Links to the current README sections instead of the removed deployment path. |
| `docs/user-doc/audit2/README.md` | Adds Report 24 and Report 25 rows; keeps Reports 01-21 summary/recovery note. |
| `docs/user-doc/MIGRATION_RUNBOOK.md`, `docs/user-doc/MIGRATION_ROLLBACK.md` | Release evidence and abort-mode wording. |
| `.agents/skills/mongodb-schema-design/references/*.md` | Corrected six `references/source-*.md` links to sibling `source-*.md` paths. |
| `.agents/skills/vercel-react-best-practices/AGENTS.md` | Corrected three rule links to `./rules/*.md`. |
| `scripts/check-markdown-links.mjs` (new) | Dependency-free, reproducible checker for every relative Markdown link. |
| `docs/user-doc/audit2/25_LEARNQUEST_FINAL_RELEASE_QUALITY_AND_READINESS_AUDIT_2026-11-01.md` | This report. |

### 5.4 Append regression coverage

| File | Change |
|---|---|
| `backend/tests/account-append.test.ts` | Duplicate stable IDs inside one request rejected before storage mutation. |

### 5.5 Phase 24 work preserved

The following existing Phase 24 work was inspected and retained without weakening:

- Google-subject-first identity resolution, partial unique subject index, email uniqueness, duplicate-key race handling, and explicit `LINK_REQUIRED`.
- Library phone card list, Player title/telemetry wrapping, and the shared responsive button constraints.
- Arena guide, fixed-run playlist binding, explicit end-fixed-run action, and the 100-snapshot cap.
- Durable migration fence, drain, journal, forward/reverse copy, resumable domains, and the controlled operator CLI.
- Account deletion fencing and recovery.
- Append persistence for `sessions`, `segments`, `playSessions` and `xp`; full-replacement fallback for edits, deletions and imports.
- Confirmation-gated Focus XP in cloud mode; pending awards survive a failed save and are credited once after confirmation.
- Focus clock-jump, backward-jump, hidden/sleep-gap, interval-union and multi-tab protections.

---

## 6. Account identity and security audit

### 6.1 Google identity matrix

| Situation | Required behavior | Implemented / tested behavior |
|---|---|---|
| Linked Google subject, Sign In | Existing account signs in | Resolves the linked account and rotates the session; covered by `multiuser.test.ts` |
| Linked Google subject, Sign Up | Existing account signs in; no duplicate | Now resolves the linked account from either intent; unfinished onboarding resumes |
| Unknown Google subject, Sign In | No account creation; explicit create-account path | Callback returns `google_account_not_found`; UI opens the explicit registration screen; no session/account is created |
| Unknown verified subject, Sign Up | Explicit onboarding and account creation | Registration intent creates after verification and goes to onboarding |
| Same email, different/unlinked subject | No auto-link, no takeover, `LINK_REQUIRED` | Email owner is detected; no session is issued; explanatory copy requires the existing sign-in method |
| Unverified Google email | No account creation | Rejected before creation |

**Identity implementation evidence:**

- Google `sub` is the primary stable identity; email is a secondary uniqueness/association signal.
- `emailNormalized` has a database unique index.
- `googleSub` uses a partial unique index (`google_sub_partial_unique_v2`) on string subjects, replacing the old sparse index; the replacement is built before the old index is dropped.
- Account creation is serialized per process on both `google:<sub>` and `email:<normalizedEmail>` locks.
- Cross-process duplicate-key errors re-read the subject and email owner and return either the same account, `LINK_REQUIRED`, or `ACCOUNT_DELETING`; they do not create a second account.
- Email changes translate a raced duplicate key into `EMAIL_TAKEN`.

**Not verified:** a real Google OAuth exchange, Google dashboard configuration, provider-side callback behavior, or live account creation. All identity tests use mocks and synthetic accounts.

### 6.2 Sessions, CSRF, OAuth and rate limits

Source inspection and existing regression suites preserve:

- HttpOnly, Secure, SameSite=Lax cookies using the `__Host-` topology through the same-origin API proxy.
- CSRF token checks on account-data mutations and origin/exact-allow-list validation.
- OAuth state, browser binding, nonce/replay handling, and purpose-bound Google intents.
- Server-side session rotation, revocation, and logout-all behavior.
- Account-deletion fencing and resumable cleanup.
- Mongo-backed shared rate limiting that fails closed when the shared store is unavailable.
- Generic password-recovery responses that do not enumerate account existence.
- Argon2id password hashing with versioned PHC strings.

**Not verified:** live Render/Vercel cookie behavior, live Google callback, real Brevo delivery, real OTP/password-reset email, or production rate-limit counters.

---

## 7. Persistence, data integrity and formulas

### 7.1 The 20 domains

The canonical inventory is `USER_COLLECTIONS` in `backend/src/store.ts`:

`playlists`, `meta`, `progress`, `ranges`, `checkpoints`, `modules`, `sessions`, `goals`, `xp`, `achievements`, `segments`, `playSessions`, `queue`, `flexGoals`, `challenge`, `challengeEnabled`, `rankHistory`, `settings`, `prefs`, `activeId`.

Legacy uses `lq_data_<domain>`; Unified uses `lq_user_data` with a logical `domain` field. Both expose the same repository contract. The migration tests exercise all 20 domains in one synthetic account.

**Verified properties:**

- stable `entryId` identity for playlist occurrences, with a guarded legacy position fallback;
- duplicate video occurrences remain distinct;
- account ownership is checked on every account-data read/write;
- optimistic state versions and transaction boundaries;
- idempotent append retries and conflict refusal for changed stable IDs;
- XP `dedupKey` uniqueness and duplicate logical-award rejection;
- full `PUT` remains the path for edits, deletions and imports;
- empty domains remain empty and are not fabricated;
- import/export and local-to-cloud migration are transactional or explicitly fail closed;
- sign-out/account switch resets account-scoped state and pending Focus awards.

**Append bounds:** at most 5,000 records per append request; the existing per-collection item limits still apply. A lost-response retry returns the existing version when every item is an identical retry.

### 7.2 Focus XP and timing

- Cloud-mode Focus XP is held in `pendingSessionAwards` until the session collection write is confirmed by the server.
- A failed save leaves the award pending; a successful retry credits it exactly once.
- Pending awards are cleared on account reset/sign-out and when the earning session is deleted.
- Focus uses monotonic time when available; active time excludes pauses; hidden/sleep gaps are capped at 60 seconds and marked for review; gaps at/above five minutes are excluded; repeated finish/recovery is idempotent.
- The timer is limited to 24 hours and does not save sessions under 10 seconds.

**Limitation:** jsdom tests simulate clock and visibility changes; they are not a real browser sleep or laptop-lid test.

### 7.3 Playback, progress and efficiency

- Playback coverage is an interval union per playlist occurrence; duplicate segment IDs are ignored; duplicate video occurrences are separate.
- Completion from coverage uses `uniqueSec / durationSec` with a default 0.9 threshold (range 0.5-1.0); manual completion is separate from verified coverage.
- Progress completion is the canonical `isProgressComplete`: not orphaned, `completedAt` present, and `status === "done"`.
- Efficiency is `uniqueContentSec / focusedSec * 100`; it is not clamped (values above 100% are possible at >1x speed) and is `null` when the denominator is zero or invalid.
- Overall efficiency is an aggregate ratio, never the mean of daily percentages; zero-focus days are excluded from daily distributions.
- Playback utilization is `activePlaybackWallSec / eligibleFocusedSec * 100` and is not hidden when it exceeds 100%.
- Playlist duration is the sum of resolved `durationSec` values; any unresolved duration makes the Arena denominator unavailable rather than substituting an average.

### 7.4 Arena v2

Exact implemented contract, also documented in `docs/user-doc/ARENA_COMPLETE_GUIDE.md`:

```text
P = min(U / L, 1)                 U = unique completed/covered playlist content
C = min(Q / W, 1)                 L = resolved playlist duration; W = window days
Arena = 100 * (0.75 * P + 0.25 * C)
```

- A qualifying day requires `(contentGainSec >= 300 OR completedVideo)` **and** `max(focusSec, activePlaybackSec) >= 600`.
- `completedVideo` now uses the canonical completion predicate.
- A user/rival is provisional until at least 3 qualifying days and 7 observed calendar days exist, capped by the window length.
- Fixed runs freeze the playlist ID, snapshot version, duration, entry count and average video duration, settings and window dates at start.
- The fixed run reads live learning evidence but keeps the captured denominator; the UI labels it a **private, client-computed snapshot**, not a global season.
- Rank history is capped at 100 snapshots.
- Equal scores share a competition rank; percentile uses the scored synthetic rivals as the denominator.
- Rivals are deterministic from the configured seed and are synthetic; Arena is not a real-person leaderboard or server-certified anti-cheat competition.

**Not verified:** server-side certification, production-scale simulation, or a browser visual audit of the Arena screens.

---

## 8. Migration safety and rollback audit

### 8.1 Durable fence and drain

- The fence is one MongoDB document (`_id: "active"`) read by every identified learning-data write path.
- It blocks full-state PUT, append, import, local-data migration, profile/preferences mirror writes, playlist archive/restore/permanent delete, and account deletion.
- Reads remain available so the client can show a truthful read-only state without discarding edits.
- A second process cannot acquire a frozen fence; a released fence is reused only through a conditional update.
- Drain waits for per-account `writeLease` counters to reach zero, resets a lease only after the 30-second stale window, and fails closed with `MIGRATION_DRAIN_TIMEOUT` without taking a snapshot.
- Account writers heartbeat every five seconds; a legitimate long import is not normally mistaken for a crash. A process paused for longer than the stale window remains a theoretical residual risk (see §10).

**Operational constraint:** code that predates the fence cannot be stopped by a MongoDB document. The runbook now requires every running backend instance to use the fence-aware build and requires older instances to be stopped or upgraded before the fence is acquired. This is a deployment gate, not something the fence can enforce against old code.

### 8.2 Forward and reverse copy

- Forward apply is idempotent, refuses duplicate/malformed/conflicting records, writes a payload-free journal, re-inspects each domain, and fails closed on source mutation.
- A verified domain is revalidated against live counts/checksums before it is skipped on resume.
- Reverse treats Unified as authoritative, copies missing records, replaces changed Legacy records, blocks stale Legacy-only records by default, and requires post-copy parity.
- Unified is never dropped during rollback; Legacy is never retired in this phase.
- The release gate now proves coverage and live parity before either mode switch is blessed.

### 8.3 What was rehearsed locally

`backend/tests/mongo-migration.integration.test.ts` on `lqp24` proves:

- 20 Legacy domains seeded for a synthetic account;
- a zero-write dry run;
- an active fence blocking a repository write with `MIGRATION_READ_ONLY`;
- forward apply with 20 matched keys, zero pending, and matching checksums;
- Legacy unchanged;
- a lost destination record detected and repaired on resume;
- a Unified-era change surviving reverse migration into Legacy;
- reverse journal entries verified for all domains;
- fence release smoke and a real MongoDB transaction after release.

`backend/tests/mongo-backup-restore.integration.test.ts` proves a **logical** clone/restore comparison and a negative damaged-restore case. It is **not** a `mongodump`/`mongorestore` backup proof, and no production backup was taken.

### 8.4 Production cutover gates

| Gate | Required evidence | Current status |
|---|---|---|
| Exact target database/environment | Non-secret database name + environment label | **Pending owner confirmation** |
| 20-domain inventory | Code inventory + preflight dry run | Pass in local review |
| Staging parity | Isolated replica-set output | Pass locally; not production scale |
| Backup restore proof | Real `mongodump`/`mongorestore` artifact + comparator PASS | **Pending** - tools not installed; no production backup |
| Freeze/drain proof | Fence document + drain artifact | Pass locally |
| Destination-only/conflict approvals | Written owner approval per reported key group | **Pending production run** |
| Reverse rehearsal | Reverse apply artifact with checksum parity | Pass locally |
| Rollback owner/window | Named owner + maintenance window | **Pending** |
| Final counts/checksums | Forward apply artifact + release live-parity output | **Pending production run** |
| All instances fence-aware | Inventory of deployed versions | **Pending owner confirmation** |
| Real-browser/device verification | Browser suite or explicit accepted limitation | **Not performed** |
| Owner authorization | Explicit written approval | **Not given** |

**Production cutover remains blocked. No migration or storage-mode change was performed.**

---

## 9. Verification evidence

### 9.1 Runtime and full suites

| Check | Command | Result |
|---|---|---|
| Runtime | `node --version` | `v24.22.2` |
| Package manager | `npm --version` | `11.19.1` |
| Backend tests | `npm test` in `backend/` | **29 files passed, 2 skipped; 243 tests passed, 2 skipped** |
| Frontend tests | `npm test` in `frontend/` | **45 files passed; 393 tests passed** |
| Backend typecheck | `npm run typecheck` | exit 0 |
| Frontend typecheck | `npm run typecheck` | exit 0 |
| Backend build | `npm run build` | exit 0 |
| Frontend build | `npm run build` | production build succeeded |
| Backend lint | `npx eslint .` | **0 errors, 88 warnings** |
| Frontend lint | `npx eslint .` | **0 errors, 4 warnings** |
| Backend production audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Frontend production audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Backend full audit | `npm audit` | 11 moderate, 0 high, 0 critical (dev tooling) |
| Frontend full audit | `npm audit` | 12 moderate, 0 high, 0 critical (dev tooling) |

The two skipped backend files are the gated MongoDB integration suites. Both passed separately when `LQ_TEST_MONGO_URI` pointed at the isolated local replica set.

### 9.2 Isolated MongoDB integration

```powershell
$env:LQ_TEST_MONGO_URI = 'mongodb://127.0.0.1:27018/?replicaSet=lqp24'
npx vitest run tests/mongo-migration.integration.test.ts tests/mongo-backup-restore.integration.test.ts --reporter=verbose
```

Result: **2 files passed, 2 tests passed** (final run after the release-gate changes). Database dropped before/after; synthetic data only.

### 9.3 Migration test inventory

| File | Tests | Coverage |
|---|---:|---|
| `backend/tests/migration-control.test.ts` | 15 | Fence, drain/stale leases, reverse copy/update, stale-destination policy, smoke failure, release evidence, direction/scope/domain/journal/smoke-mode refusals, aborted source-mode rule, payload-free journal, source mutation |
| `backend/tests/user-data-migration.test.ts` | 16 | Deterministic dry run, all-domain copy/idempotency, paged copy, duplicate/malformed/conflict blocking, incomplete verification, source mutation, scoped copy, destination-only reporting, deletion interactions, options validation |
| `backend/tests/mongo-migration.integration.test.ts` | 1 (gated) | Replica-set forward/resume/cutover/reverse/rollback/transaction rehearsal |
| `backend/tests/mongo-backup-restore.integration.test.ts` | 1 (gated) | Logical restore comparison and negative damaged-restore case |

### 9.4 Before/after matrix

| Check | Before this audit (Report 24) | After this audit | Change |
|---|---|---|---|
| Backend files/tests | 29 files / 237 tests | 29 files / **243 tests** | +6 tests (release gate + aborted mode + append coverage) |
| Backend skipped | 2 | 2 | Gated integration suites |
| Frontend files/tests | 45 files / 392 tests | 45 files / **393 tests** | +1 Arena regression test |
| Backend lint | 0 errors / 88 warnings | 0 errors / 88 warnings | No new warnings |
| Frontend lint | 0 errors / 4 warnings | 0 errors / 4 warnings | No new warnings |
| Typechecks | Pass | Pass | - |
| Builds | Pass | Pass | - |
| Production audits | 0 / 0 | 0 / 0 | No production vulnerability introduced |
| Full audits | Dev-only advisories | 11 / 12 moderate, dev-only | Unchanged class of advisory |
| Isolated integration | 2 / 2 | 2 / 2 | Re-run after fix |
| Migration release evidence | Smoke only | Direction/scope/domain/journal/live parity + mode | **P1 fixed** |
| Aborted release safety | Any mode | Source store only | **P2 fixed** |
| Arena completion signal | Timestamp-only inconsistency | Canonical predicate | **P2 fixed** |
| Docs/archive links | Stale/missing rows | Report 24 and 25 indexed; links checked | **P2 fixed** |

### 9.5 Warning classification

- **Backend (88 warnings):** pre-existing `@typescript-eslint/no-explicit-any` in adapter/auth/migration code. No errors; no warning was suppressed to make the suite green.
- **Frontend (4 warnings):** three unnecessary hook dependencies and one `effectiveCfg` memo-dependency warning in Competition; reviewed as non-failing hook hygiene, not runtime defects.
- **Recharts jsdom warnings:** charts report zero width/height in jsdom. This is a test-environment layout limitation; it is not evidence of a production visual defect and is not a substitute for browser testing.
- **Expected negative-path logs:** the suites intentionally log database-unavailable, deletion-incomplete, quota and rate-limit failure paths. These are test fixtures, not production incidents.

### 9.6 Dependency detail

Production dependency trees are clean:

- Backend `npm audit --omit=dev`: 0 vulnerabilities.
- Frontend `npm audit --omit=dev`: 0 vulnerabilities.

Full audits include development-only tooling:

- `minimatch` DoS advisory through ESLint/@typescript-eslint (backend and frontend).
- Vite 6.4.4 dev-server `server.fs.deny` bypass advisory (frontend).
- `npm audit fix --force` proposes an incompatible ESLint downgrade; it was not run.
- No major upgrade was performed in this phase. Treat these as a separate maintenance item with a dedicated upgrade/test window.

### 9.7 Documentation links

The reproducible checker at `scripts/check-markdown-links.mjs` was run over every Markdown file in the repository (143 files, 169 relative links), including `README.md`, `HOW_TO_USE_LEARNQUEST.md`, `docs/`, the audit archive and the vendored `.agents/skills` references, after Report 25 and the archive rows were created. Every relative Markdown link and referenced local path resolves: **PASS**. The ten skill-reference links reported on the first pass were corrected; no application or historical report content was removed. See §12 for the final state.

---

## 10. Remaining limitations and risks

These are explicit, not hidden. None is a known P0/P1 code defect in the local working tree.

| Limitation | Impact | Next action |
|---|---|---|
| No real-browser verification | Responsive layout, keyboard order, dialogs, touch targets, focus visibility and color contrast are not visually proven at 320-1920 px. | Install approved Playwright/browser binaries in a dedicated verification phase; run the requested viewport and interaction matrix; capture screenshots and axe results. Do not claim jsdom as visual proof. |
| No production verification | Render/Vercel/Atlas behavior, cookies, CSP/CORS, Google callback, Brevo delivery and production data are unverified. | Authorized read-only production smoke after deployment; no account lookup by email. |
| No production backup/restore proof | `mongodump`/`mongorestore` are unavailable; only a logical clone and comparator were rehearsed. | Install MongoDB tools in the operator environment, take a verified backup, restore to an isolated target, run the comparator, and record the artifact. |
| Production migration not run | No production migration was performed; the inspected repository configuration remains Legacy. The deployed production setting was not independently verified, and cutover readiness is not approved. | Complete every §8.4 gate, including destination-only reconciliation, maintenance window, rollback owner, real-browser check and owner authorization. Verify the deployed `LQ_USER_DATA_STORE` during the authorized production change. |
| Older instances can bypass the fence | A backend built before the fence can write while the fence is active. | Stop or upgrade every instance before migration; verify the deployed version inventory. The runbook now states this prerequisite. |
| Long process pause versus 30-second stale lease | A writer paused longer than the stale window could be treated as crashed; source mutation/parity checks reduce but do not eliminate the race. | Keep the maintenance window free of old/long writers; monitor drain; consider a migration-specific renewable lease in a future hardening phase. |
| Full-state initial account read | Large histories are read in one response; no pagination/lazy loading. | Design paginated/lazy domain reads with compatibility and conflict semantics. |
| Idle remote-tab freshness | Server-side revocation is immediate, but an idle remote tab may show stale UI until its next request/refresh. | Add a lightweight session-status poll or broadcast in a future UX phase; do not claim universal live tab sync. |
| Arena is client-computed | Scores can be manipulated in the browser; no server certification or anti-cheat. | Treat Arena as a practice simulation; server-side certification would be a separate product/security project. |
| Development advisories | Full audits report moderate dev-tool advisories. | Schedule an ESLint/Vite maintenance upgrade; keep production audits at zero. |
| Lint/test warnings | 88 backend + 4 frontend warnings; Recharts jsdom warnings. | Classified, non-blocking. Reduce warnings incrementally without changing behavior. |
| No production-scale load test | Only small/representative fixtures (1,205-record migration paging, 1,000-entry cache/scale tests). | Run authorized staging load tests before a production cutover. |

---

## 11. Final acceptance checklist

| Criterion | Status |
|---|---|
| No known P0 or P1 unresolved | **PASS** - F25-01 fixed and covered; no P0 found |
| Full backend and frontend tests pass | **PASS** - 243 backend + 393 frontend tests |
| Typechecks and production builds pass | **PASS** |
| Security and persistence tests pass | **PASS** locally; live Google/Brevo/production not verified |
| No new dependency vulnerability introduced | **PASS** - production audits 0/0; full audits remain dev-only moderate |
| Critical documentation links resolve | **PASS** - local link checker |
| No accidental secrets or generated files tracked | **PASS** - no `.env`, build output, database artifact or token is tracked; final status inspected |
| Remaining risks explicit and actionable | **PASS** - see §10 |
| Inspected repository configuration remains Legacy | **PASS (repository inspection only)** - `LQ_USER_DATA_STORE=legacy`; the deployed production setting was not independently verified |
| No production migration or data modification | **PASS** - none performed |
| Real-browser verification | **BLOCKED** - no approved browser tooling |
| Production cutover approval | **NOT GIVEN** - all §8.4 gates pending |

**Conclusion:** LearnQuest is a **clean local release candidate** under the available evidence. It is not a production-verified release, and Unified migration/cutover is not approved.

---

## 12. Final Git status, diff summary and scoped commit-review list

> This section is completed after the report and archive updates. The working tree is intentionally uncommitted; no staging, commit, push or deployment was performed.

### 12.1 Exact final commands

Run from `E:\progressGameTracker` unless a `workdir` is shown.

```powershell
# Repository state
git status --short
git diff --stat
git log -1 --oneline
git rev-list --left-right --count origin/main...HEAD

# Backend
cd backend
npm test
npm run typecheck
npm run build
npx eslint .
npm audit --omit=dev
npm audit

# Frontend
cd ..\frontend
npm test
npm run typecheck
npm run build
npx eslint .
npm audit --omit=dev
npm audit

# Isolated migration integration (local replica set only)
cd ..\backend
$env:LQ_TEST_MONGO_URI = 'mongodb://127.0.0.1:27018/?replicaSet=lqp24'
npx vitest run tests/mongo-migration.integration.test.ts tests/mongo-backup-restore.integration.test.ts --reporter=verbose

# Documentation link check (dependency-free repository script)
node scripts/check-markdown-links.mjs
# Expected: Markdown files: 143; Local links checked: 169; PASS
```

### 12.2 Scoped commit-review list

Review the following files as one release-candidate change set. Do not stage or commit until the owner has reviewed the report, the production gates, and the uncommitted diff.

**Backend source and scripts**

- `backend/package.json`
- `backend/src/auth/accounts.ts`
- `backend/src/db/mongo.ts`
- `backend/src/routes/account.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/playlists.ts`
- `backend/src/scripts/compareMigrationReports.ts` (new)
- `backend/src/scripts/controlledMigration.ts` (new)
- `backend/src/scripts/diagnoseMongo.ts`
- `backend/src/services/accountDeletion.ts`
- `backend/src/services/migrationControl.ts` (new)
- `backend/src/services/migrationReportComparison.ts` (new)
- `backend/src/services/userData.ts`
- `backend/src/services/userDataMigration.ts`
- `backend/src/services/userDataReverseMigration.ts` (new)
- `backend/src/store.ts`

**Backend tests and fixtures**

- `backend/tests/account-append.test.ts`
- `backend/tests/fixtures/migrationSample.ts` (new synthetic migration fixture)
- `backend/tests/migration-control.test.ts` (new)
- `backend/tests/mongo-backup-restore.integration.test.ts` (new)
- `backend/tests/mongo-migration.integration.test.ts` (new)
- `backend/tests/multiuser.test.ts`
- `backend/tests/user-data-migration.test.ts`

**Frontend source and tests**

- `frontend/src/app/App.tsx`
- `frontend/src/app/store.tsx`
- `frontend/src/components/ui/ui.tsx`
- `frontend/src/domain/competition/competition.ts`
- `frontend/src/features/auth/AuthScreens.tsx`
- `frontend/src/features/competition/Competition.tsx`
- `frontend/src/features/player/LearningRecordEditor.tsx`
- `frontend/src/features/player/Player.tsx`
- `frontend/src/features/playlists/Library.tsx`
- `frontend/tests/arena.test.ts`
- `frontend/tests/auth-repair.test.tsx`
- `frontend/tests/cloud-persistence.test.tsx`
- `frontend/tests/responsive-layout.test.tsx` (new)
- `frontend/tests/store-integrity.test.tsx`

**Repository tooling**

- `scripts/check-markdown-links.mjs` (new)

**Documentation and vendored skill references**

- `README.md`
- `HOW_TO_USE_LEARNQUEST.md`
- `.agents/skills/mongodb-schema-design/references/antipattern-excessive-lookups.md`
- `.agents/skills/mongodb-schema-design/references/antipattern-unnecessary-collections.md`
- `.agents/skills/mongodb-schema-design/references/pattern-computed.md`
- `.agents/skills/mongodb-schema-design/references/pattern-extended-reference.md`
- `.agents/skills/mongodb-schema-design/references/source-query-stats.md`
- `.agents/skills/vercel-react-best-practices/AGENTS.md`
- `docs/user-doc/ARENA_COMPLETE_GUIDE.md` (new)
- `docs/user-doc/MIGRATION_ROLLBACK.md` (new)
- `docs/user-doc/MIGRATION_RUNBOOK.md` (new)
- `docs/user-doc/audit2/24_LEARNQUEST_ACCOUNT_IDENTITY_UNIFIED_MIGRATION_AND_RESPONSIVE_REPORT_2026-10-31.md` (new)
- `docs/user-doc/audit2/25_LEARNQUEST_FINAL_RELEASE_QUALITY_AND_READINESS_AUDIT_2026-11-01.md` (new)
- `docs/user-doc/audit2/README.md`

### 12.3 Final Git state after all documentation edits

- **Branch:** `main`
- **HEAD:** `d2eb55be3e030b63eab845037389ec2da8e43af9` (`feat: complete LearnQuest Phase 23 reliability improvements`)
- **Upstream:** `0` behind, `1` ahead of `origin/main` (the local Phase 23 commit is unpushed).
- **Staged:** none (`git diff --cached --stat` is empty).
- **Tracked modified:** 36 files.
- **Untracked paths:** 16 (the Phase 24 migration/test/docs files, the synthetic fixture file, the responsive test, Report 24, Report 25 and the Markdown link checker).
- **`git diff --stat`:** 36 files changed, 892 insertions, 166 deletions. This excludes the 16 untracked paths.
- **No tracked secrets or generated output:** no `.env`, key, token, cookie, database dump, screenshot, coverage output or `dist/` file appears in Git status.
- **Diff scope:** application source, tests, migration tooling, runbooks, audit reports and the corrected vendored skill-reference links only.

The report, the archive rows and the release-gate changes remain unstaged until the owner reviews and chooses to commit. No staging, commit, push, deploy or production migration was performed.

### 12.4 Final pre-commit re-verification

After the production-storage wording corrections and the link-checker addition:

- `git diff --check`: exit 0; no whitespace errors. Git reported only expected LF-to-CRLF normalization warnings.
- `node scripts/check-markdown-links.mjs`: 143 Markdown files, 169 local links, PASS.
- Backend targeted regression: `npm test -- tests/migration-control.test.ts tests/account-append.test.ts` -> 2 files, 21 tests passed.
- Frontend targeted regression: `npm test -- tests/arena.test.ts tests/responsive-layout.test.tsx` -> 2 files, 32 tests passed.

These are local Windows results. They do not imply real-browser, live-provider or production verification. The full-suite results in §5 remain the audit-run results.
