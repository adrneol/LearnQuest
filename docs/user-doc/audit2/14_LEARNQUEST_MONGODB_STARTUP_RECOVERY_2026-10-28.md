# Report 14 — LearnQuest MongoDB Startup Recovery (2026-10-28)

## Scope and execution policy

This report continues the MongoDB TLS investigation and implements the safe,
locally verifiable startup and recovery repairs. It does not rebuild the project
and does not change the Atlas endpoint, credentials, TLS policy, or production
deployment.

The run was limited to:

- inspecting the current working tree, report 13, MongoDB code, startup order,
  health routes, tests, and deployment configuration;
- reproducing the read-only MongoDB failure and comparing Node runtimes;
- implementing a supervised startup/readiness/reconnect lifecycle;
- adding fail-closed request handling and sanitized database errors;
- running targeted and full backend tests, typecheck, lint, and build;
- running frontend tests, typecheck, lint, and build because the API lifecycle
  and error contract changed;
- running an isolated startup test against an intentionally unreachable local
  MongoDB address (never Atlas);
- rechecking Render and Vercel with read-only public requests.

No secret was printed. No connection string, cluster hostname, username,
password, API key, action token, session token, or raw secret-bearing exception
appears in this report. No database write, migration, account deletion, legacy
retirement, index initialization, or normal startup against the configured
Atlas database was executed. Nothing was committed, pushed, reset, cleaned,
stashed, or switched to another branch.

`#max` is a session/model setting, not a repository setting. Nothing in this
work changed the session's model or reasoning configuration. Further runs
should continue with `#max` wherever the harness supports it.

## Repository baseline

At the start of this run:

```text
## main...origin/main [ahead 6]
?? LEARNQUEST_MONGODB_STARTUP_RECOVERY_PROMPT_2026-10-28.txt
?? LEARNQUEST_MONGODB_TLS_RECHECK_PROMPT_2026-10-28.txt
?? docs/
```

`HEAD` was `877c590 bad fix 5`, six commits ahead of `origin/main`. There were
no tracked modifications. The untracked files were the two prompt files and the
untracked `docs/user-doc/audit2/` directory containing report 13 and its archive
index. Report 14 did not exist, so this is the first and only report 14.

No existing report, environment file, secret, or uncommitted work was
overwritten. Report 13 and the existing archive index were read but preserved.

## Actual failure and sanitized evidence

### Commands and result

Read-only diagnostic, run from `backend/`:

```text
npm run diagnose:mongo -- --probe-tls
```

It exited with code 1, as expected for a failed connectivity check. The driver
did **not** connect, and the ping did **not** succeed.

With the current local Node `v24.11.0`, the sanitized result was:

```json
{
  "diagnostic": "mongo-read-only-connectivity",
  "readOnly": true,
  "database": { "expected": "learnquest", "matches": true },
  "uri": {
    "scheme": "mongodb+srv",
    "structurallyValid": true,
    "options": {
      "hasCredentials": true,
      "hasDatabasePath": true,
      "optionKeys": [],
      "tlsOption": "unset",
      "sslOption": "unset",
      "directConnection": false,
      "replicaSet": false
    }
  },
  "classification": "TLS_FAILURE",
  "connected": false,
  "ping": false,
  "retryable": true,
  "elapsedMs": 7080,
  "error": {
    "name": "MongoServerSelectionError",
    "code": null,
    "causeName": "MongoNetworkError",
    "causeCode": null,
    "reasonName": null,
    "reasonCode": null
  },
  "signals": ["tls_alert", "tls_handshake"],
  "tlsAlert": "internal_error",
  "detail": "classification=TLS_FAILURE retryable=true error=MongoServerSelectionError cause=MongoNetworkError tlsAlert=internal_error",
  "networkProbe": {
    "attempted": true,
    "srvResolved": true,
    "srvRecordCount": 3,
    "txtResolved": true,
    "txtRecordCount": 1,
    "elapsedMs": 233
  }
}
```

All three SRV targets and the cluster-host SNI variant failed the TLS handshake
with:

```text
code: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR
tlsAlert: internal_error
elapsedMs: 34–50 ms per attempt
```

The diagnostic was run again under the project's declared Node version,
`v24.22.1`, after adding the runtime field to the diagnostic output. It produced
the same result:

```json
{
  "runtime": { "node": "v24.22.1" },
  "classification": "TLS_FAILURE",
  "connected": false,
  "ping": false,
  "retryable": true,
  "elapsedMs": 7073,
  "tlsAlert": "internal_error",
  "networkProbe": {
    "srvResolved": true,
    "srvRecordCount": 3,
    "txtResolved": true,
    "txtRecordCount": 1
  }
}
```

The four handshake attempts under `v24.22.1` failed in 35–43 ms each with the
same `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` / `internal_error`.

An additional read-only TLS-variant check against the first resolved SRV target
tested:

| Variant | Result |
|---|---|
| TLS 1.2 with SNI | Failed, `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, `internal_error` |
| TLS 1.3 with SNI | Failed, `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, `internal_error` |
| Default TLS with no SNI | Failed, `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, `internal_error` |
| TLS 1.2 with no SNI | Failed, `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, `internal_error` |

This verifies that the previous report's conclusion still holds: forcing TLS
1.2 or TLS 1.3, or varying SNI, does not resolve the alert.

### Public TLS control

A verified TLS connection to `example.com:443` succeeded from the same machine:

| Runtime | Result |
|---|---|
| Node `v24.11.0` | `authorized: true`, `TLSv1.3` |
| Node `v24.22.1` | `authorized: true`, `TLSv1.3` |

Broad public TLS works. The failure is specific to the configured Atlas
endpoint/path, not a general inability to negotiate TLS.

### MongoDB Cloud public status

The public MongoDB Cloud status page showed no incident dated 2026-10-27 or
2026-10-28 at the time of the check. This is global status only; it does not
prove that a specific cluster, Atlas edge, or local network path is healthy.

### Classification

The reproducible failure is **external to the application source** as far as
this machine can establish:

- the URI shape and database name are valid;
- SRV and TXT resolution succeed;
- every tested TLS handshake to the Atlas targets returns the same server-side
  `internal_error` alert;
- the failure occurs before MongoDB authentication, so there is no evidence of
  a credential or authorization failure;
- a verified public TLS control succeeds;
- the same failure occurs under the supported Node runtime;
- no raw driver message, hostname, or URI appears in diagnostic output.

The remaining possibilities are Atlas cluster/edge behavior, the local network
path, VPN, proxy, endpoint protection, or TLS inspection. This run cannot
distinguish among them. The TLS issue is **not resolved**.

## Node runtime verification

| Item | Observed value |
|---|---|
| Local Node command | `v24.11.0` |
| Local npm | `11.6.1` |
| `backend/package.json` engines | `>=24.22.1 <25` |
| `backend/.node-version` | `24.22.1` |
| `backend/package-lock.json` root engine | `>=24.22.1 <25` |
| Installed MongoDB driver | `mongodb@7.7.0` |
| Render `NODE_VERSION` | `24.22.1` |
| Temporary supported runtime | `v24.22.1` via `npx -y node@24.22.1` |

The local machine has no nvm, fnm, or Volta installation. `npx` was used only to
run a temporary Node 24.22.1 binary for verification. It did not change the
global `node` command: after the checks, `node --version` still reported
`v24.11.0`.

The runtime mismatch is real and should be corrected for project policy, but it
**did not cause the TLS alert**. The identical `internal_error` handshake
failure occurs under `v24.22.1`. The mismatch also does not explain the failure,
because it persists with the supported runtime and the driver version is
unchanged.

## Source changes and reasons

### New files

| File | Purpose |
|---|---|
| `backend/src/db/mongoSupervisor.ts` | Process-local readiness supervisor: initial ping + index initialization, bounded exponential retry, 30-second heartbeat, shared in-flight attempts, clean shutdown, sanitized failure state, and once-only first-ready maintenance callback. |
| `backend/src/middleware/mongoReadiness.ts` | Fail-closed guard for account, authentication, and playlist-management routes. Returns `503 DATABASE_UNAVAILABLE` (or `SETUP_REQUIRED`) with `Retry-After`; never returns an empty account. |
| `backend/tests/mongo-supervisor.test.ts` | Tests for initial failure, retry, concurrency, bounded backoff, heartbeat failure, recovery, client reset, non-retryable failures, once-only maintenance, and shutdown. |
| `backend/tests/mongo-readiness.test.ts` | Tests for liveness/readiness separation, fail-closed routes, recovery, request-time driver failure, sanitized errors, and setup-required behavior. |

### Modified files

| File | Change |
|---|---|
| `backend/src/db/mongo.ts` | Added `appName`, `socketTimeoutMS: 45_000`, and `waitQueueTimeoutMS: 10_000`; bounded the ping command with `timeoutMS: 5_000`; guarded the rejected-promise cache clear with a client identity check; made `closeMongo()` detach state before awaiting so a newer connection cannot be cleared by an older close. TLS verification remains enabled and unchanged. |
| `backend/src/db/mongoErrors.ts` | Added `isMongoAvailabilityFailure()` so only availability-shaped driver errors become database 503s. Duplicate-key conflicts (`11000`/`11001`) and ordinary validation errors are explicitly excluded and keep normal route handling. Closed-client lifecycle failures are retryable after the supervisor replaces the client. Existing sanitization and TLS alert extraction are unchanged. |
| `backend/src/middleware/errors.ts` | Added `createErrorHandler()` with an `onMongoFailure` hook. MongoDB availability failures return a sanitized, retryable `503 DATABASE_UNAVAILABLE`, log only allowlisted fields, and never log/return the raw driver message. Ordinary application errors keep their existing status behavior. |
| `backend/src/app.ts` | Added optional production readiness injection and a route gate for `/api/auth` (except public `/api/auth/config`), `/api/account`, and `/api/playlists`. Passes the supervisor hook to the error handler. |
| `backend/src/controllers/playlistController.ts` | `/api/health` now explicitly reports HTTP liveness separately from database readiness. Added `/api/ready` with `200` only when the supervisor is ready and `503` otherwise. |
| `backend/src/routes/playlist.ts` | Registers `/api/ready`. |
| `backend/src/server.ts` | Starts the listener before database readiness, starts the supervisor from the listener callback, and only runs the existing account-deletion sweep once after the first fully ready connection. Shutdown stops the supervisor before closing the server and MongoDB client. |
| `backend/src/scripts/diagnoseMongo.ts` | Added the current Node runtime to the sanitized diagnostic output. The diagnostic remains read-only. |
| `render.yaml` | Added a comment clarifying that `/api/health` is a liveness check and must not be changed to `/api/ready`; behavior is unchanged. |
| `backend/tests/mongo-errors.test.ts` | Added coverage for the availability-vs-conflict distinction. |
| `backend/tests/mongo-lifecycle.test.ts` | Added coverage for client closure and a fresh connection after shutdown. |

## Startup, readiness, and retry behavior

### Liveness

`GET /api/health` remains the Render health-check path. It returns `200` when
the HTTP process is alive, with:

```json
{
  "ok": true,
  "liveness": true,
  "ready": false,
  "database": {
    "managed": true,
    "configured": true,
    "ready": false,
    "state": "starting|unavailable|ready|...",
    "consecutiveFailures": 1,
    "lastFailure": { "classification": "TLS_FAILURE", "retryable": true },
    "nextRetryInMs": 1000,
    "readyAt": null
  },
  "readinessPath": "/api/ready"
}
```

`ok: true` means the process is live. It does not mean the database is ready;
`ready` and `database` carry that separately. Render is therefore not restarted
merely because MongoDB is temporarily unavailable.

### Readiness

`GET /api/ready` returns:

- `200 { ok: true, ready: true, database: { state: "ready", ... } }` only after
  a successful ping **and** successful index initialization;
- `503 { ok: false, ready: false, database: { state: "unavailable|starting", ... } }`
  otherwise, with `Retry-After`.

Readiness is never inferred from the listener alone.

### Fail-closed routes

When readiness is false, these routes return `503` before authentication or data
access:

- `/api/auth/*` except `/api/auth/config`;
- `/api/account/*`;
- `/api/playlists/*`.

`/api/auth/config` remains available because it is public configuration and does
not require MongoDB. `/api/playlist` (YouTube import/cache) and `/api/cache`
remain available because they do not use the account database.

This means:

- no empty account is fabricated;
- no default local account is created;
- no cloud state is overwritten with empty defaults;
- a failed write is reported as not applied, not as saved;
- an existing browser session is not silently treated as a signed-out account.

Request-time driver failures are also mapped to the same sanitized, retryable
`503 DATABASE_UNAVAILABLE`, even if readiness was stale at the start of the
request.

### Retry and recovery

The supervisor:

- shares one in-flight connection attempt across concurrent callers;
- uses bounded exponential backoff from 1 second to 30 seconds
  (`1, 2, 4, 8, 16, 30, 30, ...`);
- schedules only one retry timer at a time;
- does not let request-time failures shorten the backoff or add timers;
- sends a read-only ping every 30 seconds while ready;
- marks readiness unavailable after a heartbeat failure;
- recovers in-process after connectivity returns, without requiring a restart;
- calls index initialization only when the prior initialization was not
  completed; a recovered connection normally reuses the already verified
  indexes;
- replaces the client after a closed topology or three consecutive failures, so
  a stuck driver connection cannot block recovery forever;
- stops all timers and ignores state changes after shutdown;
- logs only sanitized classifications and TLS alert descriptions.

### Shutdown

`SIGTERM`/`SIGINT` now:

1. stop the supervisor and cancel pending retries;
2. close the HTTP server;
3. close the MongoDB client;
4. exit.

A failed connection attempt is never cached permanently. A rejected connection
promise is cleared, and a later request or supervisor retry can create a fresh
client.

## Index initialization and destructive-maintenance safety

### Index initialization

- The supervisor calls `pingMongo()` first. No index is created by the ping.
- Only after the ping succeeds does it call `getMongoDb()`, which runs the
  existing idempotent index setup.
- `ensureUsernameIndex()` may drop and replace a legacy
  `usernameNormalized` index if an old non-partial index exists. It does not
  modify any account document. It attempts to restore the old constraint if the
  replacement fails.
- A failed index initialization leaves readiness false. Retryable failures are
  retried with backoff; non-retryable failures (for example, authorization)
  remain unavailable until configuration is corrected. A recovered connection
  cannot make readiness true before the required index initialization succeeds.
- The diagnostic does not initialize indexes, inspect account data, or write to
  the database.

### Account-deletion recovery

The existing deletion saga was not changed. Its safety properties remain:

- validation (recent authentication, current password or fresh Google login,
  confirmation phrase, CSRF, origin) happens before deletion begins;
- only accounts already marked `deleting`, or jobs whose account document is
  already gone, are eligible for the startup sweep;
- an account with status `active` is explicitly skipped;
- deletion is verified collection-by-collection before success is reported;
- a failed saga leaves the account unavailable and keeps a resumable job;
- a stale job for an active account does not delete that account.

The supervisor calls `resumePendingAccountDeletions(store)` only from its
once-only `onFirstReady` callback, after the first successful ping and index
initialization. It does **not** run on every reconnect, heartbeat recovery, or
connection retry after the service has already been ready. This preserves the
existing startup policy while preventing an unrelated reconnect from triggering
destructive maintenance.

If the very first startup connection fails and a later supervisor retry
succeeds, the once-only callback still runs at that first fully ready
connection, matching the previous "startup sweep after a successful startup"
policy. It will not run again for later runtime reconnects in the same process.
No migration or legacy-retirement path is invoked by the supervisor.

**No normal server was started against the configured Atlas database.** The
only full-process startup test used an intentionally unreachable local address
(`127.0.0.1:1`), so it could not initialize indexes or run the deletion sweep.

## Tests, typecheck, lint, and build

All commands were run from the stated directory.

### Backend

| Check | Command | Result |
|---|---|---|
| Targeted MongoDB suites | `npm test -- --run tests/mongo-supervisor.test.ts tests/mongo-readiness.test.ts tests/mongo-lifecycle.test.ts tests/mongo-errors.test.ts` | **4 files, 31 tests passed** |
| Full backend suite | `npm test` | **19 files, 154 tests passed**, 18.51 s |
| Full backend suite under supported runtime | `npx -y node@24.22.1 node_modules/vitest/vitest.mjs run` | **19 files, 154 tests passed**, 10.50 s |
| Backend typecheck | `npm run typecheck` | Passed |
| Backend build | `npm run build` | Passed |
| Backend lint | `npm run lint` | **0 errors, 84 warnings** (existing `no-explicit-any` warnings; no new warnings from the new files) |

The new tests cover:

- first connection failure classification;
- retry after a failed connection;
- no concurrent runaway retries;
- bounded exponential backoff;
- heartbeat failure and recovery;
- index initialization only once after a successful connection;
- client replacement after repeated failures;
- closed-client lifecycle failure being retried instead of remaining permanently unavailable;
- shutdown cancelling pending retries;
- non-retryable authentication failure not being retried automatically;
- once-only first-ready maintenance, not repeated on reconnect;
- liveness separate from readiness;
- fail-closed account and learning routes;
- recovery opening the gate without fabricating a signed-in account;
- a request-time driver failure returning `503` rather than an empty state;
- sanitized logs and responses without secrets;
- ordinary application errors not becoming database 503s.

### Frontend

Frontend code was not changed, but the API error/readiness contract changed, so
the full frontend checks were run:

| Check | Command | Result |
|---|---|---|
| Frontend tests | `npm test` | **41 files, 325 tests passed**, 100.83 s |
| Frontend build | `npm run build` | Passed |
| Frontend typecheck | `npm run typecheck` | Passed |
| Frontend lint | `npm run lint` | **0 errors, 4 warnings** (existing hook-dependency warnings) |

### Isolated startup integration check

A built backend was started against an intentionally unreachable local address,
not Atlas, with no database initialization possible:

```text
HEALTH_STATUS=200
HEALTH={"ok":true,"liveness":true,"ready":false,
        "database":{"state":"unavailable","consecutiveFailures":1,
                    "lastFailure":{"classification":"NETWORK_TIMEOUT","retryable":true},...}}
READY_STATUS=503
READY={"ok":false,"ready":false,...}
ACCOUNT_STATUS=503
ACCOUNT={"error":"The database is currently unavailable. The request was not applied; retry when the service is ready.",
         "code":"DATABASE_UNAVAILABLE","retryable":true,...}
```

The process log contained only the sanitized line:

```text
MongoDB (database "learnquest") is unavailable
(classification=NETWORK_TIMEOUT retryable=true error=MongoServerSelectionError
cause=MongoNetworkError); next connection attempt in 1000 ms.
```

The process was stopped after the check. No Atlas connection was made, so no
index creation or deletion sweep occurred.

## Did the diagnostic reach CONNECTED?

**No.**

- `classification` remained `TLS_FAILURE`.
- `connected` remained `false`.
- `ping` remained `false`.
- No successful MongoDB ping was observed under Node `v24.11.0` or the supported
  Node `v24.22.1`.
- The code changes improve safe behavior while the database is unavailable and
  allow automatic recovery when it becomes reachable. They do not make the
  current TLS handshake succeed.

The local code changes are verified; live Atlas reconnection is **not** verified
because the TLS handshake still fails before authentication.

## Local versus production verification

These are separate from the local TLS failure and do not prove MongoDB
connectivity from either deployment.

### Render

Read-only checks on 2026-10-28:

- `GET https://learnquest-hhiv.onrender.com/api/health` returned `200`:
  `{"ok":true,"hasKey":true,"version":"0.2.0","time":"2026-10-27T20:47:42.660Z"}`.
- `GET .../api/ready` returned `404`.
- `GET .../api/auth/config` returned `404`.

The live Render deployment is still version `0.2.0`; local code is `0.3.0`.
It does not contain the new readiness endpoint or the newer auth routes. Its
health response is liveness only and does not demonstrate a successful MongoDB
ping.

### Vercel

Read-only checks on 2026-10-28:

- `GET https://learn-quest-one.vercel.app/` returned `200` from Vercel.
- `GET .../api/health` returned `404` with `Server: Vercel`.
- `GET .../api/auth/config` returned `404`.

The repository contains `frontend/vercel.json` with an `/api/:path*` rewrite to
the Render service, but the live Vercel deployment is not serving that rewrite.
The Render target is also stale. This is deployment/configuration work, not
evidence that the local TLS failure was fixed.

No deployment, credential change, production secret change, or Vercel/Render
setting change was made.

## Root-cause assessment

| Possible cause | Evidence | Verdict |
|---|---|---|
| Incorrect or unsupported Node runtime | Same TLS alert under Node `v24.22.1`; public TLS works under both runtimes | **Not the cause of the TLS alert**; local runtime is still out of policy |
| MongoDB driver lifecycle defect | Rejected promises are retryable; new tests cover retry, concurrency, backoff, recovery, client reset, shutdown | No reproducible driver lifecycle defect found; lifecycle gaps were fixed |
| URI, database name, or credentials | URI structurally valid, database name matches, failure occurs before authentication | No evidence of a URI/credential defect; do not rotate credentials without an auth error |
| TLS protocol/SNI defect | TLS 1.2, TLS 1.3, SNI and no-SNI all fail with `internal_error` | Ruled out as the trigger; the peer returns the alert |
| DNS/SRV | SRV and TXT resolution succeed; 3 SRV records | Ruled out |
| Public internet/TLS | `example.com:443` succeeds with verified TLS 1.3 | Broad TLS path works |
| Atlas cluster/edge or local network path | All Atlas handshakes fail immediately with a server-side alert; public status is global only | **Remaining external possibility; unresolved** |

The root cause remains external to the application source as far as this machine
can establish. It is not safe to claim a fix, and TLS verification must not be
weakened to force a connection.

## Exact remaining owner actions

1. **Install the declared Node runtime locally.** The project requires Node
   `>=24.22.1 <25`. This machine has `v24.11.0` and no version manager. Install
   Node `24.22.1` with the official Windows installer or nvm-windows, then
   confirm `node --version`. Do not lower the engine requirement or
   `.node-version` to match the old local runtime. A temporary supported runtime
   can also be used with:
   `npx -y node@24.22.1 node_modules/tsx/dist/cli.mjs src/scripts/diagnoseMongo.ts --probe-tls`
   from `backend/`.

2. **Check the Atlas cluster state in the MongoDB Atlas console.** Confirm the
   cluster is active, not paused/resuming, and has no cluster-specific alert or
   maintenance event.

3. **Check Atlas Network Access separately.** Confirm the current public IP is
   allowed with the narrowest possible entry. Do not permanently widen access to
   all IP addresses. An allowlist problem usually appears after TLS, so treat
   this as a separate check rather than the explanation for this handshake
   alert.

4. **Retest from a different network**, preferably a mobile hotspot, without the
   current VPN, proxy, endpoint protection, or TLS-inspecting middlebox. Run the
   same read-only diagnostic under Node 24.22.1:
   `npm run diagnose:mongo -- --probe-tls`
   (or the `npx` form above).

5. **If the alternate network succeeds**, investigate the original network's
   VPN, proxy, endpoint protection, or TLS inspection. Do not disable
   certificate validation to compensate.

6. **If the alternate network produces the same alert**, contact Atlas support
   with the failing timestamp and the sanitized evidence:
   - `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`
   - alert description `internal_error`
   - SRV/TXT resolution succeeds
   - public TLS control succeeds
   - TLS 1.2, TLS 1.3, SNI, and no-SNI variants all fail
   Do not send the connection string, username, password, or cluster hostname.

7. **Before normal startup after connectivity returns**, review whether any
   accounts are already marked `deleting` or have pending deletion jobs. The
   existing startup sweep is once per process and will resume those legitimate
   jobs after the first fully ready connection. It does not touch active
   accounts, but the owner should accept that review before starting the normal
   service. Do not trigger deletion or migration merely to test connectivity.

8. **Deploy separately when ready.** The live Render service is still `0.2.0`
   and the Vercel `/api` proxy is not serving the rewrite. After reviewing the
   local changes, deploy the backend, verify `/api/health` remains `200`,
   verify `/api/ready` becomes `200` only when Atlas is reachable, then deploy
   the matching frontend and verify the `/api` rewrite. These are deployment
   actions, not part of the local TLS diagnosis. Do not deploy automatically
   from this investigation.

Additional guidance:

- Do not disable TLS verification or set `rejectUnauthorized=false`.
- Do not invent or replace the MongoDB URI.
- Do not rotate database credentials without a genuine post-TLS authentication
  error.
- Do not treat the public health endpoint as proof of MongoDB connectivity.
- Do not report the TLS issue as fixed until a real driver connection and ping
  succeed.

## Final Git status

No commit, push, reset, clean, stash, or branch switch was performed. Existing
tracked work was modified only where listed above. The new report and archive
index remain untracked because `docs/` was already untracked at baseline.
`backend/dist/` and `frontend/dist/` were regenerated by builds and are ignored
by Git.

```text
## main...origin/main [ahead 6]
 M backend/src/app.ts
 M backend/src/controllers/playlistController.ts
 M backend/src/db/mongo.ts
 M backend/src/db/mongoErrors.ts
 M backend/src/middleware/errors.ts
 M backend/src/routes/playlist.ts
 M backend/src/scripts/diagnoseMongo.ts
 M backend/src/server.ts
 M backend/tests/mongo-errors.test.ts
 M backend/tests/mongo-lifecycle.test.ts
 M render.yaml
?? LEARNQUEST_MONGODB_STARTUP_RECOVERY_PROMPT_2026-10-28.txt
?? LEARNQUEST_MONGODB_TLS_RECHECK_PROMPT_2026-10-28.txt
?? backend/src/db/mongoSupervisor.ts
?? backend/src/middleware/mongoReadiness.ts
?? backend/tests/mongo-readiness.test.ts
?? backend/tests/mongo-supervisor.test.ts
?? docs/user-doc/audit2/13_LEARNQUEST_MONGODB_TLS_RECHECK_2026-10-28.md
?? docs/user-doc/audit2/14_LEARNQUEST_MONGODB_STARTUP_RECOVERY_2026-10-28.md
?? docs/user-doc/audit2/README.md
```

## Final assessment

**Local code fixes:** implemented and verified. The backend now keeps liveness
separate from database readiness, fails account/data routes closed, returns
sanitized retryable 503 responses instead of raw driver failures, retries with
bounded exponential backoff, recovers in-process after a transient failure,
cancels retries on shutdown, and keeps destructive deletion recovery out of the
ordinary reconnect path. The declared Node runtime was verified and the same
failure was reproduced under it.

**Unresolved external connectivity:** the Atlas TLS handshake still fails with
`internal_error` before authentication. The database did not connect, the ping
did not succeed, and live reconnection has not been verified. This remains an
external network/Atlas-path issue until the owner performs the alternate-network
and Atlas checks above.
