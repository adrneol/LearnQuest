# V6 FINAL AUDIT — Reliability, Time-Accuracy, API Efficiency & Production Readiness

Date: 2026-10-13. Root: `E:\progressGameTracker` (`frontend/` React+Vite+TS,
`backend/` Node+Express). Prior state: 157 frontend + 11 backend tests passing
(V5); V5 left 8 items partially/unverified.

Finding labels: **verified by test** · **measured** · **inferred** (code
inspection) · **not verified**.

## 1. Scope inspected

- Every frontend route trigger of network I/O (`playlistApi`, `Playlists`,
  `Reports`, `App`, `Settings`); all backend API paths (`app`, `routes`,
  `controllers`, `youtubeService`, `memoryCache`, `rateLimit`, `env`,
  `playlistId`, error middleware).
- All time paths from the V5 matrix (re-traced, not assumed): playback,
  focus lifecycle, attribution, streaks, goals, revision, Arena, exports,
  charts, persistence, `useDayTick` wiring (including a hooks-order audit).
- Store persistence (debounced writer), IndexedDB layer, backup/restore
  validation, XP/segment dedup ledgers.
- `git status` (clean at start), package scripts, `render.yaml`,
  `.env.example`, both audit docs, README/HOWTO.

## 2. Defects found, root causes, fixes (all with regression tests)

### D1. Refresh button could serve stale cache — VERIFIED BY TEST
- Cause: `GET /api/playlist` always read cache first; `Reports add(refresh)`
  sent no bypass signal, so "Refresh active" returned the fresh-cache entry.
- Fix: `?refresh=1` (`isRefreshRequested` in `playlistSchemas.ts`;
  controller bypasses cache read but still writes + dedupes); frontend
  `fetchPlaylistFromServer(input, {refresh})`; Refresh passes it, Add does
  not; result message states fresh-vs-cache. Test: refresh doubles upstream
  3→6 with `playlistRefreshes=1`, `cached:false`.

### D2. Retries burned quota on quota errors — VERIFIED BY TEST
- Cause: videos-chunk retry caught *all* errors once after fixed 500ms; worse,
  `ytFetch` mapped HTTP 403-quota to status 502, so any status-based guard
  would still have retried it. New test reproduced 3 upstream attempts for one
  quota failure.
- Fix: `retryable:false` flag on the quota error (survives the 502 mapping);
  `isRetryable` honors it; new `ytFetchRetry` (≤2 retries, 400/1200ms +
  jitter) applies uniformly to `playlists`/`playlistItems`/`videos`.
  Test now: exactly 1 attempt, `retries=0`, 502 quota message preserved.

### D3. No API observability — FIXED (no defect, missing capability)
- Added `diagnostics/apiStats.ts` (method counts, quota-unit estimate, cache
  hits/misses/evictions, dedup hits, retries/failures, import/refresh counts;
  no keys/URLs/titles/user data) and merged it into `GET /api/cache`
  (additive; existing `{ok}` shape preserved). Evictions counted in cache.

### D4. Revision overdue used UTC date, XP double-awarded — VERIFIED BY TEST
- Causes: `today = toISOString().slice(0,10)` ignored the configured
  timezone; `rev:${pk}:${Date.now()}` made every click a new XP reward.
- Fixes: new `domain/revision/revision.ts` (`isRevisionOverdue` fail-closed
  on malformed input + `revisionFilterStatus`); screen uses
  `useDayTick(prefs.timezone)`; XP key `rev:${pk}:${todayKey}` (one reward per
  lesson per day). 11-test suite covers past/today/future/null/malformed.

### D5. React hook after early return (Dashboard, Revision) — INFERRED, FIXED
- `useDayTick` ran after `if (!snap) return` → hook-order violation whenever
  no playlist is active. Moved above the return in both files; audited all 8
  `useDayTick` call sites (Analytics/Competition/Efficiency/Focus/Goals/
  History were already safe). Verified by typecheck + suite (no runtime-hook
  test harness in repo).

### D6. Persist path had unhandled quota rejections — INFERRED, HARDENED
- 20 floating `kvSet` promises; a quota failure meant unhandled rejection and
  silence. Writer now awaits sequentially, stops at first failure, and emits
  one actionable backup notice. Live quota exhaustion: NOT VERIFIED
  (no browser-quota harness); primitives round-trip tested (below).

## 3. V5 leftovers closed

| Item | Result |
|---|---|
| Overnight/suspension refresh | Pure boundary logic tested (midnight tick slides window 1 day; resume recomputes from pure fn). Hook timing (30s + visibility/focus) inferred; overnight browser run not verified |
| Clock forward/back | End<start attributes full active time to start day, never negative — verified by test |
| Revision overdue | Verified by test (see D4) |
| Storage quota | Handling implemented + primitives tested; live exhaustion not verified |
| Multitab conflicts | Backend dedup verified by test (delayed-mock overlap); segment/XP dedup verified; cross-tab last-writer-wins documented as limitation |
| Large-playlist stress | N=1…1000 matrix (pre-existing) + new CSV-1000 and 1000-rival leaderboard tests |
| Real browser/responsive | NOT VERIFIED — no Playwright/eslint binaries in this env (confirmed via `node_modules/.bin` + `npm ls`); jsdom workflow tests pass |
| YouTube quota behavior | Verified by mocked test (see §5); live quota traffic never generated |

## 4. Time rules + independently verified examples

- UTC instants stored; display-tz grouping only; elapsed from timestamps;
  cross-midnight/DST splits via minute-walk (48h cap covers 25h days);
  pauses/breaks excluded at record time; dedup by segment id / XP dedupKey;
  history immutable; no mixed date-label systems (single `attributeFocusByDay`
  authority); ISO lexicographic compares for day/deadline boundaries.
- Worked story (hand arithmetic, asserted in `v6-reliability.test.ts`):
  day1 unique 300 / focus 900 = **33.33%**; day2 300/300 = **100%**;
  overall 600/1200 = **50%** (never the 66.67 mean); Arena mean = **66.67%**;
  canonical 60-in-180 = **33.33%**; attribution reconstructs {900, 300}.
- Efficiency invariant preserved: unique-only numerator, eligible-focus
  denominator, >100% possible, null on zero denominator, sim/user separation.

## 5. YouTube API: before/after counts (mocked upstream, MEASURED)

Baseline (pre-fix behavior, inferred from code + reproduced in tests):
navigation/reload already cost 0 (only Add/Refresh fetch — confirmed by
grep); Refresh cost 0 when cache fresh (D1 bug); quota failures cost 3
attempts (D2 bug, reproduced); concurrent identical imports cost N× (dedup
existed but unproven under overlap).

After (all measured in `backend/tests/api-efficiency.test.ts`):
- Import 100 (U=100): **5 upstream (1+2+2), 5 quota units**; repeat: **0 new**.
- Import 500: **21 upstream (1+10+10), 21 units**.
- Refresh: full revalidation cost, `cached:false`.
- 3× concurrent identical: **1 import's upstream, dedupHits≥1**.
- Quota 403: **1 attempt, 0 retries**, error preserved, cache unpoisoned.
- Transient 503 (videos): **2 attempts, 1 retry**, then 200.

Quota math (ESTIMATE from official per-method costs, not metered):
`playlists.list=1`, `playlistItems.list=1`, `videos.list=1` per call
(quota calculator; search=100 never used). Import cost =
`1 + ceil(N/50) + ceil(U/50)` units: N=100→**5**, N=500→**21**,
refresh=same, navigation/reload=**0**, quota-failure=**1 wasted**,
one retry=**+1**. At the published 10,000-unit default: ~2,000× 100-video
imports or ~476× 500-video imports/day. Project-specific quota may differ —
check Cloud Console; daily reset per Google docs.

Freshness policy (documented in UI + HOWTO): Add reuses valid cache
(`CACHE_TTL_SEC=600`, LRU 50 `CACHE_MAX_ENTRIES`); Refresh (`refresh=1`)
always revalidates; failures never poison cache; in-flight duplicates share
one upstream call. Conditional requests: deliberately NOT used (YouTube list
methods offer no documented ETag semantics for this workload).

## 6. Storage, concurrency, large playlists

- Architecture unchanged (justified): IndexedDB `learnquest-db` v2 single
  `kv` store + versioned JSON backups + bounded ephemeral backend cache; no
  database (no accounts/sync/server-history need). Measured sizes carried
  over from V5 (124 KB per 1000-video snapshot; 62 KB per 365 sessions;
  216 KB per 1000 segments).
- Concurrency: backend dedup verified; frontend id/XP dedup ledgers verified;
  debounced single writer; multitab last-writer-wins documented.
- Scale: N=1…1000 matrix passes; new 1000-row CSV + 1000-row leaderboard
  (20 pages @50) tests pass. Backend `MAX_ENTRIES=1000` enforced; 2000+
  rejection path not executed (stated).

## 7. Test / build results (actually run)

- Frontend **168/168** (15 files; +11 `v6-reliability`), backend **17/17**
  (4 files; +6 `api-efficiency`). `tsc --noEmit` clean both; `vite build` +
  backend `tsc` succeed. Lint: eslint NOT INSTALLED (reported, not claimed).
- Health: live `/api/health {ok:true,hasKey:true}` + `/api/cache
  {maxEntries:50}` (key never printed). No live YouTube traffic generated.
- `backend/.env` unchanged and git-ignored (verified via `git status`:
  no `.env` entry; only intended sources + 3 new test files + 2 V5 docs
  + new `diagnostics/` + `domain/revision/` + `dayTick` from before).

## 8. Files changed and why

- `backend/src/diagnostics/apiStats.ts` (new): sanitized counters.
- `backend/src/services/youtube/youtubeService.ts`: method-labelled
  instrumentation, `ytFetchRetry`, quota non-retry flag.
- `backend/src/schemas/playlistSchemas.ts`: `isRefreshRequested`.
- `backend/src/controllers/playlistController.ts`: refresh bypass,
  hit/miss/dedup/import accounting, success-only caching.
- `backend/src/routes/playlist.ts`, `backend/src/cache/memoryCache.ts`:
  stats exposure, eviction counting.
- `backend/tests/api-efficiency.test.ts` (new, 6 tests).
- `frontend/src/services/api/playlistApi.ts`: `{refresh}` option.
- `frontend/src/features/reports/Reports.tsx`: real refresh + fresh/cache copy.
- `frontend/src/domain/revision/revision.ts` (new) + `Revision.tsx`:
  tz-correct overdue, per-day XP dedup, hook order.
- `frontend/src/features/dashboard/Dashboard.tsx`: hook order.
- `frontend/src/app/store.tsx`: quota-safe persist writer + once-notice.
- `frontend/tests/v6-reliability.test.ts` (new, 11 tests).
- Docs: this file; `README`/`HOWTO`/V5-audit updates.

## 9. Unresolved / explicitly not claimed

Eslint + Playwright absent (no lint/browser runs); live quota metering and
2000+ stress not executed; overnight browser soak not run; storage-quota
live exhaustion not run; multitab end-to-end not run. Nothing above is
presented as tested beyond the evidence cited.
