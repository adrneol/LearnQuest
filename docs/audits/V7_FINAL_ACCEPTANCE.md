# V7 FINAL ACCEPTANCE — LearnQuest Product Verification

Date: 2026-10-13. Root: `E:\progressGameTracker`. Baseline: HEAD `49420ab`
(clean tree; V6 changes present as uncommitted work, preserved untouched).
Prior state: frontend 168 + backend 17 tests passing (V6, mocked-only).

Evidence codes: **[E2E]** real Chromium 25/25 (playwright-core 1.64.0 +
cached chromium-1248, isolated profile, production builds; script, fixture,
screenshots and `results.json` kept outside the repo at
`C:\Users\n0ne\AppData\Local\Temp\e2e\` to avoid polluting it)
· **[T]** automated suite (file cited) · **[M]** measured value
· **[I]** code inspection · **[NV]** not verified (stated, not claimed).

Verdicts: `PASS` · `FIXED AND VERIFIED` · `PARTIALLY VERIFIED` · `NOT APPLICABLE`.

## V7 defects found, reproduced, fixed

### V7-D1. Timezone picker button had no accessible name — FIXED AND VERIFIED
- Reproduction: real-browser E2E step 13 failed to find the picker by role
  (`Timeout 30000ms`); inspection showed the `<button>` carries no
  `aria-label` (name came only from dynamic city text).
- Fix: `aria-label={label}` (`TimezonePicker.tsx`); existing picker tests
  updated to assert the stable name (stronger, not weaker).
- Verified: [E2E] `timezone-change` PASS; [T] `ui-controls.test.tsx` 7/7.

### V7-D2. Sidebar nav clipped at 800px viewport height — FIXED AND VERIFIED
- Reproduction: E2E screenshot review showed Dashboard/Library rows clipped;
  probe measured nav content 672px vs 581px visible (`scrollTop 26`).
- Cause: row/group vertical budget exceeded common laptop heights.
- Fix: nav density (`space-y-4→2`, button `py-2→1.5`, header `py-3→2` +
  `min-h-0`) in `App.tsx`; design, rail, labels, tooltips unchanged.
- Verified: [M] re-probe: content 581 = visible 581, `scrollTop 0`, all 14
  destinations visible; graceful scroll retained for shorter viewports.

### V7-D3 (test-only). New-test assertion caught no defect; docs reconciled
- V6 §K asked which layer each dedup test covers: V5 `cache.test.ts` mocks
  the *service* with instant resolution (proves controller+cache integration
  yields 1 service call — overlap not forced); V6 `api-efficiency.test.ts`
  uses a 60ms-delayed HTTP mock (proves true in-flight overlap via
  `dedupHits≥1`). Both kept; layers now documented.

## Acceptance matrix

### A. Playlist management
| # | Outcome | Sources | Verdict / evidence |
|---|---|---|---|
| A1 | Import valid playlist | `Reports/Playlists → playlistApi → backend` | PASS [E2E] import-snapshot N=25 accepted; [T] api/contract |
| A2 | Reject invalid input usefully | `playlistId.ts` front+back, schemas | PASS [T] core/contract rejection cases |
| A3 | Add without corrupting others | `store.addSnapshot` keyed maps | PASS [E2E] dashboard N=25 post-import; [I] per-id scoping |
| A4 | Switch playlists, per-playlist state | `setActive`, filtered views | PASS [I]+[T] (switcher unit covered); E2E single-playlist only → PARTIALLY for multi-switch |
| A5 | Refresh gives fresh metadata | `refresh=1` bypass (V6) | PASS [T] api-efficiency 3→6 revalidation; [E2E] refresh-safe |
| A6 | Add reuses valid cache | controller TTL+LRU | PASS [T] repeat = 0 upstream, `cached:true` |
| A7 | Progress survives refresh | `diffSnapshots` + `needsReview` | PASS [E2E] module/completion intact after failed refresh; [I] boundaries preserved |
| A8 | Added/removed/reordered/duration-changed videos | `diffSnapshots`, `rangeStatus` | PASS [T] core diff tests; [I] needsReview flow |
| A9 | Unresolved videos consistent | `detectUnresolvedReason`, INCOMPLETE labels | PASS [T] contract unresolved; [E2E] labels render |
| A10 | Size limits enforced | `MAX_ENTRIES=1000` both ends | FIXED AND VERIFIED [T] new: 1050 rejected pre-batching, no videos.list spend |
| A11 | YT errors/quota/timeout/transient | `ytFetchRetry`, mapping | PASS [T] quota×1 no-retry, 503→retry→200, 400/404 passthrough |
| A12 | Sort/filter/search/pagination/positions | `sortEntries`, Library paging | PASS [T] scale N≤1000 + sort trap; [E2E] search/sort/0:12:40 |
| A13 | No cross-playlist leakage | per-`playlistId` keys everywhere | PASS [I] + [T] scoped aggregates |

### B. Playback & completion
| # | Outcome | Sources | Verdict / evidence |
|---|---|---|---|
| B1 | Domain: union/repeat/seek/buffer/dedup rules | `playback.ts` | PASS [T] v2/efficiency-path hand-verified stories |
| B2 | Manual vs verified completion + thresholds | `completionFromCoverage`, Player/Library | PASS [T] v2 thresholds; [E2E] manual mark + distinct labelling |
| B3 | Live play/pause/buffer/seek/end wiring | `Player.tsx` IFrame handlers | PARTIALLY VERIFIED: renders + manual controls [E2E]; timed playback events not exercised in browser [NV] |
| B4 | Reload during playback ends verification honestly | Player cleanup/finalize | PARTIALLY VERIFIED [I] + domain tests; live-interruption run [NV] |
| B5 | Unknown/zero/changed/short/unresolved durations | completion states | PASS [T] unavailable/todo paths |
| B6 | Rewatch never inflates unique/progress/XP | union + dedup ledgers | PASS [T] rewatch/duplicate cases |

### C. Focus timer
| # | Outcome | Sources | Verdict / evidence |
|---|---|---|---|
| C1 | Start→pause→resume→pause→finish→review | `Focus.tsx` + `store.addSession` | PASS [E2E] 12s session recorded + listed; [T] attribution |
| C2 | Reset/restart, rapid clicks | idempotent Start, working Resume, Reset clears base | PASS [E2E] controls operate; [I] no double-count path |
| C3 | Refresh/nav mid-session | in-memory timer (documented lossy) | PARTIALLY VERIFIED [I]; honest policy stated in UI |
| C4 | Throttling/sleep/close mid-session | timestamp deltas; no invented time | PARTIALLY VERIFIED [I]; live sleep run [NV] |
| C5 | Midnight/tz/DST/clock/old-session | interval attribution + day tick | PASS [T] split/proportional/DST cases; browser midnight [NV] |
| C6 | Manual correction, <10s rule, invalid input | accumulator + discard | PASS [E2Eimplicit] + [I]; negative edge discards |
| C7 | Persistence/dedup/day attribution; display≡record≡analytics | shared `attributeFocusByDay` | PASS [T] cross-screen story reconstructs {900,300} |
| C8 | Clock anomaly creates no giant/lost durations | end<start → start-day honest share | FIXED AND VERIFIED (V6, re-asserted) [T] |

### D. Time, calendar, timezone, live updates
| # | Outcome | Sources | Verdict / evidence |
|---|---|---|---|
| D1–D3 | Midnight open/hidden; return after hours/days | `useDayTick` (30s + visibility/focus) | PARTIALLY VERIFIED: boundary math [T] + [E2E] tz-reselect recompute; overnight soak [NV] |
| D4 | Timezone change regroups, never rewrites UTC | all screens via shared helpers | PASS [E2E] Kolkata switch clean; [T] total-invariant per tz |
| D5 | Visibility/focus refresh | listeners in `dayTick` | PARTIALLY VERIFIED [I]; hidden-tab midnight [NV] |
| D6 | DST 23h/25h, month/year/leap/New-Year | splitter + calendar stepping | PASS [T] 82,800/90,000s, London windows, leap/year cases |
| D7 | Clock forward/back | honest attribution | PASS [T]; live clock-change [NV] |
| D8 | Sleep/resume | same mechanism as D1 | PARTIALLY VERIFIED [I]; live run [NV] |
| D9 | No stale derived state | memos keyed on inputs + day tick | PASS [I] all 8 screens; [E2E] post-tz values refresh |
| D10 | No `86400000`-chain calendar math remains | repo-wide search (V5) + `calendarWindowDates` | PASS [T] consecutiveness across transitions |

### E. Revisions — PASS (V6 fix re-verified)
Create/flag from Player+Library+screen; upcoming/due/overdue via tz day;
filters (incl. overdue fail-closed on malformed); Mark revised clears flag,
records review, per-day XP dedup; reschedule via date input; reload-safe
([E2E] queued + completed); deleted entries simply drop from queue [I].
[E2E] revision-queue + revision-complete; [T] v6-reliability (11).

### F. Checkpoints/modules/ranges — PASS
CRUD/rename/reorder/validation all operate on real store state ([E2E]
module + checkpoint created, progress 1-done reflected); `needsReview` on
shrink; empty-state guides; playlist isolation [I]; overlap permitted as
independent ranges [I]; progress from lesson records; unresolved counted,
not credited. [E2E] + [T] modules/range suites.

### G. Goals/streaks/XP/achievements — PARTIALLY VERIFIED
Daily + flex goal math, missed/paused, XP dedup ledger, achievement
conditions: PASS [T] v2/core. Streak/tz/midnight: PASS [T]. Arena reset
isolation: PASS [I] (`rankHistory` only). UI creation/edit flows: goals tab
renders [E2E] but creation clicks untested in browser; achievement toast
untriggered in E2E (needs multi-video effort) → creation/celebration rows
PARTIALLY VERIFIED, rules PASS.

### H. Arena — PASS (rules frozen, V6 behavior re-verified)
Setup/caps/distribution/seed/window controls operate; exact-date window
label; provisional UX ([E2E] with 1 eligible day); efficiency-only ranking
copy ([E2E]); determinism/ties/pagination/eligibility [T] arena/fair suites;
snapshots append-only + reset isolation [I]; new-day/tz via shared window
dates [T]. Competitive (3-day) establishment shown in browser: PARTIALLY
(E2E covered provisional only; scoring [T]-verified).

### I. Analytics/efficiency/dashboard/history/reports — PASS
Efficiency invariant byte-identical to V6 (aggregate vs mean asserted [T]);
screens render with real E2E data ([E2E] inspect-tabs); chart separation +
first/last ticks [T] + measured 0px overflow at 6 widths [M/E2E];
filters/sort/ranges/pagination [T+E2E]; empty states render [E2E new-user];
CSV identities/values [T] (1000-row); backup download reachable [E2E],
content round-trip [T] kv + validation; post-edit/tz/refresh consistency
[E2E]; metadata refresh preserves progress [E2E].

### J. Persistence — PASS with stated limits
First launch (empty) [E2E]; reload survival [E2E]; per-key transitions +
backup validation [T]; malformed/duplicate-position rejection [T];
quota-safe writer + once-notice [I] (live exhaustion [NV]); repeated restore
idempotent by replace-semantics [I]; large histories measured (V5 sizes);
multitab last-writer-wins documented limitation [I] (single-tab product).

### K. API/backend — PASS
V6 behaviors re-run green (17→18/18 with new cap test): cache reuse,
real refresh, overlap dedup, quota no-retry, bounded retries, success-only
caching, TTL+LRU-50, zero-cost navigation, sanitized stats (verified no
key/URL/title in `/api/cache` test). Rate limiting + validation active [T].
`/api/cache` disclosure reviewed: counts/estimates only — appropriate for
this self-hosted single-user backend; no restriction change warranted [I].

### L. UI/usability — PASS with two fixes
All nav destinations reachable [E2E]; dropdowns/forms/filters/sort/paging
operate [E2E+T]; player/manual controls operate [E2E]; focus controls [E2E];
goals/checkpoints/modules/revision [E2E]; reports/history/analytics/
efficiency render [E2E]; arena config [E2E]; settings/tz/motion [E2E];
export/import/backup/restore reachable + validated [E2E+T]; loading/empty/
error/retry states observed (onboarding/import-error/refresh-error/provisional)
[E2E]; sidebar collapse + drawer + hash routing [T] (+ density fix [M]);
keyboard: picker/dialog/drawer Escape paths [T+E2E]; focus-visible styling
[I]; layouts 360/375/768/1024/1440/1920 with 0px overflow [M/E2E] +
screenshots reviewed (360 mobile, 1440 desktop); long titles truncate [I];
slow-backend: Refresh loading state + graceful error [E2E].

## E2E evidence (real Chromium, production builds)
`25/25 passed` — open, import N=25, dashboard `1:15:00`, range `0:12:40`,
manual complete, ~12s focus session, module, checkpoint, goals render,
revision queue+complete, arena provisional + basis copy, 3 inspect tabs,
reports, reload persistence, Kolkata switch, failed-refresh safety, 6
widths 0-overflow, zero unexpected console errors (1 handled upstream-404
from the deliberate fake-id refresh, tracked separately). Screenshots:
`shot-{360,375,768,1024,1440,1920}.png`. Live YouTube traffic: exactly one
`playlists.list` 404 from the refresh-error step (~1 unit, intentional).

## Quality gates (actually run)
- Frontend 168/168 (15 files), backend 18/18 (4 files). `tsc` clean both.
  `vite build` + backend `tsc` succeed. Lint: eslint absent (reported).
- `backend/.env` unchanged, git-ignored; bundle has 0 `AIza`; diff scoped
  (V6 set + `TimezonePicker` label, sidebar density, picker-test update).
- No tests weakened (picker selector strengthened to the a11y contract);
  no tests deleted or skipped.

## Files changed in V7 (why)
- `TimezonePicker.tsx`: accessible button name (E2E-found).
- `App.tsx`: sidebar density so all nav fits 800px heights (probe-measured).
- `tests/ui-controls.test.tsx`: picker selectors match a11y contract.
- `backend/tests/api-efficiency.test.ts`: >1000-entry rejection test.
- This doc + README/HOWTO deltas below.

## Outstanding (genuine, with next actions)
1. Live timed-playback event coverage (play/pause/seek/buffer/end in
   browser) — needs scripted YT interaction; impact: event wiring below
   player verified by domain tests + render verified; next: Playwright YT
   playback script on staging.
2. Overnight/browser-sleep/clock-change/soak runs — needs long-lived or
   clock-mocking browser harness; pure logic tested.
3. Live quota exhaustion + 2000+ stress — needs staging project; mocks tested.
4. Goal-creation/celebration clicks + competitive-rank establishment in
   browser — needs scripted multi-day seeding; rules unit-tested.
5. Multi-tab E2E + live storage-quota run — needs two-context harness +
   quota-override CDP; primitives tested, limitation documented.
