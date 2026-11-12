# LearnQuest — Project Knowledge

Durable engineering map for future agents and engineers. **Source and tests always win over this file.**
Verify any load-bearing claim against the cited file before editing. Built 2026-11-13 from the
working tree at `aabeed8` plus the Graphify graph (`graphify-out/`, AST-only, built from `aabeed82`).

## What LearnQuest is

Tracks YouTube-course learning as a measurable journey: exact per-video durations (never averaged),
verified playback evidence in an embedded player, focus sessions, goals, checkpoints, modules,
revision, history/reports, and an **optional, clearly labeled fictional Arena** (off by default,
synthetic competitors). Authenticated accounts; learning data lives in MongoDB scoped to the
account; IndexedDB is the local/test mode. Repo: two independent apps, no root package install.

## Architecture at a glance

```
YouTube Data API ──► backend/src (Express) ──► MongoDB (legacy lq_data_* [default] | unified lq_user_data)
                     ▲
   frontend/src ─────┘ same-origin /api, HttpOnly cookie, CSRF on mutations
   React 18 + Vite + TS strict, hash routing, no router library
```

- **Frontend** `frontend/src/`: `app/` (shell, `store.tsx` StoreProvider — the central
  state/actions layer), `domain/` (pure calculation engines, no SQL), `features/` (screen per
  destination), `components/` (UI primitives, charts, navigation), `services/` (API transport,
  IndexedDB, backup, exports), `types/`.
- **Backend** `backend/src/`: `routes/` (auth, account, playlists, playlist management),
  `auth/` (sessions, Google OAuth, action tokens, write leases — package-local, never exposed to
  the browser), `services/` (learning-data validation/orchestration, account lifecycle, migration
  control), `db/` (Mongo/memory adapters), `scripts/` (migration/inspection ops, **not** dev
  commands). Entry: `app.ts` → `server.ts`.
- **Routing** is hash-based (`#/dash … #/player`); `frontend/src/app/routes.tsx` defines the 15
  destinations in Learn/Insights/Manage groups (B.5 compass navigation — never convert to a
  sidebar/modal again). Heavy chart screens lazy-load via `React.lazy`.
- **State**: `StoreProvider` in `app/store.tsx` is the single owner of learning state. Do not add
  component-local stores or duplicate calculations; put mutations behind existing store actions.

## Frontend/backend contract

- `frontend/src/services/api/http.ts`: same-origin `/api`, credentials included,
  `X-CSRF-Token` on mutations; distinguishes session expiry (401) from errors; never retries
  non-idempotent calls.
- `frontend/src/services/api/readiness.ts`: singleton backend-readiness coordinator
  (bounded backoff + jitter, `Retry-After`, cold-start auto-resume). `503/TIMEOUT/NETWORK`
  are **never** treated as expired sessions.
- `GET /api/account/data` → `{ ok, schemaVersion: 1, loadedAt, state, version }`; all 20 domains
  present; `schemaVersion !== 1` rejected with 502, never blanked.
- Validation lives server-side too: learning-domain bounds, `backend/src/services/userData.ts`;
  Arena singleton: `backend/src/services/arenaValidation.ts` (keep aligned with the frontend
  `isArenaLedger`). State writes bounded (default 8 MB envelope), versioned (`lq_state_versions`),
  transactional where supported.

## Domain ownership (pure logic — change here first, then callers)

| Domain | Path | Owns |
|---|---|---|
| Identity | `domain/progress/identity.ts` | Stable `entryId` occurrence identity; `buildEntryProgressIndex`; `isProgressComplete`; positions are presentation-only |
| Duration | `domain/duration/duration.ts` | Integer-second totals; unresolved durations stay explicitly incomplete |
| Playback | `domain/playback/playback.ts` | Verified/manual/self-reported separation; `summarizeVerifiedSegments`; `completionFromCoverage` (default threshold 0.9) |
| Focus | `domain/focus/focus.ts` | Active-time integrity, monotonic+wall checks, gap exclusion/cap, XP idempotency |
| Time | `domain/time/time.ts` | DST-safe calendar keys, window attribution, `attributeFocusByDay`, `attributePlaybackByDay` |
| Revision | `domain/revision/revision.ts` | Review flags, history, `lastReviewIso`, annotation vs review separation |
| Goals | `domain/goals.ts`, `domain/preferences.ts` | Goal progress; minViable; calendar-day streak attribution |
| Arena | `domain/competition/arenaRuns.ts` (v3 ledger), `arenaTime.ts`, `competition.ts` (v2 compat + scoring), `arenaValidation.ts` | Versioned Arena; deterministic rivals (mulberry32); qualifying-day rule; ties share competition rank (1,2,2,4) |
| Gamification | `domain/gamification.ts` | XP ledger w/ dedup keys; `XP_RULES`; achievements |

## Critical invariants (workspace-wide)

1. **Missing stays missing** — never zero-fill/average/interpolate durations; totals stay labeled incomplete.
2. **Occurrence identity, not position** — progress/annotations key on `entryId`; duplicates are distinct; refreshes never rewrite records silently (`needsReview` flag preserved).
3. **Verified ≠ manual ≠ self-reported** — never infer verified completion from anything else.
4. **Interval unions** — unique coverage = union of timeline intervals; rewatches don't add coverage; sought/skipped spans never credited.
5. **Focus integrity** — active time excludes pauses/sleep; only ≥10 s sessions recorded; finish/recovery/XP idempotent.
6. **Cloud integrity** — optimistic versions + three-way merge by **record identity** (`cloudMerge.ts`); conflicts require explicit keep-local/use-server; a failed cloud read is never shown as an empty account.
7. **Local write discipline** — `updateArena` (store.tsx:2393): local mode commits via the IndexedDB write chain with read-update-write + stale-action guard; cloud mode applies in-memory after ledger validation; failure keeps existing records.
8. **Arena contract** — `arena-v3` model, frozen basis/seed/timezone, ≤20 archived runs, ≤90 checkpoints, ≤2,000 opponents; **no new MongoDB collections, no mutation of production data without approval**. Arena is fictional, labeled, off by default.
9. **Session security** — HttpOnly cookies (`Secure`+`__Host-` in prod), SameSite=Lax, CSRF + trusted origin on mutations, server-side revocation, SSE cross-device invalidation.
10. **Legacy→unified Mongo migration gated** — production runs `LQ_USER_DATA_STORE=legacy`; cutover requires owner-approved backup + dry-run + parity + `LQ_USER_DATA_CUTOVER_ACK`; **no cutover, migration, or retirement authorized**; migration runbooks are currently MISSING from this tree (see `PHASE_E_READINESS.md`).

## God nodes (Graphify, 2026-11-13)

`StoreProvider()` 127 edges · `useStore()` 86 · `Btn` 59 · `createAuthRouter()` 57 · `react` 55 ·
`DataStore` 46 · `Card` 46 · `createAccountRouter()` 44 · `AppInner()` 36 · `createDataStore()` 33.
These are the load-bearing abstractions; touch them deliberately.

**Detected cycle (imports):** `backend/src/auth/writeLease.ts` → `backend/src/services/userData.ts`
→ `backend/src/services/migrationControl.ts` → `backend/src/auth/writeLease.ts`. Real circular
dependency (const/type-level). Working today via ESM hoisting — do not "break" it casually, and do
not extend it without considering evaluation order.

## Frontend/backend symbol pairs to never confuse

- `frontend/src/domain/competition/arenaValidation.ts::isArenaLedger` vs
  `backend/src/services/arenaValidation.ts::isArenaLedger` — two validators that must agree.
- `domain/time/time.ts::attributionByDay` helpers vs `domain/competition/arenaTime.ts` v3 calendar.
- `domain/competition/competition.ts` (v2 scoring) vs `arenaRuns.ts` (v3 ledger) — v2 retained for
  legacy fixed-challenge snapshots and backup compatibility only.

## Test entry points

- Vitest: `npm --prefix frontend test` / `npm --prefix backend test`; baselines and intentional
  red cases in `TESTING.md` (EXPORT-1 is the only deferred case, verified reproducing 2026-11-13).
- Browser (real Chromium, synthetic fixtures): `frontend/tests/browser/*.browser.mjs` via
  `npm run test:browser:baseline`, `test:browser:regressions`, `node --test tests/browser/arena.browser.mjs`.
- Focused regression: `npm --prefix frontend run test:regressions` (intentionally red while EXPORT-1 open).
- Backend Mongo integration suites: skipped by default; opt-in only against authorized
  disposable MongoDB (`LQ_TEST_MONGO_URI`); never production.

## Documentation anchors

- `README.md` — architecture, config, deployment, security model, runbook links (some now broken).
- `HOW_TO_USE_LEARNQUEST.md` — user manual.
- `TESTING.md` — current test baseline and browser harness contract.
- `PHASE_C_VISUALIZATION.md`, `PHASE_D_ARENA.md` — visualization and Arena engineering reports.
- `docs/engineering/` (this folder) — durable engineering knowledge.
- `.agents/skills/learnquest-engineering/SKILL.md` — repo-specific agent rules (authoritative).
- **Known drift:** `docs/user-doc/MIGRATION_RUNBOOK.md` / `MIGRATION_ROLLBACK.md` / `docs/README.md`
  are referenced by README/manual but deleted in `7391d9c`; `node scripts/check-markdown-links.mjs`
  fails with 7 broken links. Do not recreate their content from invention — restore from history
  with owner approval.

## How to use Graphify here

`graphify-out/` (git-ignored) holds `graph.json`, `graph.html`, `GRAPH_REPORT.md`. Query before
broad greps: `graphify query "<question>"`, `graphify path "A" "B"`, `graphify explain "X"`.
AST-only build — community names are placeholders; 2% of edges are INFERRED (flagged); verify
load-bearing edges against source. Rebuild after code changes with `graphify update .` (AST-only,
no API cost) or `graphify extract . --code-only --force` for a clean rebuild. Never index `.env`,
`backend/`-side captures, or `test-results/` (see `.graphifyignore`).
