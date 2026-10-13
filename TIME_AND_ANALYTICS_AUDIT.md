# TIME AND ANALYTICS AUDIT — LearnQuest V5

Date: 2026-10-13. Codebase: `frontend/` (React+Vite+TS) + `backend/` (Node+Express).
Prior state: 115 frontend + 6 backend tests passing; known limitation that
challenge windows used `Date.now() - n * 86400000` chains.

Status definitions: **PASS** (inspected + tested) · **FIXED AND VERIFIED**
(defect reproduced, fixed, regression-tested) · **PARTIALLY VERIFIED**
(evidence for main paths, edge remains untested) · **NOT VERIFIED** (no
evidence) · **NOT APPLICABLE** (feature does not use that behavior).

Core invariant (unchanged): real events are stored as **UTC instants**
(ISO strings / epoch ms). The selected IANA timezone affects **grouping and
display only** — it never rewrites stored timestamps. Absolute durations come
from real timestamps; calendar sequences come from calendar arithmetic.

## What changed in V5

1. `frontend/src/domain/time/time.ts`: added `addDaysToDateKey`,
   `calendarWindowDates` (DST-safe: resolve today's local date, then step by
   calendar days), `attributeFocusByDay` / `focusOnDay` /
   `activeFocusDayKeys` (single authoritative focus attribution via
   `splitIntervalByDay`), and raised the splitter cap 24h → 48h so 25-hour
   fall-back days are not truncated.
2. `frontend/src/domain/competition/competition.ts`: `challengeWindowDates`
   now delegates to `calendarWindowDates`.
3. New `frontend/src/app/dayTick.ts` `useDayTick(timezone)`: 30s check +
   `visibilitychange`/`focus` listeners; returns today's key and re-renders on
   day change. Wired into Competition, Dashboard, Efficiency, Focus, Goals,
   Analytics, History.
4. Focus attribution unified: Competition, Dashboard, Efficiency, Focus,
   store achievements, and History now share interval-split attribution
   instead of mixing stored `dateKey` labels with timestamp splits.
5. Focus timer fixes: idempotent Start, working Resume, per-session
   `elapsedBase` (previously fixed at mount, inflating `elapsedSec`), Reset
   clears the base.
6. Focus `WeeklyReview` week window and video/checkpoint counts are now
   calendar-correct in the display timezone (previously a UTC slice).
7. Analytics week windows use calendar arithmetic; History presets use
   `addDaysToDateKey`; Goals `today` refreshes at midnight.

## Verification matrix (time-dependent features)

| # | Feature (file/function) | Source data / format | TZ assumption | Rule | Tests | Verdict |
|---|---|---|---|---|---|---|
| 1 | Playback timestamps, intervals (`domain/playback`, `Player.tsx`) | `wallStartMs/wallEndMs` epoch ms UTC; `timelineStart/EndSec` video seconds | tz presentation-only | interval union for unique; repeats add to totals only; seeks/buffer excluded | `v2.test.ts`, `efficiency-path.test.ts` | **PASS** |
| 2 | Focus start/pause/resume/finish (`Focus.tsx`, `store.addSession`) | `startedAt/finishedAt` ISO UTC; `activeSec` int | tz for `dateKey` label only | timestamp-based accumulation; <10s discarded; finish never completes videos | code inspection + new attribution tests; no automated UI timer test | **PARTIALLY VERIFIED** (lifecycle logic inspected; sleep/throttle paths reasoned, not browser-tested) |
| 3 | Session elapsed vs active (`Focus.tsx`) | same instants | none | `activeSec` recorded; `elapsedSec` informational | inspection | **PASS** (elapsedBase bug fixed; `elapsedSec` unused by reports) |
| 4 | Manual correction (`Focus.tsx`) | minutes input | none | applied to accumulator on finish | inspection | **PASS** (negative edge discards via <10s rule) |
| 5 | Refresh/close/suspend during session (`Player.tsx`, `Focus.tsx`) | in-memory open segment | n/a | refresh ends verification, no background credit | existing playback tests (dedup/seek/thresholds) | **PARTIALLY VERIFIED** (documented behavior; no live-interruption test) |
| 6 | Completion timestamps (`progress.*.completedAt`, `verifiedAt`) | ISO UTC | tz for display | threshold on unique/duration; manual labelled | `v2.test.ts` | **PASS** |
| 7 | Daily goals (`Goals.tsx`, `goals.ts`, `store.goalCurrentValue`) | `dateKey` YYYY-MM-DD deadline in selected tz | tz reset | achieved only on condition; `todayKey > dateKey` → missed | `v2.test.ts` (status transitions) | **PASS** |
| 8 | Streaks (`time.computeStreak`, Dashboard, store) | attributed active days | selected tz | consecutive local days; today-or-yesterday start; gaps break | `time-correctness.test.ts` (split streak, gaps) | **FIXED AND VERIFIED** (was stored-label based; now interval-attributed) |
| 9 | Daily summaries (`Efficiency`, Dashboard, Focus, History) | segments (UTC) + sessions (UTC) | selected tz day boundaries | cross-midnight split via `splitIntervalByDay`; sums reconstructible | `time-correctness.test.ts`, `efficiency-path.test.ts` | **FIXED AND VERIFIED** |
| 10 | Weekly review (`Focus.last7`, `WeeklyReview`, `Analytics wk`) | same | selected tz | 7 calendar days incl. partial today; calendar arithmetic | `time-correctness.test.ts` (window consecutiveness) | **FIXED AND VERIFIED** (was 24h-step + UTC slice; now `calendarWindowDates`) |
| 11 | Monthly reports (`History` month preset) | dateKeys | selected tz | `YYYY-MM-01` → today | inspection + `addDaysToDateKey` tests | **PASS** |
| 12 | Custom ranges (`History` customA/B) | YYYY-MM-DD compare | none (lexicographic = chronological for ISO) | inclusive, ordered | inspection | **PASS** |
| 13 | Overall efficiency (`efficiency.ts`, `Efficiency.tsx`) | aggregate unique / focused | n/a (ratio) | aggregate ratio, never mean of dailies; null on zero denominator | `v2.test.ts`, `efficiency-path.test.ts` | **PASS** |
| 14 | Daily efficiency (`eligibleDailyEfficiencies`) | per-day unique / focus | tz boundaries by caller | zero-focus days excluded, never fabricated | same + `time-correctness` | **PASS** |
| 15 | Arena dates/activity (`competition.ts`, `Competition.tsx`) | anchor calendar keys + seeded PRNG | selected tz | per-date seeding; focus→eff→content capped by remainder | `arena.test.ts`, `fair-efficiency.test.ts`, `time-correctness.test.ts` | **FIXED AND VERIFIED** (calendar-safe windows; 25h-day splitter fix) |
| 16 | Arena eligible days / windows / ranks / snapshots | daily effs; `requiredEligibleDays`; `rankBoard`; `rankHistory[]` | selected tz | ≥3d windows need 3; shorter 1/day; provisional unranked; snapshots append-only | `arena.test.ts`, `fair-efficiency.test.ts` | **PASS** |
| 17 | Revision dates/overdue (`Revision.tsx`, `progress.revisionDate`) | `YYYY-MM-DD` vs `today` string | display tz date | `revisionDate < today` → overdue; reschedule via date input; `Mark revised` clears flag + records review | inspection (no date-logic unit test) | **PARTIALLY VERIFIED** (string compare correct for ISO; no dedicated test) |
| 18 | Achievements/XP (`gamification.ts`, store effects) | event ISOs; `dedupKey` ledger | tz for day counts only | evaluated from records; deduped; Arena reset touches `rankHistory` only | `core.test.ts` (evaluateAchievements), `v2.test.ts` | **PASS** |
| 19 | Exports (`Reports.tsx`, `playlistApi.snapshotToCsv`, `toCsv`) | ISO passthrough; computed totals via domain engine | none | timestamps unmodified; totals reuse engine | inspection | **PASS** |
| 20 | Chart axes/labels/tooltips (`theme.positionTicks`, chart components) | playlist positions / UTC instants | tz for day labels | first+last ticks always; units in titles; exact tooltips | `charts.test.tsx`, `scale.test.ts`, `fair-efficiency.test.ts` | **PASS** |
| 21 | Persistence timestamps (`db.ts` kv store; import/export) | ISO strings preserved verbatim | none | additive v2 migration; backup v2 restores v1 | `ui-controls.test.tsx` (seeded IndexedDB), inspection | **PARTIALLY VERIFIED** (no automated migration-fixture test) |
| 22 | Refresh/rollover (`dayTick.ts` + per-screen wiring) | `dateKeyInTimezone(now, tz)` | selected tz | 30s check + visibility/focus; recompute on key change; UTC history untouched | code inspection; unit-tested helpers, hook behavior reasoned | **PARTIALLY VERIFIED** (no overnight browser test) |
| 23 | DST transitions (23h/25h days, ambiguous hours) | absolute instants | IANA via Intl | minute-walk splitter; calendar stepping for windows | `timezones.test.ts` + `time-correctness.test.ts` (NY Mar 8 82,800s; Nov 1 90,000s; London windows) | **FIXED AND VERIFIED** (24h-cap defect found and fixed by the new test) |
| 24 | Leap days / month / year boundaries | calendar keys | n/a | `addDaysToDateKey` UTC-date stepping | `time-correctness.test.ts` | **PASS** |
| 25 | System-clock change during timing | `Date.now()` deltas | n/a | timestamp deltas; interruptions honest (no invented coverage) | inspection only | **NOT VERIFIED** (requires manual clock-change test) |
| 26 | Weekly/monthly goal periods | n/a — product has daily + open-ended flex goals only | — | — | — | **NOT APPLICABLE** (no weekly/monthly goal engine exists) |
| 27 | Notifications/reminders scheduling | n/a — toasts/dialogs only | — | — | — | **NOT APPLICABLE** (no scheduler exists) |

## Defects found and fixed (all regression-tested unless noted)

1. **Fixed-step calendar windows** (`competition`, Dashboard, Efficiency,
   Focus, Analytics): `Date.now() - n*86400000` replaced by
   `calendarWindowDates`. Verified by DST window tests.
2. **25-hour DST days truncated**: `splitIntervalByDay` 24h cap cut fall-back
   days to 86,400s. Reproduced by new test (got 86400, expected 90000); cap
   raised to 48h; test now passes. Spring 23h (82,800s) was already correct.
3. **Focus attribution inconsistency**: screens mixed stored `dateKey` labels
   with timestamp splits, so cross-midnight sessions and timezone changes
   diverged. Unified on `attributeFocusByDay`. Verified by attribution tests.
4. **Streak/achievements on stored labels**: same cause; now
   `activeFocusDayKeys`. Verified by split-session streak test.
5. **Focus `elapsedBase` never reset**: `elapsedSec` grew since mount. Now
   per-session. Verified by inspection (field unused by reports).
6. **Focus Resume mislabeled/dead** (`Resume state saved` called `pause()`):
   replaced with working Start/Resume/Pause. Inspection-verified.
7. **WeeklyReview UTC week** (`toISOString().slice` + string compare on
   `completedAt`): replaced with tz calendar keys + `dateKeyInTimezone`
   comparison. Verified by inspection; counts covered by existing goal/progress tests.
8. **Midnight-stale views**: added `useDayTick` + wiring. Helper logic tested;
   overnight browser behavior NOT VERIFIED (stated, not claimed).

## Remaining uncertainty (explicitly not claimed)

- Overnight open-tab refresh, device-sleep resume, and system-clock changes:
  mechanism implemented and reasoned, but no live browser test in this
  environment.
- Revision overdue and import/migration paths: inspected, no dedicated
  automated test.
- Player interruption recovery beyond documented "refresh ends verification".

## Test evidence

- Frontend: **157/157** (`time-correctness` 12, `scale` 30 incl. N=1…1000
  matrix, plus all pre-existing suites). Backend: **11/11**.
- `tsc --noEmit` clean both workspaces; `vite build` + backend `tsc` build
  succeed; live `GET /api/health → {ok:true, hasKey:true}` (key never printed).
- No browser automation available here: no screenshots claimed; UI covered by
  jsdom workflow tests.
