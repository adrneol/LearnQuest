# LearnQuest Legacy → Unified Migration Runbook

**Status:** implementation and isolated rehearsal complete; **production cutover not authorized**.  
**Production data store remains `LQ_USER_DATA_STORE=legacy`.**  
**Migration ID:** `lq-data-to-user-data-v1`  
**Schema version:** `1`

This runbook is for an owner-authorized maintenance window. It does not authorize a cutover by itself. The final section is a stop gate: do not change production storage until the owner signs it.

---

## 1. Hard safety rules

1. **Do not print or commit** `.env`, MongoDB URIs, credentials, tokens, cookies, API keys, or personal user data. Use `mongoTargetDescription()` / the diagnostic, which prints only a database name and non-secret shape.
2. **Do not query production by a personal email.** Migration and diagnostics are account-id/collection based only.
3. **Do not drop or retire legacy `lq_data_*` collections** in this phase. Retention/retirement needs a separate post-cutover observation period and explicit approval.
4. **Keep `LQ_USER_DATA_STORE=legacy`** until every gate below has a recorded artifact and the owner authorizes cutover.
5. **The migration fence is the write authority.** It is a MongoDB document (`lq_migration_control`), not an in-memory flag, so every application process that runs this version sees it.
6. **Never release the fence without a passing read/write smoke test on the selected storage mode.**
7. **A failed reverse copy must keep the system fenced/read-only.** Do not switch back to Legacy to “see if it works” after an incomplete reverse.
8. **A CLI flag or checkbox is not backup proof.** Require a restore-verification artifact produced from a separate restored database.

---

## 2. Inventory: all 20 logical domains

### Physical shapes

| Legacy | Unified |
|---|---|
| One collection per domain: `lq_data_<domain>` | One collection: `lq_user_data` |
| Document: `{ userId, key, value, updatedAt, order, ...optionalPlaylistId }` | Document: `{ userId, domain, key, value, updatedAt, order, ...optionalPlaylistId }` |
| Unique index: `{ userId: 1, key: 1 }` | Unique index: `{ userId: 1, domain: 1, key: 1 }` |
| Domain lookup indexes for progress/sessions/segments/etc. | `{ userId, domain, playlistId }`, `{ userId, domain, order }` |

The repository presents both physical layouts through the same logical `DataStore` contract. `domainData(name)` selects the active backend; `data(name)` always addresses the legacy physical collection for migration/rollback.

### Logical domain contract

| # | Domain | Kind | Stable key / identity | Empty-domain behavior |
|---:|---|---|---|---|
| 1 | `playlists` | map | Playlist ID | `{}` |
| 2 | `meta` | map | Playlist ID | `{}` |
| 3 | `progress` | map | Entry identity (`entryId` or position/video fallback) | `{}` |
| 4 | `ranges` | list | Range `id` | `[]` |
| 5 | `checkpoints` | list | Checkpoint `id` | `[]` |
| 6 | `modules` | list | Module `id` | `[]` |
| 7 | `sessions` | list (append-capable) | Session `id` | `[]` |
| 8 | `goals` | map | Date key | `{}` |
| 9 | `xp` | list (append-capable) | XP `id` / `dedupKey` | `[]` |
| 10 | `achievements` | map | Achievement key | `{}` |
| 11 | `segments` | list (append-capable) | Segment `id` | `[]` |
| 12 | `playSessions` | list (append-capable) | Play-session `id` | `[]` |
| 13 | `queue` | map | Playlist ID | `{}` |
| 14 | `flexGoals` | list | Goal `id` | `[]` |
| 15 | `challenge` | singleton | `singleton` | Default challenge |
| 16 | `challengeEnabled` | singleton | `singleton` | `false` |
| 17 | `rankHistory` | list | Rank snapshot `id` | `[]` |
| 18 | `settings` | singleton | `singleton` | Default settings |
| 19 | `prefs` | singleton | `singleton` | Default preferences |
| 20 | `activeId` | singleton | `singleton` | `null` |

For each domain, migration preserves:

- user ownership (`userId`);
- the stable key/identity;
- `value` payload exactly (canonical checksum);
- `updatedAt`;
- `order` where present;
- optional `playlistId` attribution where present;
- append/optimistic-version semantics (the repository contract is unchanged; only the physical adapter changes).

Empty domains remain empty logical domains. They are not dropped or inferred from another domain.

### Account-scoped non-learning collections

These are **not** part of the 20 learning domains but are part of the backup plan:

- `lq_accounts` — account identity/metadata, no learning payload.
- `lq_sessions` — session hashes and expiry.
- `lq_action_tokens` — email action hashes.
- `lq_oauth_states` — OAuth state hashes/bindings.
- `lq_deletions`, `lq_account_deletions`, `lq_account_fences` — deletion saga/fence.
- `lq_state_versions` — optimistic version baselines.
- `lq_migration_control`, `lq_migration_journal` — this migration's fence/journal.
- `lq_migrations` — legacy per-account migration tracking.
- `lq_rate_limits` — hashed counters.

Do not copy production PII to a shared staging environment without an approved privacy plan.

---

## 3. Why this migration is safe-by-construction

### Durable fence

- One document `_id: "active"` in `lq_migration_control`.
- `phase: "frozen"` blocks every identified learning-data write path:
  - account collection writes/append/import/migrate;
  - playlist archive/restore/delete;
  - preferences mirror write;
  - account deletion.
- Each write route checks the fence before accepting a write; the service layer also checks it, so a route added later cannot silently bypass admission.
- Reads remain available so clients can render a truthful read-only state.
- Clients receive `503 MIGRATION_READ_ONLY`; the frontend keeps local edits in memory and shows a read-only banner.
- A second process cannot acquire the fence while it is frozen.
- Release requires a passing insert/read/delete smoke test on the currently selected store.

### Drain

- Admits writers through the existing per-account `writeLease` counter.
- Waits for `writeLease` to reach zero.
- Recovers a crashed process's stale lease after 30 seconds.
- Fails closed with `MIGRATION_DRAIN_TIMEOUT`; no snapshot is taken.

### Forward copy

- Dry run is deterministic and writes nothing.
- Apply refuses a blocked plan (duplicates, malformed records, conflicts, destination-only records).
- Every copy is an idempotent insert; an existing identical record is skipped.
- A different existing destination record is a conflict, never an overwrite.
- Per-account/per-domain journal records counts/checksums only (no learning payloads).
- Every domain is re-inspected immediately after copy and after the run.
- Source mutation during copy fails closed.
- Legacy is read-only throughout.

### Reverse copy

- Unified is authoritative while the fence is active.
- Reverse dry run reports:
  - Unified keys missing from Legacy;
  - Legacy records that differ (will be replaced);
  - Legacy-only records (stale) that block unless explicit removal is authorized.
- `--allow-stale-destination` is explicit and logged; it removes only keys absent from Unified after copying.
- Every domain is re-inspected and journaled.
- A reverse run that cannot prove 0 pending, 0 conflicts, 0 destination-only and matching checksums is `incomplete`, not success.
- The fence stays active on failure.

---

## 4. Roles and prerequisites

| Role | Responsibility |
|---|---|
| Migration operator | Runs commands, records artifacts, never edits production data manually. |
| Owner/approver | Reviews artifacts, approves reconciliation and cutover/rollback. |
| Second reviewer | Independently verifies counts/checksums and rollback decision. |

Prerequisites:

- Node `>=24.22.1 <25` (current verified runtime `24.22.2`).
- Access to an **isolated staging database** and a **restore target database**.
- MongoDB tools for the production backup plan (`mongodump`, `mongorestore`) installed on the operator host. They are not currently installed on the Phase 24 workstation; this is a gate, not a reason to fabricate proof.
- A verified backup/restore artifact.
- A completed staging rehearsal artifact.
- An agreed maintenance window and rollback owner.
- No pending account-deletion jobs (or explicit resolution).
- **Every running backend instance must use this fence-aware build.** Stop or
  upgrade older instances before acquiring the fence; code that predates the
  fence cannot be stopped from writing by the fence document alone.
- `LQ_USER_DATA_STORE=legacy` at the start.

---

## 5. Preflight commands (read-only)

Run from `backend/`.

```powershell
npm run typecheck
npm test
npm run diagnose:mongo
npm run migrate:controlled -- forward --out preflight.json
npm run migrate:controlled -- status
```

`diagnose:mongo` is a read-only ping using the configured database name. It never prints the URI or credentials. If it is pointed at a target you are not authorized to contact, **do not run it**; use a separate isolated environment.

`migrate:controlled -- forward` without `--apply` is the deterministic, zero-write dry run. Save its JSON report; it is the baseline for restore comparison. Do not use `inspect:user-data` for this artifact: that command requires a single `--user` and produces an account tree, not a migration report.

If a specific account must be inspected manually, this remains read-only:

```powershell
npm run inspect:user-data -- --user <opaque-user-id> --store both --json
```

---

## 6. Staging rehearsal

### 6.1 Isolated replica set

Use a local or dedicated staging replica set, never production. One safe local pattern:

```powershell
# Example only; choose your own temp path. Do not put a production URI here.
mongod --replSet lqp24 --port 27018 --bind_ip 127.0.0.1 --dbpath <isolated-temp-dbpath>
mongosh "mongodb://127.0.0.1:27018/?directConnection=true" --eval "rs.initiate({_id:'lqp24',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

Then run the committed integration rehearsal:

```powershell
$env:LQ_TEST_MONGO_URI = 'mongodb://127.0.0.1:27018/?replicaSet=lqp24'
npx vitest run tests/mongo-migration.integration.test.ts --reporter=verbose
```

Expected evidence:

- 20 legacy domains seeded for one synthetic account;
- dry run = 0 destination records;
- fence blocks writes;
- forward apply = 20 matched records, source checksum = matched destination checksum;
- legacy unchanged;
- simulated lost destination record resumes with 19 verified domains and 1 copy;
- post-cutover Unified write survives reverse copy into Legacy;
- reverse journal = 20 verified;
- fence release smoke passes;
- a real MongoDB transaction writes version 1 on the replica set.

The database is clearly named `learnquest_phase24_rehearsal` and dropped before/after the suite. This is **staging evidence**, not production proof.

A separate isolated restore rehearsal clones the synthetic source into an empty
database with the driver and checks the restore comparator:

```powershell
npx vitest run tests/mongo-backup-restore.integration.test.ts --reporter=verbose
```

It proves count/checksum parity across 40 account/domain units (two accounts,
23 records), that a missing restored record fails comparison, and that the
comparator prints no payloads. It is a **logical clone**, not
`mongodump`/`mongorestore`; the production backup/restore gate in §7 remains
mandatory.

### 6.2 Synthetic fixtures to include

The automated suite covers:

- empty domains;
- large histories / batch limits;
- duplicate identities;
- destination conflicts;
- destination-only records;
- malformed records;
- source mutation during copy;
- interrupted copy/resume;
- account deletion / fence interactions;
- freeze/drain;
- reverse migration;
- real transactions (isolated replica set).

Do not claim production-scale performance from synthetic fixtures. Record actual payload sizes and transaction timings from the staging target.

---

## 7. Backup and restore proof

### 7.1 Backup

Use a full database backup that includes **both** the 20 legacy collections and the account/metadata collections listed in §2.

Example shape (never paste the URI into logs or chat):

```powershell
mongodump --uri="$env:MONGODB_URI" --db="$env:MONGODB_DB_NAME" --out="<isolated-backup-dir>"
```

The operator must record:

- backup timestamp;
- database name (non-secret);
- collection list and document counts;
- checksum/manifest of the dump directory;
- encryption/access location;
- who can restore it.

For privacy, do not copy a production dump to shared staging without an approved plan. Prefer a private isolated restore target with the same access controls.

### 7.2 Restore to a separate empty database

```powershell
mongorestore --uri="<isolated-restore-uri>" --nsFrom="<source-db>.*" --nsTo="<restore-db>.*" "<isolated-backup-dir>"
```

- The restore target must be empty and separate from the source.
- Never restore over the source database.
- Do not print the URI.

### 7.3 Verify counts and checksums

Point a **separate process** at the restored database (using an isolated environment/config) and generate the matching report:

- Legacy-source restore (the usual pre-cutover backup):

```powershell
npm run migrate:controlled -- forward --out restored-inspect.json
```

- Unified-source restore:

```powershell
npm run migrate:controlled -- reverse --out restored-unified-inspect.json
```

The report generator must be pointed at the restored database by an isolated
process configuration. Never point it at the live source, and never print the
URI. Use the matching direction for the backup being verified; comparing a
forward report with a reverse report is rejected.

Compare the baseline and restored reports:

```powershell
npm run compare:migration-reports -- preflight.json restored-inspect.json
```

The comparator checks, without printing payloads:

- migration direction;
- total source documents;
- valid source keys;
- canonical source checksum;
- every account/domain document count, key count and checksum.

**Backup/restore gate passes only when the comparison is `PASS` and the artifact is recorded.** A CLI “backup confirmed” checkbox is not proof.

---

## 8. Forward migration procedure

### Step 1 — Freeze and drain

```powershell
npm run migrate:controlled -- forward --apply --confirm lq-data-to-user-data-v1 --out forward-apply.json
```

The tool:

1. acquires/reuses the matching durable fence;
2. refuses a mismatched active fence;
3. drains admitted account writers;
4. runs the dry plan and apply;
5. verifies per domain and globally;
6. leaves the fence active.

Expected output:

- `Status: APPLIED AND VERIFIED. The fence is still ACTIVE; writes stay blocked.`
- `pending=0`
- source checksum equals matched destination checksum;
- legacy collections still present and unchanged.

If `BLOCKED` or `INCOMPLETE`: **stop.** Keep the fence active or release only after the cause is resolved. Do not switch storage.

### Step 2 — Confirm the fence and journals

```powershell
npm run migrate:controlled -- status
```

Expected:

- fence `FROZEN`, direction `forward`, correct generation;
- forward journal `verified` = all account/domain units;
- reverse journal unchanged from prior runs.

### Step 3 — Switch the deployment mode

Change the backend configuration:

```text
LQ_USER_DATA_STORE=unified
LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1
```

- This is a deployment configuration change, not a data write.
- Keep the fence active until the new mode is healthy.
- Do not set Unified without the acknowledgement; production startup refuses it.
- Do not let the application silently fall back to Legacy. If Unified is selected and empty, the account must fail clearly, not show an empty dashboard.

### Step 4 — Release only after smoke passes

```powershell
npm run migrate:controlled -- release --reason cutover
```

The tool checks that the selected mode is `unified`, that the active fence is a
full-scope `forward` run over all 20 domains, that every forward journal
account/domain unit is `verified`, and that a fresh live forward inspection
still reports `pending=0`, `conflicts=0`, `destinationOnly=0`, matching keys and
matching checksums. Only then does it run a read/write/delete smoke test on
Unified and mark the fence released. If any evidence check or the smoke fails,
the fence remains active and writes stay blocked. A scoped or partial run can
only be released as `--reason aborted` after resolving the cause and returning
the deployment to the fence source store; the tool refuses target-mode smoke
evidence for an aborted release.

### Step 5 — Verify production behavior

- Health/readiness is green.
- Sign in with an existing account and read the full 20-domain state.
- Make one small learning write and verify it persists.
- Verify an account with prior history shows the same progress, sessions and playlists.
- Verify an empty account shows the canonical empty state, not a fabricated default.
- Confirm no Legacy collection was dropped.

---

## 9. Cutover gate checklist

Every row must have a recorded artifact. Any “no” stops the cutover.

| Gate | Required evidence | Status before production |
|---|---|---|
| Exact target database/environment named without secrets | Non-secret database name + environment label | **Pending owner target confirmation** |
| 20-domain inventory matched | `preflight.json` + code inventory | **Pass in local review** |
| Staging parity artifact | `mongo-migration.integration.test.ts` output on isolated replica set | **Pass locally; not production-scale** |
| Backup restore proof | Restore report + `compare:migration-reports` PASS | **Pending production backup/restore** |
| Freeze/drain proof | Fence document + drain result in apply artifact | **Pass locally** |
| Destination-only/conflict reconciliation approvals | Written owner approval for every reported key | **Pending** |
| Reverse rehearsal result | `reverse` apply artifact with checksum parity | **Pass locally** |
| Rollback decision and maintenance window | Named owner + window + expected duration | **Pending** |
| Final source/target counts/checksums | Forward apply artifact plus `release --reason cutover` live-parity output | **Pending production run** |
| Exact operator command/env change | This runbook + approved change record | **Pending** |
| Real-browser/device verification | Browser suite or explicit accepted limitation | **Not performed** |
| Owner final authorization | Explicit written approval | **Not given** |

**Production cutover is not authorized by this runbook.**

---

## 10. Observability and troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `MIGRATION_FENCE_ACTIVE` | Another process owns a frozen fence | Run `status`; do not take over. Resolve with the owner. |
| `MIGRATION_DRAIN_TIMEOUT` | An admitted writer is still active | Inspect account leases; wait or resolve. Fence remains active. |
| `MIGRATION_READ_ONLY` in the app | Fence is active | Expected. Clients keep local edits; do not bypass. |
| `MIGRATION_SMOKE_FAILED` | Selected store cannot read/write | Fix storage/config. Fence stays active. |
| `MIGRATION_JOURNAL_INCOMPLETE` | A cutover/rollback release found pending, failed, or missing verified account/domain evidence | Resume the matching apply, or release as `aborted` after resolving the cause. Never switch modes to bypass this. |
| `MIGRATION_SCOPE_INCOMPLETE` / `MIGRATION_DOMAINS_INCOMPLETE` | The fence covers only some accounts or domains | A production cutover/rollback requires the full account and 20-domain scope. Rerun full-scope or abort explicitly. |
| `MIGRATION_DIRECTION_MISMATCH` | The release reason does not match the frozen fence direction | Use `cutover` only for a forward fence and `rollback` only for a reverse fence. |
| `MIGRATION_SMOKE_MODE_MISMATCH` | Smoke evidence belongs to a different store than the release target (cutover/rollback), or an aborted release is still on the target store | Re-run smoke in the deployment mode being released; for an abort, switch back to the fence source store first. |
| `Post-copy verification failed` | Source changed or destination differs | Stop; re-run dry run; resolve. |
| `destinationOnly` > 0 | Destination has records with no source | Preserve; require explicit reconciliation. |
| Journal `failed` | A domain copy failed | Read error, fix, rerun; verified domains resume. |
| Fence `released` unexpectedly | A release command ran | Immediately check `releaseReason` and app mode; open an incident. |
| Legacy collection missing | Destructive action occurred outside this runbook | Stop; restore backup; escalate. |

---

## 11. Stop gate

Before any production command that changes `LQ_USER_DATA_STORE`, acquires a production fence, or writes Unified/Legacy data:

1. Every gate in §9 is PASS with an artifact.
2. The owner has named the target and maintenance window.
3. The rollback owner has read and accepted `MIGRATION_ROLLBACK.md`.
4. The operator has a verified backup and restore proof.
5. The operator explicitly confirms: **“I authorize the production migration.”**

Until then, leave production on Legacy and leave all legacy collections untouched.
