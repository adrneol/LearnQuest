# LearnQuest — Phase F Reliability and Session Boundaries

Phase F hardens confirmed reliability and authentication edges without changing
production data, database schemas, deployment configuration, or domain rules.

## Cloud recovery

Cloud edits still save through the existing 350 ms debounce and server version
checks. Before that debounce can write, a browser keeps an account-scoped,
seven-day recovery copy in its local IndexedDB. It is not a cloud success
indicator and is never sent to another account.

Only merge-safe learner state is eligible: progress, ranges, checkpoints,
modules, goals, flexible goals, settings, and preferences. Session/evidence,
XP, Arena, playlist/import, queue, and other potentially destructive data are
not replayed from a recovery copy. On the next login for the same account, the
person must choose **Review and recover changes**. Recovery runs the normal
three-way merge against the current server version; conflicting records remain
in the existing review flow. A successful server save removes the recovery
copy. Corrupt, expired, over-size, and browser-storage failures fail closed
with actionable UI status; they never overwrite server state.

Signing out clears rendered account data immediately but intentionally retains
the account-scoped recovery copy until it expires, is discarded, or saves. This
allows the same person to recover a reload-interrupted edit after signing back
in while preventing another account from reading or applying it.

### Recovery during storage-maintenance read-only mode

When `MIGRATION_READ_ONLY` is active (the server rejected a write because a
storage-maintenance migration is running), the recovery banner remains
visible but the *Review and recover changes* button is disabled with an
explanatory note; discarding the account-scoped local copy stays available
because deleting local state cannot affect the account. Once the freeze ends
(the next write attempt succeeds) the recovery action becomes available again
and the draft is preserved. Recovery applies state locally and queues a cloud
write; the write failing with `CODE_MIGRATION_READ_ONLY` leaves both the UI
and the draft unchanged.

### Hydration readiness

The Focus daily-goal editor, Goals page goal summary, and the Player learning
record are mounted only after the store finishes local IndexedDB hydration
(`ready=true`). This avoids a flash of the prefs-default value (25 minutes)
before persisted goals (`2026-06-15T12:00:00Z`, target 1800s) are known and
prevents a way to edit the editor against an uninitialised draft.

## Session revocation boundary

Each request still reads its session and account before entering a protected
handler. The idle-window renewal is now a conditional database update matching
the session id, token hash, non-revoked flag, unexpired timestamps, and password
version. If revocation or password invalidation wins between lookup and touch,
the request fails as `SESSION_REVOKED` and its cookie is cleared.

The conditional touch is the request-admission boundary. A request admitted
before a later logout may finish; a session revoked before or during admission
cannot be renewed or enter the handler. Account-deletion-sensitive mutations
continue to use the existing account write lease, so an account entering the
deleting state rejects newly admitted writes.

## OAuth deployment validation

Production Google callback URLs must be exact public HTTPS
`/api/auth/google/callback` endpoints, without credentials, a query, or a
fragment. The callback origin must be the configured frontend or API origin.
This supports the deployed frontend callback rewrite and direct API callback
topology while rejecting local, private, and untrusted redirect origins.

## Readiness coordination

Concurrent callers share one backend wake probe cycle. Each caller may leave
on its own abort signal or budget without cancelling other callers. The shared
cycle adopts the largest active retry/time budget, preventing a short bootstrap
or navigation caller from prematurely failing a longer caller. If all callers
leave, the cycle stops before another retry.

## Regression coverage

- `frontend/tests/cloud-recovery.test.ts`: account isolation, safe collection
  filtering, merge conflicts, corrupt/expired recovery cleanup.
- `frontend/tests/cloud-persistence.test.tsx`: reload during a pending debounced
  cloud write, explicit recovery, confirmed subsequent save, and the full
  freeze/unlock lifecycle (recovery disabled while `MIGRATION_READ_ONLY`, discard
  always available, recovery re-enabled after the freeze lifts).
- `frontend/tests/readiness.test.ts`: competing budgets and independent caller
  cancellation.
- `frontend/tests/goals-integration.test.tsx`: deterministic integration of
  daily Focus goals across the Goals and Focus pages, pinned to a fixed UTC
  noon reference instant so attribution tests and persisted-goal hydration are
  independent of wall-clock and host timezone; cross-midnight split-day
  attribution is covered by explicit fixed-date fixtures.
- `backend/tests/session-reliability.test.ts`: revocation between session read
  and renewal.
- `backend/tests/origin-config.test.ts`: frontend/API callback allow-list and
  hostile redirect variants.

Existing SSE invalidation and cross-tab suites remain the adversarial coverage
for payload allow-listing, reconnect, session targeting, post-revocation
reconnect rejection, BroadcastChannel, and storage-event fallback.

## Known limitations (explicitly documented)

- Recovery protects only eight of the twenty learning-data collections:
  playlists/imports, costs, active-ID reassignment, session/evidence records,
  XP, Arena, rank history, achievements, queue, and reorder-tolerant imports
  are excluded because three-way merge cannot guarantee their integrity.
- Recovery does not prove a cloud save completed; a successful recovery
  completes only after the server acknowledges the merged write.
- MongoDB transaction guarantees for conditional session touch and write leases
  are not exercised in this repo without an authorized disposable MongoDB
  replica set; in-memory adapters verify the same contract logic.
- No production deployment verification (cookie behaviour across proxy, live
  500-path, real revocation fan-out) is possible from this environment.
