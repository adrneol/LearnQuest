# LearnQuest Empty Account, MongoDB Structure, and Account Deletion Repair

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `8376080` (`bad fix 2`); all work described here is **uncommitted**  
**Scope:** pending-onboarding routing, valid empty accounts, the account-data
contract, the consolidated MongoDB target, a safe dry-run migration tool, and
complete resumable account deletion. No commit, push, reset, clean, stash, or
branch switch was performed. No live account or learning record was
intentionally edited or deleted.

---

## 1. Executive summary

The reported “Your account data is unavailable” screen was **not** evidence
that a new account was corrupt. It was a contract mismatch between the backend
and the client, combined with the absence of a server-side onboarding gate. A
pending Google registration was allowed to behave like an authenticated
learning account; the client then rejected the old account-data envelope and
showed the error screen.

The local implementation now:

- routes pending onboarding back to the onboarding flow and refuses account
  data with `409 ONBOARDING_REQUIRED`;
- returns a complete canonical empty state for a fully onboarded account with
  zero records;
- returns explicit errors for failed reads or malformed stored records, never
  silent empty defaults;
- documents and indexes `lq_user_data` as the consolidated target while
  keeping the legacy `lq_data_*` collections authoritative;
- includes a versioned, dry-run-by-default, idempotent migration tool that
  never deletes legacy records and verifies checksums after copying;
- implements account deletion as a restartable, verified saga requiring the
  current password or fresh Google reauthentication, recent reauthentication,
  CSRF/origin validation, and the exact phrase `DELETE MY ACCOUNT`;
- verifies zero account-owned records across every discovered collection
  before reporting deletion success.

| Area | Local result |
|---|---|
| Pending onboarding | Routed to onboarding; no data read; `409 ONBOARDING_REQUIRED` on account/playlist APIs |
| Brand-new empty account | Valid canonical empty state; welcome dashboard and “Add your first playlist” |
| Account-data contract | `{ ok, schemaVersion: 1, loadedAt, state, version }`; frontend rejects incomplete responses |
| MongoDB target | `lq_user_data` with unique `(userId, domain, key)` and lookup indexes |
| Migration | Versioned dry-run default; copy only missing records; conflicts block all writes; verified after copy |
| Account deletion | Resumable saga; exhaustive collection cleanup; zero-residual verification; no false success |
| Backend tests | **111 / 111 passed** (13 files) |
| Frontend tests | **303 / 303 passed** (37 files) |
| Typechecks | Backend and frontend passed |
| Lint | Backend **0 errors / 81 warnings**; frontend **0 errors / 4 warnings** |
| Production builds | Backend and frontend passed |
| Dependency audits | `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities** in both packages |
| Isolated health smoke | **HTTP 200**, `ok:true`, `version:0.3.0`, setup-required with all integrations disabled |
| Live Atlas migration/deletion | **Not executed**; no live verification available |

The full frontend run still prints jsdom’s benign `window.scrollTo` “Not
implemented” message; it does not fail a test.

---

## 2. What was reproduced and what caused it

### 2.1 The exact account-data failure

The old backend returned the learning state spread at the top level:

```json
{ "ok": true, "playlists": {}, "progress": {}, "...": "..." }
```

The current frontend validator requires the canonical envelope:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "loadedAt": "2026-10-27T00:00:00.000Z",
  "state": { "...": "every domain..." },
  "version": 0
}
```

When the validator did not find `state` and `version`, it raised
`INVALID_ACCOUNT_DATA`. The account shell then rendered the error screen with
text about incomplete learning data. This is a deterministic contract
mismatch, not a database corruption diagnosis. It reproduces for a new account
with no records and for an existing account alike.

The backend route now always constructs the nested envelope
(`backend/src/routes/account.ts`), and the frontend validates all required
domains before accepting it (`frontend/src/services/api/authApi.ts`). It also
requires canonical `challenge`/`settings`/`prefs` objects and a non-negative
integer version, so a `null` placeholder cannot be normalized into a
legitimate-looking empty account. A missing or malformed response cannot
overwrite cloud data with defaults.

### 2.2 Why a pending registration reached the dashboard

The observed Atlas document had:

- `onboardingComplete: false`
- `username: null`
- `passwordHash: null`
- `status: "active"`

That is a valid **pending Google registration**, not a completed empty
account. The old application did not have a server-side `requireOnboarded`
gate. After the OAuth callback, an authenticated-but-pending identity could
proceed into the normal account shell; the frontend then attempted a cloud
load even though setup had not completed. The account-data error and the
pending record therefore appeared together.

The local implementation now:

- keeps a Google registration pending until onboarding succeeds;
- resumes onboarding for a pending account on the next sign-in;
- rejects `/api/account/*` and `/api/playlists/*` with
  `409 ONBOARDING_REQUIRED` until the account has a completed username and
  onboarding flag;
- renders `OnboardingScreen` from the bootstrap path without starting a cloud
  data read;
- rotates the session after successful onboarding and returns the completed
  user plus a fresh CSRF token.

`completeOnboarding()` now updates only mutable account fields (never `_id`),
uses an `onboardingComplete: false` predicate, and checks both `matchedCount`
and `modifiedCount`. A race, disappearance, or unexpected no-op returns an
explicit conflict instead of claiming success.

### 2.3 Why the account remained incomplete

The record proves that onboarding had not completed. It does **not** contain
an audit trail explaining whether the person abandoned the form or a historical
submission failed. Two facts bound the conclusion:

1. The immutable `_id` update bug that could previously make onboarding fail
   is already fixed in `HEAD`; the current code lists mutable fields only.
2. The publicly reachable deployment observed during this pass was stale
   (`/api/auth/config`, `/api/auth/session`, and `/api/account/data` returned
   404, and the frontend bundle did not contain the current auth UI). Historical
   live behavior therefore cannot be attributed safely to the current local
   code.

The honest conclusion is: **the account was pending onboarding; the old client
incorrectly treated it as a completed learning account.** The exact historical
reason the person did not finish setup requires live request logs, which were
not available. The record was not edited or deleted.

### 2.4 Empty singletons and the empty-account contract

The old read path could return `null` for missing singleton records such as
settings, preferences, or challenge configuration. That is not a valid complete
account state. `readUserState()` now starts from canonical defaults and only
applies stored values after every required query succeeds. Missing optional
rows become the real defaults; a failed query or malformed stored value raises
an explicit error. The frontend accepts the legitimate empty state and rejects
an incomplete one.

### 2.5 Deployed version mismatch

Observed live behavior during this pass:

- `https://learnquest-hhiv.onrender.com/api/health` → HTTP 200,
  `{ ok: true, hasKey: true, version: "0.2.0" }`.
- `/api/auth/config`, `/api/auth/session`, and `/api/account/data` → 404.
- The Vercel bundle contained no “Continue with Google” auth flow.

The repository backend version is `0.3.0`. The live frontend and backend do not
match the current repository. Redeployment is an owner action; local fixes
cannot change the live deployment.

---

## 3. Canonical account-data contract

### 3.1 Read response

`GET /api/account/data` returns exactly:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "loadedAt": "<ISO timestamp>",
  "state": {
    "playlists": {},
    "meta": {},
    "progress": {},
    "ranges": [],
    "checkpoints": [],
    "modules": [],
    "sessions": [],
    "goals": {},
    "xp": [],
    "achievements": {},
    "segments": [],
    "playSessions": [],
    "queue": {},
    "flexGoals": [],
    "challenge": {
      "seed": 20261013,
      "cohortSize": 100,
      "tierDist": {
        "Ultra": 2,
        "High": 8,
        "Good": 20,
        "Normal": 30,
        "Average": 25,
        "Below Average": 15
      },
      "windowDays": 14,
      "dailyCapHours": 6
    },
    "challengeEnabled": false,
    "rankHistory": [],
    "settings": { "verifiedThreshold": 0.9 },
    "prefs": {
      "timezone": "local",
      "sessionLenMin": 25,
      "breakMin": 5,
      "reducedMotion": false,
      "minViableMin": 10
    },
    "activeId": null
  },
  "version": 0
}
```

For a real account, `prefs.timezone`, `sessionLenMin`, `breakMin`, and
`minViableMin` are overridden by the authoritative account profile; the values
above are the canonical fallback. `version` starts at `0` and is advanced by
the optimistic-concurrency writer. The export envelope remains schema version
`3`; the account-data API envelope is `schemaVersion: 1`.

### 3.2 Domain kinds and defaults

| Domain | Kind | Canonical empty/default |
|---|---|---|
| `playlists` | map | `{}` |
| `meta` | map | `{}` |
| `progress` | map | `{}` |
| `ranges` | array | `[]` |
| `checkpoints` | array | `[]` |
| `modules` | array | `[]` |
| `sessions` | array | `[]` |
| `goals` | map | `{}` |
| `xp` | array | `[]` (no earned XP yet) |
| `achievements` | map | `{}` |
| `segments` | array | `[]` |
| `playSessions` | array | `[]` |
| `queue` | map | `{}` |
| `flexGoals` | array | `[]` |
| `challenge` | singleton | canonical 20261013 challenge object above |
| `challengeEnabled` | singleton | `false` |
| `rankHistory` | array | `[]` |
| `settings` | singleton | `{ verifiedThreshold: 0.9 }` |
| `prefs` | singleton | canonical prefs above, account profile overrides |
| `activeId` | singleton | `null` |

No fake playlist, video, XP, progress, note, analytics, or metric is created.

### 3.3 Absence versus failure

| State | Behavior |
|---|---|
| **A. Valid new account** | Every required read succeeds; missing rows become canonical defaults; HTTP 200 with complete `state`; `version` is the account's version (0 for a new account). |
| **B. Existing account with data** | Every required read succeeds; actual rows are returned; no defaults replace them. |
| **C. Database unavailable** | Explicit availability/setup error; no local fallback and no fabricated empty state. |
| **D. One or more queries failed** | `503 DATA_READ_FAILED`; the whole read fails closed. No partial state is returned. |
| **E. Malformed/incompatible stored record** | `502 DATA_INTEGRITY_ERROR` with the domain name and no payload; records are preserved. |
| **F. Incomplete onboarding** | `409 ONBOARDING_REQUIRED`; client shows onboarding and does not load learning data. |

A successful query returning no rows is the only path that becomes empty
defaults. A thrown query or an invalid stored record never does.

### 3.4 Writes, concurrency, and isolation

- Writes are restricted to the 20 approved domains. Unknown collection names
  return 404; client-supplied `userId`/`ownerId`/`accountId` fields inside
  payloads are rejected.
- `PUT /api/account/data/:collection` requires the current version and
  atomically reserves the next version with a compare-and-set. A mismatch
  returns `409 VERSION_CONFLICT`.
- A failed collection write restores the previous rows and releases the
  reserved version, so a mid-write disconnect does not leave a partially
  emptied account.
- Full imports replace all domains with an all-or-nothing restore path.
- Every read/write filter includes the authenticated `userId`; session cookies
  contain only the opaque session token, never learning data.
- Account switching/sign-out increments the cloud load generation, clears
  in-memory state, and discards stale responses; an in-flight load cannot
  expose the previous account.

---

## 4. MongoDB layout and indexes

### 4.1 Current authoritative layout

The application still reads and writes the per-domain collections:
`lq_data_playlists`, `lq_data_meta`, `lq_data_progress`, `lq_data_ranges`,
`lq_data_checkpoints`, `lq_data_modules`, `lq_data_sessions`, `lq_data_goals`,
`lq_data_xp`, `lq_data_achievements`, `lq_data_segments`,
`lq_data_playSessions`, `lq_data_queue`, `lq_data_flexGoals`,
`lq_data_challenge`, `lq_data_challengeEnabled`, `lq_data_rankHistory`,
`lq_data_settings`, `lq_data_prefs`, and `lq_data_activeId`.

Each document is small and independently updateable. Each legacy collection
has a unique `(userId, key)` index plus justified lookup/order indexes for
progress, sessions, segments, play sessions, checkpoints, ranges, modules,
flexible goals, and XP. Array items normally use their stable `id` as the key;
`rankHistory` snapshots have no `id`, so they use a deterministic
timestamp/order fallback instead of all colliding on the legacy `"undefined"`
key. No learning history is embedded in a single account document, avoiding the
16 MiB document limit.

### 4.2 Consolidated target

`lq_user_data` is created and indexed but is **not** authoritative:

```text
lq_user_data
  _id
  userId        string
  domain        one of the 20 validated domain names
  key           string record/key identifier
  value         validated domain-specific payload
  playlistId    optional string for playlist-scoped records
  updatedAt     preserved timestamp (ISO string or null)
  order         preserved ordering number (default 0)
  version       optional preserved record version
```

Indexes:

- **Unique `(userId, domain, key)`** — the record identity and the idempotency
  target for migration. It permits the same key in different domains or for
  different users.
- **`(userId, domain, playlistId)`** — playlist-scoped reads and deletion
  attribution.
- **`(userId, domain, order)`** — stable ordered reads for array domains.

The existing legacy uniqueness constraints remain in place. The partial unique
username index indexes only string usernames, so many pending registrations
with `usernameNormalized: null` can coexist while completed usernames remain
unique. The replacement path preserves/restores the old index if creating the
new one fails; no user document is modified by index replacement.

### 4.3 Operational collections

| Collection | Purpose | Index/TTL rationale |
|---|---|---|
| `lq_accounts` | Account identity/profile, Google subject, onboarding, Argon2id hash, preferences, status | Unique normalized email; partial unique username; unique sparse Google subject; status for deletion sweep |
| `lq_sessions` | Opaque session hashes, CSRF/reauth state, auth method | Unique token hash; user/revocation; TTL `expiresAt` |
| `lq_action_tokens` | Single-use password-reset/email-change token digests | Unique token hash; user/purpose; TTL `expiresAt` |
| `lq_oauth_states` | Short-lived PKCE/state/nonce and optional owner link | Unique state hash; user lookup; TTL `expiresAt` |
| `lq_challenges` | Legacy authentication challenges | Preserved for compatibility; account deletion scopes by `userId` |
| `lq_reset_grants` | Legacy reset grants | Preserved for compatibility; account deletion scopes by `userId` |
| `lq_deletions` | Resumable playlist-deletion jobs | Unique `(userId, playlistId)` |
| `lq_account_deletions` | Temporary account-deletion saga job | Unique `userId`; status/updated lookup; removed after verified success |
| `lq_migrations` | Per-account local-import claim/result | Unique `(userId, migrationId)` |
| `lq_state_versions` | Optimistic-concurrency version counter | Unique `userId` |

No secrets, session tokens, email action tokens, raw passwords, or Google OAuth
tokens are stored in learning-data records. TTL indexes exist only on session,
action-token, and OAuth-state collections that genuinely expire.

### 4.4 Atlas inspection

MongoDB has collections, not physical per-user folders. Atlas Data Explorer
filters one collection at a time. Use placeholders, never real secrets or
sensitive payloads:

```js
// lq_accounts
{ userId: "<userId>" }

// lq_user_data: all records for one account
{ userId: "<userId>" }

// lq_user_data: one domain for one account
{ userId: "<userId>", domain: "progress" }

// lq_user_data: one playlist in one domain
{ userId: "<userId>", domain: "sessions", playlistId: "PLxxxxxxxxxxxxxxxx" }

// Legacy current data, e.g. lq_data_progress
{ userId: "<userId>" }
```

This gives a clean logical view by switching collections or filtering the
`domain` field; it does not pretend Atlas displays nested per-user folders.

---

## 5. Migration design and local results

### 5.1 Safety properties

`backend/src/services/userDataMigration.ts` and
`backend/src/scripts/migrateUserData.ts` implement
`lq-data-to-user-data-v1` (version `1`):

- **Dry-run by default.** The CLI reads only; `--apply` additionally requires
  `--confirm lq-data-to-user-data-v1`.
- **Source preservation.** Legacy `lq_data_*` documents are never updated,
  deleted, or cleared.
- **Bounded batches.** Reads use `_id`-ordered batches (default 500, max 5000)
  so duplicate keys are still observed rather than skipped.
- **Deterministic scope.** Users and domains are processed in canonical sorted
  order; checksums use sorted keys and stable JSON.
- **Duplicate/malformed detection.** Duplicate source keys, duplicate target
  keys, missing values, invalid ownership, invalid payloads, and invalid
  metadata block the plan.
- **Conflict detection.** A destination record with the same `(userId, domain,
  key)` and a different checksum is reported and never overwritten. A blocked
  plan writes nothing.
- **Idempotent copy.** Only missing records are inserted. A repeated apply
  skips identical records; a concurrent duplicate-key insert is accepted only
  when the checksum matches.
- **Exhaustive verification.** After copy, the tool re-inspects every scoped
  source/destination record. Success requires zero pending keys, matched count
  equal to valid source keys, equal source/matched-destination checksums, and a
  stable source snapshot. A missing record or a source change during the copy
  yields `incomplete`, not success.
- **Destination-only warning.** Records with no legacy source are reported and
  left untouched; they do not cause data loss and are never overwritten.
- **No payload logging.** Reports contain counts, keys, reasons, and checksums;
  learning values are not printed.

### 5.2 Local dry-run/apply evidence

The automated suite uses disposable in-memory MongoDB fixtures. It seeded all
20 domains for two accounts and exercised bounded batches down to size 1:

- Dry run was byte-for-byte deterministic across repeated runs and wrote zero
  destination records.
- A scoped apply copied 20 records, preserved `value`, `updatedAt`, `order`,
  `playlistId`, and keys, and left both legacy snapshots unchanged.
- A second apply copied 0 and identified all 20 records as already present.
- Duplicate source keys, malformed payloads, destination conflicts, duplicate
  destination rows, and invalid ownership all blocked the run with zero writes.
- A deliberately no-op insert produced post-copy `pending=1` and status
  `incomplete`; a retry then completed and verified.
- A source record deleted during the copy produced `incomplete` with a
  source-drift warning, never a false success.
- Scope by account/domain copied only the selected account and left the other
  account untouched.
- Destination-only records produced a warning and were not overwritten.

No dry run or apply was executed against the live Atlas cluster. The only live
database contact in this pass is discussed in section 9.

### 5.3 Rollback

Because the source is untouched, rollback is simply keeping the application on
the legacy path. If migration-created target rows must be removed, use an
owner-approved account/domain-scoped deletion; never drop a shared collection
or index. A provider snapshot is the last resort. Legacy collection retirement
requires a backup, verified migration, code cutover, and explicit owner
authorization; none of that was performed here.

---

## 6. Account deletion

### 6.1 Confirmation and authorization

The Account Settings danger zone explains that deletion is permanent and opens
a confirmation dialog. The server requires all of:

- authenticated server-side session; the target is never taken from a
  client-supplied `userId`;
- current password verified against the stored Argon2id hash, or fresh Google
  reauthentication for a Google-only account;
- recent reauthentication within `REAUTH_WINDOW_MIN`;
- exact `DELETE MY ACCOUNT` after trimming only leading/trailing whitespace;
- valid CSRF token and trusted origin;
- active account state.

Wrong password, expired reauthentication, wrong phrase, invalid session,
missing CSRF, or untrusted origin deletes nothing. A client-supplied
`userId` is rejected by the strict schema.

### 6.2 Restartable saga

`backend/src/services/accountDeletion.ts` coordinates:

1. Mark the account `deleting` so new authentication and writes fail closed.
2. Persist a minimal job in `lq_account_deletions`.
3. Revoke sessions and delete account-owned records from every discovered
   collection:
   - `lq_accounts`;
   - `lq_sessions`;
   - `lq_action_tokens`;
   - `lq_challenges` and `lq_reset_grants` (legacy);
   - `lq_oauth_states`;
   - `lq_migrations`, `lq_state_versions`, `lq_deletions`;
   - all 20 legacy `lq_data_*` learning collections;
   - the consolidated `lq_user_data` target;
   - the temporary `lq_account_deletions` job as the final account-owned row.
4. Verify zero counts across every account-scoped collection, then remove the
   account document.
5. Verify again, remove the job, and verify the final state.
6. Return success only after all checks pass; clear the cookie.

A failure returns `503 ACCOUNT_DELETION_INCOMPLETE` and leaves a minimal
resumable job. The server startup sweep resumes only accounts already marked
`deleting` or jobs whose account is already gone; it never deletes an active
account because a stale job exists. The client cancels queued saves, invalidates
in-flight loads, clears in-memory state, removes the focus-timer snapshot, and
returns to the signed-out screen.

### 6.3 Test evidence

`backend/tests/account-deletion.test.ts` seeds representative records across
every discovered collection, including the consolidated target, for one account
and a second unrelated account. It asserts:

- invalid confirmation/password/CSRF/ownership leaves all counts unchanged;
- expired recent authentication returns 403 and deletes nothing;
- successful deletion leaves **zero** records for the deleted user in every
  collection and preserves the other user exactly;
- both old cookies return 401 after deletion;
- a simulated mid-deletion failure returns 503, marks the job failed, blocks
  access, and a sweep resumes to zero;
- a stale job does not delete an active account;
- duplicate concurrent requests are truthful and converge to zero;
- repeat deletion after completion does not recreate data;
- the job is removed after verified success.

These tests use the in-memory adapter. No real Atlas account was deleted.

### 6.4 Backup retention boundary

The application cascade removes application-level MongoDB records. Atlas
snapshots/backups, infrastructure logs, and Brevo/email-provider logs may retain
copies under their own retention policies. LearnQuest cannot erase those from
inside the application; the owner must use the provider’s retention/deletion
process where required.

---

## 7. Files changed or added

**Backend**

- `src/services/userData.ts` — canonical defaults, bounded read errors,
  `DATA_READ_FAILED`/`DATA_INTEGRITY_ERROR`, per-record validation.
- `src/services/userDataMigration.ts` — versioned dry-run/apply/verification.
- `src/scripts/migrateUserData.ts` — CLI with dry-run default and typed
  confirmation.
- `src/services/accountDeletion.ts` — resumable deletion saga and verification.
- `src/routes/account.ts` — nested `/data` contract, onboarding gate,
  `confirmPhrase` deletion route.
- `src/routes/auth.ts` — completed-account checks, OAuth owner association.
- `src/auth/accounts.ts` — mutable-only onboarding update and race checks.
- `src/auth/middleware.ts` — `requireOnboarded`.
- `src/auth/google.ts` — optional OAuth state owner link.
- `src/routes/playlists.ts` — onboarding gate.
- `src/db/mongo.ts`, `src/store.ts` — unified collection, deletion job,
  indexes.
- `src/server.ts` — startup store and deletion resume sweep.
- `tests/account-data-contract.test.ts` (new, 7 tests).
- `tests/account-deletion.test.ts` (new, 7 tests).
- `tests/user-data-migration.test.ts` (new, 12 tests).
- `tests/multiuser.test.ts` (updated).
- `package.json` — migration script.

**Frontend**

- `src/app/store.tsx` — pending-onboarding routing, empty-account load,
  deletion client cleanup.
- `src/services/api/authApi.ts` — strict account-data validation and
  `deleteAccount(confirmPhrase, password)`.
- `src/features/account/Account.tsx` — danger zone and deletion dialog.
- `src/features/playlists/Playlists.tsx` — welcome empty state and first
  playlist action.
- `tests/cloud-persistence.test.tsx` (8 tests) and
  `tests/account-ui.test.tsx` (updated).

**Documentation**

- `README.md`
- `HOW_TO_USE_LEARNQUEST.md`
- `docs/DEPLOYMENT_MULTIUSER.md`
- `docs/audits/LEARNQUEST_EMPTY_ACCOUNT_AND_DATABASE_STRUCTURE_2026-10-27.md`
  (this report)

The existing worktree was preserved. `docs/` had been deleted in `HEAD`; the
prior documentation was restored from `HEAD~1` for reference, and the new
report was added without committing.

---

## 8. Verification matrix

Commands were run from `backend/` or `frontend/` as appropriate.

| Gate | Command | Result |
|---|---|---|
| Backend tests | `npm test` | **111 / 111 passed**, 13 files |
| Frontend tests | `npm test` | **303 / 303 passed**, 37 files |
| Backend typecheck | `npm run typecheck` | Passed |
| Frontend typecheck | `npm run typecheck` | Passed |
| Backend lint | `npm run lint` | **0 errors**, 81 warnings (`no-explicit-any`; mostly pre-existing, 5 in the new migration service) |
| Frontend lint | `npm run lint` | **0 errors**, 4 warnings (pre-existing hook dependency warnings) |
| Backend build | `npm run build` | Passed |
| Frontend build | `npm run build` | Passed (`2252` modules transformed) |
| Backend audit | `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| Frontend audit | `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| Isolated health | `GET /api/health` on a loopback-only test process | **HTTP 200**; `ok:true`; `version:0.3.0`; `setupRequired:true`; `authEnabled:false`; Mongo/Google/Brevo/session/email-links/YouTube configured `false` |

Targeted regression counts:

- account-data contract: **7 / 7**
- account deletion: **7 / 7**
- user-data migration: **12 / 12**
- frontend cloud persistence (including empty/pending onboarding): **8 / 8**

No test was skipped or weakened. The in-memory adapter is used for destructive
fixtures; no live user data was used.

---

## 9. Local versus live verification boundary

### Verified locally

- all tests, typechecks, lint, builds, and dependency audits above;
- canonical empty state and explicit failure behavior through contract tests;
- pending-onboarding routing through frontend regression tests;
- exhaustive account deletion and restart behavior through the real backend
  route and saga on disposable fixtures;
- migration dry-run, idempotent copy, conflicts, malformed records, and
  post-copy verification on disposable fixtures;
- isolated health endpoint without any external integration.

### Not verified live

- Atlas data contents, index state, and any dry-run/apply migration;
- Google OAuth, Brevo delivery, Render runtime, Vercel proxy/cookies;
- account deletion against a real account;
- the reported live account's historical onboarding request logs;
- the current live deployment: it was stale (404 auth/account endpoints and no
  current auth UI), so live behavior cannot validate this repository.

### Important smoke-test disclosure

The first health smoke was launched before empty environment variables were
forced. PowerShell removes variables assigned to `''`, so `dotenv` loaded
`backend/.env`; the health response reported integrations configured. That
process may therefore have connected to the configured Atlas cluster and run
the normal startup path (`ensureIndexes` and the pending-deletion sweep). It
did **not** invoke the migration CLI, a test suite, or an account-deletion
request. The sweep only acts on accounts already marked `deleting`; whether any
pre-existing job existed could not be observed because the process logs were
not captured. The smoke was repeated with all integration values forced blank
and no database connection; the isolated result is the one reported in
section 8. The owner should review Atlas/Render logs and `lq_account_deletions`
if an unexpected deletion sweep is a concern.

No migration was applied and no account was intentionally deleted from Atlas.
No live user document was edited by the implementation. The pending account
described in the report was not manually modified.

---

## 10. Required owner actions

1. **Redeploy the matching versions.** Deploy this backend and frontend
   together. The currently reachable Render/Vercel deployment is stale
   (`0.2.0`, missing auth/account routes). After redeploy, verify
   `/api/auth/config`, `/api/auth/session`, `/api/account/data`, and the Google
   button in the browser.
2. **Resume the pending account through the UI.** Have the affected person
   sign in and finish onboarding. Do not manually edit the Atlas record. If it
   still fails, collect the server request log and response code
   (`ONBOARDING_SESSION_INVALID`, `USERNAME_TAKEN`, `ACCOUNT_CHANGED`, or a
   network error) before changing data.
3. **Back up Atlas and run a migration dry run.** Review the JSON report for
   conflicts, duplicates, malformed records, and checksums. Do not use
   `--apply` until the dry run is clean and a backup is confirmed.
4. **Apply only with explicit approval, then verify.** Keep every legacy
   `lq_data_*` collection intact. A code cutover to read/write `lq_user_data` is
   a separate reviewed change; this pass did not make the target authoritative.
5. **Review the first smoke-test contact.** Check Render/Atlas logs and
   `lq_account_deletions` for any startup sweep activity. Confirm no unintended
   deletion job was resumed. No migration or deletion request was issued by the
   task.
6. **Verify deletion in a disposable environment.** Exercise wrong password,
   expired reauthentication, wrong phrase, Google-only reauthentication, and a
   successful delete. Confirm every discovered collection has zero rows for the
   deleted account and unrelated accounts are unchanged.
7. **Document provider retention.** If Atlas snapshots, Render logs, or Brevo
   logs must be purged, follow each provider’s retention/deletion process; the
   application cascade cannot erase provider-managed copies.
8. **Confirm deployment configuration.** Render Node `24.22.1`, exact
   `APP_ORIGIN`/`CORS_ORIGIN`/`GOOGLE_REDIRECT_URI`, `TRUST_PROXY_HOPS`, and the
   Vercel `/api` rewrite must still match the current production topology.

---

## 11. Remaining risks and limitations

- The live deployment was stale; no claim is made that the fixes are live.
- No live migration, deletion, Google, Brevo, or Atlas verification was
  performed.
- The migration tool has no automatic code cutover. `lq_user_data` can be
  populated and verified, but the app will continue reading `lq_data_*` until a
  reviewed code change flips the repository boundary.
- A destination-only record is reported but not deleted; an owner must review
  it before any cutover.
- The deletion saga is application-level. Provider backups and logs have
  separate retention.
- Lint warnings are non-blocking; the new migration service uses
  `Record<string, any>` at the raw-document boundary to match the existing
  adapter style. No lint error is suppressed.
- The first smoke process may have performed normal startup index creation and
  a deletion-sweep query against the configured cluster. This is disclosed in
  section 9; no migration or deletion request was issued by the task.

---

## 12. Preservation statement

- No commit, push, reset, clean, stash, or branch switch was performed.
- No live learning record, account record, or credential was intentionally
  modified or deleted.
- The observed pending account was not edited or removed.
- Legacy `lq_data_*` collections remain the authoritative source and were not
  migrated or retired.
- `lq_user_data` is an empty/indexed target; migration is dry-run by default
  and was not applied to Atlas.
- Existing uncommitted work and restored documentation were preserved.
