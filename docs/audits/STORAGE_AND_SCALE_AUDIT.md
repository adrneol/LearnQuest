# STORAGE AND SCALE AUDIT — LearnQuest V5

Date: 2026-10-13. Measured on this machine (Windows, Node 20+); figures are
recorded alongside the method so they can be re-run. Estimates are labelled
as estimates.

## 1. Where each data type lives (verified by inspection)

| Data | Location | Growth | Persistence | Recommendation |
|---|---|---|---|---|
| YouTube metadata snapshots | Browser IndexedDB `learnquest-db` key `playlists` (full snapshot per playlist: entries with `durationSec` int or null) + backend ephemeral TTL+LRU cache (ISO only) | Linear: **~123 bytes/entry** measured (N=1000 → 123,667 B) | Survives restart; `Clear cached metadata` drops snapshots only; refresh preserves progress, flags out-of-range items `needsReview` | Keep. No duplication found (one snapshot per playlist; positions canonical) |
| Completion state | IndexedDB `progress` map `playlistId::position` → record (ISO `completedAt`, `source`, flags) | ~1 small record per touched video | Preserved across refresh/restart/import; checkbox = manual, player = verified | Keep |
| Playback segments | IndexedDB `segments[]` (UTC ms walls + timeline secs + source) | **~215 B/segment** measured; 1000 segs ≈ 216 KB | Appended with id-dedup (`summarizeSegments` ignores repeat ids); whole-array persist per batch (see §3) | Keep; coalescing unnecessary at this scale (union computed on read) |
| Focus sessions | IndexedDB `sessions[]` | **~169 B/session** measured; 365 daily sessions ≈ 62 KB | Debounced persist; <10s discarded; delete supported | Keep |
| Modules/checkpoints/ranges | IndexedDB `modules[]`, `checkpoints[]`, `ranges[]` | Tiny (position arrays) | Preserved; playlist shrink flags `needsReview`, never rewrites | Keep |
| Goals/achievements/XP | IndexedDB `goals`, `flexGoals[]`, `achievements`, `xp[]` (dedupKey ledger) | Tiny | Survive restart; Arena reset does not touch | Keep |
| Arena simulation | **Derived, not stored**: regenerated deterministically from seed+settings+window dates; only `challenge` config + `rankHistory[]` snapshots persisted | O(1) storage | Reset clears snapshots only; never real history | Keep (correct separation) |
| Backend cache | Node `Map` in `memoryCache.ts`: TTL (default 600s) + **LRU cap (default 50 playlists, `CACHE_MAX_ENTRIES`)** + in-flight dedup | Bounded by construction (see §4) | Ephemeral by design; spin-down safe (frontend re-fetches or imports JSON) | Keep; no database justified (§6) |

IndexedDB: database `learnquest-db`, version **2**, single object store `kv`
(key-value; no indexes). Keys: `playlists, meta, activeId, progress, ranges,
checkpoints, modules, sessions, goals, xp, achievements, prefs, segments,
playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory,
settings`. Migration: v2 additive (new keys only; v1 keys untouched); backup
JSON v2 restores v1 (missing keys skipped). No timestamp migration exists or
is needed (ISOs stored verbatim).

## 2. Persistence guarantees (tested where stated)

- Refresh/restart: store hydrates all keys before `ready`; UI workflow tests
  seed IndexedDB and read back (`ui-controls.test.tsx`). PASS (jsdom-level).
- Stale-state overwrite: single debounced (300ms) writer; per-key `kvSet`.
  No concurrent-tab protocol — last writer wins across tabs (documented
  limitation, not a defect for single-tab personal use).
- Playlist switch: per-`playlistId` scoping everywhere; activeId only selects.
- Arena reset: `resetChallenge()` clears `rankHistory` only (inspected).
- Playlist refresh: `diffSnapshots` + `needsReview` flags; original boundaries
  preserved (inspected).
- Export/restore: versioned JSON round-trips all keys; CSVs carry
  playlist/position identity (inspected).
- Quota failure: **NOT VERIFIED** — no quota-exhaustion test; browsers evict
  only under storage pressure. Recommended future test, not a current defect.

## 3. Growth behavior (measured)

- Snapshot: N=139 → 17,020 B; N=500 → 61,744 B; N=1000 → 123,667 B
  (≈123 B/entry, linear — no per-video metadata duplication).
- One year of daily focus sessions ≈ 62 KB; 1000 playback segments ≈ 216 KB.
  A heavy personal year is well under 1 MB.
- Write pattern note: `addSegments` persists the whole `segments` array per
  batch (O(n) write). At measured sizes this is negligible (sub-ms
  serialization); revisit only if histories exceed ~100k segments.
- No per-render derived objects are retained; charts/memos recompute from
  source records (memoized per input, invalidated on input/timezone/day change).

## 4. Backend memory (measured, `backend/tests/cache.test.ts`)

- Method: synthetic snapshots (realistic titles) pushed through the real
  `createMemoryCache`; `process.memoryUsage()` before/after 1/139/500/1000.
- Result: heap **16.4 → 16.7 MB** (+0.3 MB across all four snapshots); RSS
  flat at **76.5 MB**. Growth is linear and tiny.
- Policy (implemented in V5): TTL 600s (`CACHE_TTL_SEC`) + LRU cap 50
  (`CACHE_MAX_ENTRIES`, new; also in `render.yaml` + `.env.example`) +
  in-flight request dedup (concurrent identical fetches share one upstream
  call — tested with 3 concurrent requests → 1 fetch). Eviction tested
  (LRU order + TTL expiry). `/api/cache` now returns `{ok, entries,
  approxBytes, maxEntries}` (counts only — never contents or keys).
- Peak vs steady-state: measured values are steady-state in-test; no
  long-lived timers/listeners accumulate (inspected: no intervals in backend;
  rate-limit state is fixed-window per IP via `express-rate-limit`).
- Frontend request discipline (inspected): chart/range/filter/sort/report
  interactions never refetch; only Add/Refresh hit `/api/playlist`, served
  from cache when fresh. No redundant-transfer defect found.

## 5. Frontend performance (measured, `frontend/tests/scale.test.ts`, N=1000)

- filter 1.5ms · sort 4.4ms · full-range total 0.8ms · 1000-point cumulative
  build 0.9ms (dev machine; budgets in-test are generous rails: 500/500/500/1000ms).
- Tables paginate (Library 25/page; Reports/History bounded scrolls;
  leaderboard 25/50/100) and sort/filter run on the full collection before
  pagination (inspected). No virtualization — justified: measured costs are
  single-digit ms; virtualization would add interaction risk for no needed gain.
- Charts plot every entry; only tick labels thin (`positionTicks`, first+last
  always). Verified N=1…1000 plus endpoints 103/139.

## 6. Playlist-size matrix (tested `scale.test.ts` + existing suites)

| N | Sum | Ranges | Sort+positions | Chart endpoints | Pages |
|---|---|---|---|---|---|
| 1/25/103/139/200/500/1000 | PASS (exact vs plain-loop expected, unresolved flagged) | PASS (1–N valid; N+1/0 rejected) | PASS (numeric desc, unresolved last, positions permuted 1..N) | PASS (ticks start 1 end N; dataset length N) | PASS (25/page covers all; 1000→40 pages) |

Backend cap `MAX_ENTRIES = 1000` (frontend mirrors): 2000+ is rejected with a
clear error (inspected in `youtubeService.ts` guard + `parsePlaylistId`).
2,000-entry stress: **NOT VERIFIED** by execution (cap makes it a rejection
path, not a render path) — documented, not claimed.

Layout widths 320–1920: no automated browser run in this environment (stated);
by construction: `min-w-0` chart/grid cells, `overflow-x-clip` main, paginated
tables, portal dropdowns. Zero-overflow is **NOT VERIFIED** here (prior report
cited headless-Chromium checks with tooling not present in this repo).

## 7. Database decision (evidence-based)

1. IndexedDB appropriate for personal history? **Yes** — sub-MB measured
   growth, synchronous-feeling local reads, no account/sync requirement.
2. Unnecessary duplication? **No** — one snapshot per playlist, one record per
   progress key, deduped segments, derived sim.
3. Representative sizes? §3 above (all measured).
4. Playback over months? Linear ~215 B/segment; 10k segments ≈ 2 MB — fine.
5. Backend cache bounded? **Yes since V5** (TTL + LRU 50 + dedup + stats).
6. RAM at 500/1000 entries? +0.3 MB heap total in-test; RSS flat.
7. Concurrent/refresh behavior? Dedup tested; cache-hit refresh avoids refetch.
8. Frontend cost at 500 entries? Interpolated from N=1000 figures: <5ms per op.
9. Daily/time correctness? See [TIME_AND_ANALYTICS_AUDIT.md](./TIME_AND_ANALYTICS_AUDIT.md) (2 fixed, rest pass/partial).
10. Charts at large N? Verified to 1000 by test.
11. Separate database required? **No.** No accounts, no cross-device sync, no
    server-side user history, no durable server need; cache is ephemeral by
    design and spin-down safe.
12. Simplest reliable architecture? **Keep exactly this**: IndexedDB for
    personal records + versioned JSON backups; bounded ephemeral backend cache
    for public metadata; no backend filesystem reliance (Render free is
    ephemeral — correctly, nothing essential lives there).

## 8. Render free fitness (measured, not promised)

- Footprint (in-test): ~17 MB heap, ~77 MB RSS with four cached playlists —
  an order of magnitude inside 512 MB / 0.1 CPU for metadata proxying.
- Operational notes: free spin-down only adds cold-start latency; no data at
  risk (browser-local persistence independent of backend restarts).
- Official docs were consulted for plan limits (compute/free/disks); the
  verdict above rests on the measured code paths, not on entry counts alone.
- **NOT VERIFIED**: sustained concurrent-user soak, cold-start latency, and
  real-quota YouTube traffic — requires staging observation, stated openly.
