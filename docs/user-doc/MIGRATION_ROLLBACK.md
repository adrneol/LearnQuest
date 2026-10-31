# LearnQuest Unified → Legacy Rollback Runbook

**Status:** reverse implementation and isolated rehearsal complete; **production rollback not executed**.  
**Forward migration ID:** `lq-data-to-user-data-v1`  
**Direction:** `reverse`  
**Do not use this document to switch production without owner approval.**

---

## 1. What rollback must preserve

Rollback is **not** “flip `LQ_USER_DATA_STORE` back to legacy.”

After Unified becomes active, every accepted Unified-era write exists only in Unified until it is copied back. A rollback must:

1. Acquire the durable migration fence again.
2. Drain in-flight account writers.
3. Copy/reconcile **all Unified-era writes** into Legacy, including:
   - changed records;
   - new records;
   - deleted records (stale legacy keys);
   - all 20 logical domains.
4. Verify every account/domain: 0 pending, 0 conflicts, 0 destination-only, matching counts and checksums.
5. Keep the system fenced/read-only if parity cannot be proven.
6. Only then switch the deployment mode back to Legacy and release the fence after a passing Legacy smoke test.
7. Keep Unified data intact. Do not drop `lq_user_data` or any Unified record.

**Legacy-only records** are preserved by default. Removing them requires explicit `--allow-stale-destination` approval, because absence in Unified may represent a real post-cutover deletion or a rollback mismatch.

---

## 2. Trigger conditions

Rollback may be considered when:

- the Unified deployment fails a required health/smoke gate;
- a correctness issue is found that cannot be fixed forward inside the maintenance window;
- the owner decides the risk is unacceptable.

Rollback is **blocked** when:

- the reverse dry run reports duplicates/malformed records;
- a Unified source mutation cannot be stabilized;
- the reverse copy cannot prove checksum parity;
- Legacy is missing or unreachable;
- the operator cannot confirm the maintenance window/fence authority.

Blocked rollback means: **keep the fence active and the product read-only**, preserve both stores, and escalate. Do not switch modes.

---

## 3. Preconditions

- The forward cutover artifact and fence history are available.
- Unified is healthy enough to read all 20 domains.
- Legacy collections still exist and were never retired.
- A verified backup/restore proof exists for the pre-cutover state.
- An owner and rollback operator are named.
- The migration fence is either active (forward frozen) or released after cutover; the reverse tool can acquire a new fence generation.
- No pending account-deletion job is unresolved.

> A backup restore returns the system to a **pre-cutover** state and may lose Unified-era writes. It is a last resort for corruption, not a substitute for reverse migration.

---

## 4. Reverse procedure

### Step 1 — Confirm the current mode and fence

Run from `backend/`:

```powershell
npm run migrate:controlled -- status
```

Expected before rollback:

- `Selected data store: unified`;
- no unrelated active fence, or a forward fence you are authorized to supersede after cutover release;
- forward journal shows the cutover run;
- reverse journal may be empty or from a rehearsal.

If an unrelated fence is active, stop. Do not take it over.

### Step 2 — Reverse dry run

```powershell
npm run migrate:controlled -- reverse --out reverse-dry-run.json
```

The tool requires `LQ_USER_DATA_STORE=unified` for the reverse apply path. The dry run itself is read-only.

Review:

| Field | Required |
|---|---|
| `status` | `ready` before apply |
| `totals.pendingKeys` | Count of Unified keys missing from Legacy |
| `totals.conflicts` | Legacy records that differ; reverse apply will replace them with Unified values |
| `totals.destinationOnlyKeys` | Legacy-only records; block unless explicitly approved for removal |
| `totals.duplicate*` | Must be 0 |
| `totals.invalid*` | Must be 0 |
| `checksums.source` | Unified canonical checksum |
| `checksums.matchedDestination` | Legacy matched checksum |

If `status=blocked`, resolve every blocker. Do not use `--allow-stale-destination` merely to make a red report green. Obtain explicit owner approval for each stale/destination-only key group.

### Step 3 — Apply reverse

Without stale removal:

```powershell
npm run migrate:controlled -- reverse --apply --confirm lq-data-to-user-data-v1 --out reverse-apply.json
```

With explicitly approved stale removal:

```powershell
npm run migrate:controlled -- reverse --apply --confirm lq-data-to-user-data-v1 --allow-stale-destination --out reverse-apply.json
```

Expected:

- `Status: APPLIED AND VERIFIED. The fence is still ACTIVE; writes stay blocked.`
- `pending=0`, `conflicts=0`, `staleDestination=0`;
- source checksum equals matched destination checksum;
- reverse journal `verified` covers every account/domain unit;
- Unified data still present;
- Legacy now includes every Unified-era write.

If `INCOMPLETE`: **stop.** Keep the fence active. Fix the cause and rerun; verified domains resume from the journal. Do not switch the app to Legacy.

### Step 4 — Switch the deployment mode back

Change backend configuration:

```text
LQ_USER_DATA_STORE=legacy
```

Remove or change the Unified cutover acknowledgement only as part of the approved configuration change. Keep the fence active until Legacy passes smoke.

### Step 5 — Release the fence

```powershell
npm run migrate:controlled -- release --reason rollback
```

The tool checks that the selected mode is `legacy`, that the active fence is a
full-scope `reverse` run over all 20 domains, that every reverse journal
account/domain unit is `verified`, and that a fresh live reverse inspection
still reports `pending=0`, `conflicts=0`, `staleDestination=0`, matching keys and
matching checksums. Only then does it run a Legacy read/write/delete smoke test
and release. If any evidence check or the smoke fails, the fence remains active.
A scoped or partial run can only be released as `--reason aborted` after
resolving the cause and returning the deployment to the fence source store; the
tool refuses target-mode smoke evidence for an aborted release.

### Step 6 — Verify

- Health/readiness green.
- Sign in and read all 20 domains.
- Verify a post-cutover Unified write (the reason for rollback) is present in Legacy.
- Verify an account with only Unified-era data is present.
- Verify empty domains still behave as empty, not defaulted/invented.
- Confirm Unified remains intact for investigation.
- Do not drop Legacy or Unified collections.

---

## 5. Reverse verification rules

A reverse run succeeds only when **all** are true:

```text
status = applied
pendingKeys = 0
conflicts = 0
destinationOnlyKeys = 0
matchedKeys = validSourceKeys
checksums.source = checksums.matchedDestination
```

Per domain:

- duplicate source keys = 0;
- duplicate destination keys = 0;
- invalid source documents = 0;
- invalid destination documents = 0;
- stale destination keys = 0 after approved removal;
- source checksum = matched destination checksum.

A failed condition is `incomplete`, not a partial success. The fence remains active.

---

## 6. Failure handling

### Reverse copy fails mid-run

- Journal entries for verified domains remain `verified`.
- Failed domain is `failed` with a bounded error string (no payloads).
- Fence remains `frozen`.
- Fix the cause, rerun the same command. Verified domains are revalidated and skipped; failed/pending domains resume.
- Do not manually edit Legacy records to “help” the copy.

### Unified source changes during copy

- Detection: post-copy re-inspection checksum differs or the source snapshot is unstable.
- Result: `incomplete`.
- Action: keep the fence active; stop all writes; investigate the process that bypassed the fence. Rerun only after the source is stable.

### Legacy destination has extra keys

- Default: blocked; extra keys preserved.
- Approved path: owner reviews keys and authorizes `--allow-stale-destination`.
- The tool reports how many stale records it removed.
- Never delete legacy keys manually outside a reviewed backup.

### Legacy destination has conflicting keys

- Unified is authoritative for the copy.
- Conflict count is reported before apply.
- Apply replaces the legacy value with the Unified value.
- Post-copy checksum must match.
- If a conflict cannot be explained, stop and review rather than overwriting.

### Fence release smoke fails

- Fence remains active.
- Writes stay read-only.
- Fix Legacy/configuration.
- Rerun `release --reason rollback`.
- Do not manually delete the fence document.

### Complete data loss/corruption

- Keep both stores and the fence.
- Restore from the verified backup into a separate database.
- Do **not** restore over the live source.
- Compare counts/checksums with `compare:migration-reports`.
- Only after owner approval should a restore be promoted; document the lost Unified-era writes.

---

## 7. Maintenance-window checklist

| Item | Required |
|---|---|
| Owner approval to roll back | Written |
| Fence acquired/reused with correct generation | Recorded |
| Writer drain completed | Recorded |
| Reverse dry run reviewed | Recorded |
| Stale/destination-only approvals | Recorded per key group |
| Reverse apply `ok=true` | Recorded |
| 20-domain journal verified | Recorded |
| Mode changed to `legacy` | Change record |
| Legacy smoke passed | Recorded |
| Fence released with reason `rollback` | Recorded |
| Unified retained, Legacy retained | Verified |
| Post-rollback user smoke | Recorded |
| Incident/report updated | Recorded |

---

## 8. What rollback does **not** do

- It does not drop Unified data.
- It does not retire Legacy.
- It does not merge accounts by email.
- It does not bypass the fence or make writers read-only forever.
- It does not guarantee recovery of writes that occurred while a process ignored the fence. Such writes are exactly what the source-mutation check is designed to detect.
- It does not authorize a later cutover back to Unified. That requires a fresh forward run and a fresh owner gate.

---

## 9. Final stop gate

Production rollback may proceed only when:

1. the owner has authorized the rollback;
2. the reverse dry run is `ready` or every blocker has a written resolution;
3. the fence is active and the drain is complete;
4. the reverse apply returns `APPLIED AND VERIFIED`;
5. the deployment is switched to `legacy`;
6. `release --reason rollback` passes its smoke test.

If any item is false, **keep the fence active and the product read-only**. Preserve both data stores and escalate. Do not trade data loss for availability.
