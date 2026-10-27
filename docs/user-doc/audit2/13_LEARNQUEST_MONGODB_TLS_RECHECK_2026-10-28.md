# Report 13 — LearnQuest MongoDB TLS Recheck (2026-10-28)

## Scope and execution policy

This is a continuation of the MongoDB TLS investigation, not a rebuild. The
work was limited to:

- inspecting the current repository and the existing MongoDB connectivity code;
- running the existing read-only diagnostic once from `backend/`;
- verifying the startup safety order and fail-closed behavior;
- running backend tests, typecheck, and build;
- rechecking the public Render and Vercel deployment facts separately.

No secret was printed. No connection string, cluster hostname, username,
password, or credential value appears in this report. No database write,
migration, account deletion, legacy retirement, index initialization, or normal
application startup was executed. Nothing was committed, pushed, reset,
cleaned, stashed, or switched to another branch.

`#max` is a session/model setting, not a repository setting. Nothing in this
work changed the session's model or reasoning configuration. Further runs should
continue with `#max` wherever the harness supports it.

## Repository state and report availability

At the start of this run:

```text
## main...origin/main [ahead 6]
?? LEARNQUEST_MONGODB_TLS_RECHECK_PROMPT_2026-10-28.txt
```

The working tree had no tracked modifications. The only untracked file was the
prompt. Six local commits were ahead of `origin/main`:

```text
877c590 bad fix 5
29cb0e5 bad fix 3
8376080 bad fix 2
9b612e5 bad fix
58c1b15 multi user added
40af48c add many many
```

### Report 12 was not present

The requested file
`docs/user-doc/audit2/12_LEARNQUEST_MONGODB_CONNECTIVITY_RECOVERY_2026-10-28.md`
and the requested archive index `docs/user-doc/audit2/README.md` did not exist
in the working tree. The `docs/` directory was empty. A search found no copy
elsewhere under `E:\` or `C:\Users\n0ne`.

The files were also absent from:

- all local and remote branches (`git log --all -- docs/user-doc/audit2` and
  `git log --all -- docs/audit2` returned no commits);
- the Git index and all reachable history;
- stashes (none);
- 253 unreachable blobs inspected with `git cat-file` (none contained the
  report title or filename).

The latest commit, `877c590 bad fix 5`, deleted unrelated earlier documents
under `docs/audits/` and the top level of `docs/`, but it never contained this
report 12 path. Those deletions were not reverted and no deleted document was
restored.

**Consequence:** report 12 could not be read. The claims attributed to it in the
task prompt were therefore verified directly against the current source code and
runtime evidence, not against the missing report text. This report does not
invent or quote report-12 content.

## Previous implementation review

The following current files were inspected completely or in the relevant
sections:

- `backend/src/db/mongoErrors.ts`
- `backend/src/scripts/diagnoseMongo.ts`
- `backend/src/db/mongo.ts`
- `backend/src/server.ts`
- `backend/src/config/env.ts`
- `backend/src/store.ts`
- `backend/src/services/accountDeletion.ts`
- `backend/package.json`, `backend/.env.example`, `render.yaml`,
  `frontend/vercel.json`
- `backend/tests/mongo-errors.test.ts`,
  `backend/tests/mongo-lifecycle.test.ts`

### Claim verification

| Claim from the prompt/report-12 summary | Current evidence | Verdict |
|---|---|---|
| URI structure and database name are valid. | Diagnostic reported `mongodb+srv`, `structurallyValid: true`, credentials present, database path present, no query options, and database name matches `learnquest`. No value was printed. | Verified |
| MongoDB SRV and TXT DNS lookups succeed. | Network probe reported `srvResolved: true`, `srvRecordCount: 3`, `txtResolved: true`, `txtRecordCount: 1`. | Verified |
| All tested Atlas TLS handshakes fail with `internal_error`. | All three SRV targets and the cluster-host SNI variant failed with `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`; sanitized alert `internal_error`. | Verified |
| Forcing TLS 1.2 and TLS 1.3 did not resolve it. | The current diagnostic has no TLS-version forcing option, and the previous evidence is unavailable because report 12 is missing. This was not re-run, to avoid repeating the same failing endpoint without a changed condition. | Not independently re-verified |
| Public TLS controls succeed. | A separate read-only TLS control to `example.com:443` succeeded with `authorized: true` and `TLSv1.3`. | Verified |
| The failure is classified as `TLS_FAILURE`. | Diagnostic classification was `TLS_FAILURE`; `describeMongoFailure()` produced `classification=TLS_FAILURE`, with no raw driver message. | Verified |
| Failed connection attempts are now retryable. | `isRetryableMongoFailure('TLS_FAILURE')` returns `true`; diagnostic reported `retryable: true`; `connectMongoDb()` clears the cached rejected promises so the next request can try again. | Verified |
| Startup pings before index initialization and deletion recovery. | `server.ts` calls `pingMongo()` first, then `getMongoDb()` (index initialization), then `resumePendingAccountDeletions(store)`. `pingMongo()` uses `connectMongoDb()`, which does not initialize indexes. | Verified |

### Relevant implementation details

- `mongoErrors.ts` returns only allowlisted error names, codes, coarse signals,
  and a TLS alert description. Raw messages are not included in
  `describeMongoFailure()`. The existing sanitization test verifies that a
  secret-bearing connection string is not copied into output.
- `diagnoseMongo.ts` uses the application environment loader and MongoDB
  driver, performs exactly one `client.connect()` and one `ping`, and closes the
  client in `finally`. It is read-only. TLS verification remains enabled
  (`rejectUnauthorized: true`). TLS probing only runs after a connection failure
  and opens handshakes without sending a MongoDB command.
- `mongo.ts` does not disable TLS verification, does not set
  `rejectUnauthorized: false`, and does not substitute a local data source. A
  rejected connection promise is cleared so a transient failure is not cached
  for the life of the process.
- `server.ts` keeps the process listening but fails closed: if the ping or index
  initialization fails, it logs a sanitized failure and returns from the startup
  callback. Auth and data endpoints then fail through the unavailable database
  path; there is no silent local fallback.
- `env.ts` validates the URI scheme/length without printing the value and
  validates the database name separately.

## New diagnostic result

Command, run from `backend/`:

```text
npm run diagnose:mongo -- --probe-tls
```

The command exited with code 1, which is expected for a failed connectivity
check. Run date: 2026-10-28 (local, IST); the immediately following test run
started at 01:51:34 IST.

### Sanitized result

```json
{
  "diagnostic": "mongo-read-only-connectivity",
  "readOnly": true,
  "configured": true,
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
  "elapsedMs": 7122,
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
    "elapsedMs": 218
  }
}
```

The four handshake attempts (three SRV targets plus one cluster-host SNI
variant) each failed with:

```text
name: Error
code: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR
tlsAlert: internal_error
elapsedMs: 34–42 ms per attempt
```

### Interpretation

- MongoDB did **not** connect.
- The `ping` command was **not** sent successfully; it is marked `false`.
- Failure occurs during the TLS handshake, before MongoDB authentication. There
  is no evidence of a credential or authorization failure.
- DNS/SRV/TXT resolution is healthy.
- The driver waits about 7 seconds for server selection even though each TLS
  attempt fails in tens of milliseconds.
- `retryable: true` means the application does not cache the rejection forever;
  it does not mean repeatedly retrying the same unchanged endpoint is
  productive.

## Source code changes

**No source code was changed.**

No reproducible source-code defect was demonstrated:

- the failure is classified correctly as `TLS_FAILURE`;
- the TLS alert is extracted correctly as `internal_error`;
- the failure is correctly marked retryable;
- public TLS works while the Atlas handshakes fail;
- startup order is ping → indexes → deletion recovery, as intended;
- no URI, host, username, password, or raw driver message appeared in the
  diagnostic output.

Because the same `TLS_FAILURE` persists and the implementation already handles
it correctly, no speculative change was made to the URI, TLS options,
credentials, driver, retry policy, or error classification. No regression test
was added because no defect was fixed; the existing MongoDB error and lifecycle
tests still pass.

### Non-causal environment note

The local runtime is Node `v24.11.0`, while `backend/package.json` declares
`"node": ">=24.22.1 <25"`. This mismatch was observed but not changed: lowering
the engine requirement would weaken the project's pinned runtime policy, and
there is no evidence that the version mismatch caused the Atlas alert. The
owner should run future checks on the declared Node version.

## Startup and database safety

The startup path was inspected, not executed against the configured database.

1. `pingMongo()` connects and sends a read-only `ping`. It does not initialize
   indexes or collections.
2. If the ping succeeds, `getMongoDb()` runs `ensureIndexes()`. This is
   schema-only idempotent work, but `ensureUsernameIndex()` can drop and replace
   a legacy `usernameNormalized` index if an old non-partial index is present.
   No user document is modified by that index replacement.
3. Only after both steps succeed does `resumePendingAccountDeletions(store)`
   run. It selects accounts with `status: 'deleting'` and existing deletion
   jobs. Active accounts are skipped. This sweep is intentionally destructive
   for accounts already marked for deletion and is not safe to trigger casually.
4. If the ping or index step fails, startup logs a sanitized failure and does
   not run the deletion sweep. The API remains fail-closed; there is no local
   fallback.

**This run did not start the normal backend, did not initialize indexes, and did
not run the account-deletion sweep.** Before normal startup is recommended after
connectivity returns, the owner should review whether any accounts are already
marked `deleting` and accept that the startup sweep may finish those deletions.

## Tests and build

Run from `backend/`:

| Check | Command | Result |
|---|---|---|
| Full backend test suite | `npm test` | **17 test files passed, 129 tests passed**, 16.70 s |
| Backend typecheck | `npm run typecheck` | Passed |
| Backend build | `npm run build` | Passed |
| Public TLS control | Node `tls.connect` to `example.com:443`, verification enabled | Succeeded, `authorized: true`, `TLSv1.3` |
| MongoDB diagnostic | `npm run diagnose:mongo -- --probe-tls` | Failed as expected: `TLS_FAILURE`, `internal_error`, no connection |

The test suite includes `backend/tests/mongo-errors.test.ts` (classification,
TLS alert extraction, retryability, secret non-disclosure) and
`backend/tests/mongo-lifecycle.test.ts` (retry after a failed connection).

No frontend code changed, so frontend tests/build were not run.

## Local versus live deployment status

These checks are separate from the local TLS failure and do not prove MongoDB
connectivity from either deployment.

### Render

- `GET https://learnquest-hhiv.onrender.com/api/health` returned `200 OK` on the
  second attempt (the first attempt timed out after 20 s, consistent with a cold
  start).
- Response body: `{"ok":true,"hasKey":true,"version":"0.2.0","time":"2026-10-27T20:22:34.043Z"}`.
- The local backend version is `0.3.0`, so the live Render deployment is stale.
- `GET https://learnquest-hhiv.onrender.com/api/auth/config` returned `404`,
  consistent with the older deployment not exposing the newer auth routes.
- The health response does not demonstrate a successful MongoDB ping. It should
  not be treated as proof that the live database is reachable.

### Vercel

- `GET https://learn-quest-one.vercel.app/` returned `200`.
- `GET https://learn-quest-one.vercel.app/api/health` returned `404` with
  `X-Vercel-Error: NOT_FOUND` and `Server: Vercel`.
- `GET https://learn-quest-one.vercel.app/api/auth/config` returned `404`.
- The repository contains `frontend/vercel.json` with an `/api/:path*` rewrite to
  the Render service, but the live Vercel deployment does not appear to be
  serving that rewrite. Separately, the Render target is itself stale.
- This is a deployment/configuration issue, not evidence that the local TLS
  failure was fixed or that the live database is healthy.

No deployment, credential change, or production configuration change was made.

## Root cause assessment

The root cause remains **external to the application source** as far as this
local evidence can establish.

Evidence for external cause:

- The URI parses and the expected database name is correct.
- SRV and TXT DNS lookups succeed.
- All Atlas TLS handshakes fail immediately with the same
  `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`.
- A public TLS control from the same machine succeeds with verified TLS 1.3.
- No authentication or authorization error is reached.
- The local code classifies and sanitizes the failure correctly.

The remaining possibilities are on the network path or at the Atlas edge:
VPN, proxy, endpoint protection, TLS inspection, ISP/SNI filtering, or an Atlas
cluster/edge condition. This run cannot distinguish among them, so the issue is
**not resolved** and must not be reported as fixed.

## Exact next steps for the owner

1. Confirm in the MongoDB Atlas console that the cluster is active and has no
   cluster-specific alert (paused, resuming, maintenance, or incident).
2. Retest from a different network, preferably a mobile hotspot, without the
   existing VPN or TLS-inspecting proxy if one is in use.
3. From `backend/` on that network, run the same read-only command:
   `npm run diagnose:mongo -- --probe-tls`
4. If the alternate network succeeds, investigate the original network's VPN,
   proxy, endpoint protection, or TLS inspection. Do not weaken TLS verification
   to compensate.
5. If the alternate network produces the same TLS alert, contact Atlas support
   with the timestamp of the failing run and the sanitized error
   `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` (alert description: `internal_error`).
6. Check Atlas Network Access separately using a narrow public-IP allowlist
   entry. An allowlist problem usually becomes apparent after TLS, so treat this
   as a separate check rather than the explanation for this specific handshake
   alert. Do not permanently widen access to all IP addresses.
7. Only investigate database credentials if a genuine authentication error is
   observed after TLS succeeds. Do not rotate credentials without that evidence.

Additional guidance:

- Do not disable TLS verification or set `rejectUnauthorized=false`.
- Do not invent or replace the MongoDB URI.
- Do not ask anyone to reveal the connection string or password.
- Before recommending normal startup after connectivity returns, review the
  startup side effects described above, especially the account-deletion sweep.
- Treat the stale Render `0.2.0` deployment and the broken Vercel `/api` proxy
  as separate deployment work; do not deploy automatically from this
  investigation.

## Final Git status

No commit, push, reset, clean, stash, or branch switch was performed. No tracked
file was modified (`git diff --stat` was empty). The only new files are this
report and the archive index. `backend/dist/` was regenerated by the build but
is ignored by Git.

```text
## main...origin/main [ahead 6]
?? LEARNQUEST_MONGODB_TLS_RECHECK_PROMPT_2026-10-28.txt
?? docs/user-doc/audit2/13_LEARNQUEST_MONGODB_TLS_RECHECK_2026-10-28.md
?? docs/user-doc/audit2/README.md
```

`git status --short --branch` collapses the new directory to `?? docs/`; the
`-uall` form lists the two report files shown above.
