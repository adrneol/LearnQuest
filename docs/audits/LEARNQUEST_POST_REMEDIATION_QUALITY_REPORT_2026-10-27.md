# LearnQuest Post-Remediation Quality Report (Second Pass)

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `d9f3dc721b534728f3ff7ce76b4325ceebd5691b` (`finally`, 2026-10-14)  
**Scope:** Second-pass verification of the prior remediation, plus Player, Revision, History, Efficiency, Focus, cross-feature consistency, additional bug-hunt findings, regression tests, and full validation gates.  
**Working tree:** Intentionally uncommitted. No commit, push, branch change, reset, clean, stash, or destructive checkout was performed.

---

## 1. Executive summary

The second pass is complete for the requested implementation scope. The four main usability gaps were reproduced, fixed, and covered by regression tests:

| Area | Result | Main change |
|---|---|---|
| Player learning-record editor | **Fixed** | Full annotation editor for the exact playlist occurrence, with debounced autosave, flush-on-navigation, validation, review status, and review history. |
| Revision persistence and discovery | **Fixed** | Active queue is separated from all lessons; reviewed lessons remain searchable and editable; review history is append-only and same-day idempotent. |
| History presentation | **Fixed** | Human-readable durations, labelled evidence splits, true-empty states, range-consistent statistics, and out-of-range manual-entry feedback. |
| Efficiency mathematics/UX | **Fixed** | Evidence filtering now applies to both numerator and denominator; >100% ratios are reported rather than hidden; formulas and edge cases are explained. |
| Focus workflows | **Fixed** | Recovery excludes closed-tab time from elapsed/paused time, notes/corrections survive reload, duplicate Finish is blocked, and telemetry is attributed to the occurrence that opened the segment. |
| Cross-feature consistency | **Fixed** | Verified/self-reported/observed/estimated labels agree across Player, Revision, History, Efficiency, Focus, Analytics, and backup validation. |

Additional defects found during the pass were fixed: pending Player annotations could flush onto the next entry, playback segments could be misattributed after navigation, Focus notes/manual corrections could be lost, same-day reviews could duplicate history/XP, and backup validation did not understand review history.

Final measured gates:

| Gate | Result |
|---|---|
| Frontend tests | **250 / 250 passed** (29 files) |
| Backend tests | **26 / 26 passed** (6 files) |
| Frontend typecheck | **Passed** |
| Backend typecheck | **Passed** |
| Frontend lint | **0 errors / 4 warnings** |
| Backend lint | **0 errors / 8 warnings** |
| Frontend production build | **Passed**; largest chunk 385.17 kB (gzip 106.41 kB), no >500 kB warning |
| Backend production build | **Passed** |
| Production dependency audits | **0 vulnerabilities** in both packages |
| Full dependency audits | 6 dev-toolchain advisories in each package (Vitest/Vite chain); no production exposure |

No test was skipped, weakened, or suppressed. The frontend suite grew from the confirmed baseline of 226 to 250 tests; the backend remained at 26.

No `.env` file was created or modified. The only `.env` on disk is the pre-existing ignored `backend/.env` (last written 2026-10-13); it was not read or changed. The pre-existing `backend/.env.example` and `render.yaml` modifications were left intact.

The important limitations are disclosed in §14: no real browser, screen reader, mobile device, or live YouTube verification was possible in this environment, and the dev-only Vitest/Vite advisories were not force-upgraded because the available fix is a breaking major release.

---

## 2. Current repository baseline and diff summary

### Repository state

- Branch `main`, HEAD `d9f3dc7`; no branch or commit operation was performed.
- The working tree already contained the first-pass implementation changes and three untracked prompt files:
  - `learnquest-audit-prompt.txt`
  - `learnquest-fix-prompt.txt`
  - `learnquest-quality-pass-2.txt`
- The prior report, `docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md`, was preserved unchanged.
- No real IndexedDB database was read, cleared, migrated, or manipulated. All migration, restore, and persistence tests used `fake-indexeddb` with isolated per-test keys.
- No `.env` file was created, modified, or printed.

### Baseline before this pass

| Check | Baseline |
|---|---|
| Frontend tests | **226 / 226 passed** (23 files) |
| Backend tests | **26 / 26 passed** (6 files) |
| Typechecks | Clean |
| Working tree | First-pass changes uncommitted; prompt files and prior report untracked |

### Current diff summary

- **51 tracked files modified**, **6,351 insertions**, **975 deletions** versus HEAD.
- **29 untracked files**: 25 source/test/config files, 3 prompt files, 1 prior report.
- The untracked source files include the new shared annotation UI, Player learning-record editor, focus domain, backup validator, identity helpers, settings validation, and the second-pass test suites.
- The current test suite is **250 / 250** across **29 files**.
- The current backend suite is **26 / 26** across **6 files**.

The diff is intentionally broad because it contains both the first-pass and second-pass work. This report attributes only the second-pass-relevant changes; it does not claim that every line of the working tree was authored in this pass.

---

## 3. Findings from current screenshots and actual reproduction steps

The brief's screenshot observations were converted into component-level reproduction scenarios. Each scenario was exercised against the real React component tree in jsdom with isolated fixtures. Pixel-level visual comparison and a real browser session were not available in this headless environment; that limitation is recorded in §13.

| ID | Reported state | Reproduction before the fix | Root cause | Resolution |
|---|---|---|---|---|
| F1 | Player had no complete learning-record editor | Open a playlist, choose a lesson, and inspect the area below the player. Only the pause-note and **Needs revision** controls were present; confidence, revision date, notes, concepts, questions, code/exercise/example evidence, and review history were only reachable elsewhere. | The metadata UI lived on Revision/Library; Player had no shared editing surface. | Added the Player **Learning record** card using the shared `AnnotationFields` component (§4). |
| F2 | A reviewed lesson disappeared from Revision | Add a note and flag a lesson; open Revision and click **Mark revised**. The lesson leaves the queue; the old **All** scope still meant "all queued lessons", so the reviewed lesson could not be found from Revision. | Queue membership was the only browse scope, and the scope label was misleading. | Added **Revision queue** vs **All lessons**, a **Reviewed** filter, full-playlist search, and a jump path that reveals reviewed lessons in All lessons (§5). |
| F3 | Review status looked contradictory | Review a lesson, flag it again, and open its card. The card showed a review date and "needs revision" without explaining that one is history and the other is current work. | The two states shared one display area with no explicit semantics. | Added an explanatory line on Player and Revision cards: the earlier review is history; the current flag is active work (§5). |
| F4 | History showed technical empty values | Open History with no activity in the selected range. Cards showed bare `0s`, `0:00:00`, `0 / 17`, and "Sessions in week (0)" with no statement that this was a true empty result. | One formatter was used for both exact clock values and aggregate copy; no empty-state text existed. | Added the shared `formatDuration` convention (`0m`, `45s`, `1m 30s`, `1h`, `1h 1m`) and explicit true-empty guidance (§6). |
| F5 | History mixed evidence and range scopes | Seed verified playback, manual playback, timer-observed focus, and estimated correction. The old cards conflated focused time with estimated corrections and did not consistently label verified versus self-reported totals. | Statistics were assembled from mixed collections without evidence labels or a single range-scoped pipeline. | Rebuilt cards as Focused (timer-observed), Verified playback active, Self-reported playback active, unique content verified/self-reported, videos with playback, and completed videos verified/manual. Every card, the session list, and per-video detail use the same range (§6). |
| F6 | A manual entry could be saved but remain invisible | Select "today", save a self-reported entry for a date outside that range, and return to the list. The save succeeded but nothing visible changed. | The form did not tell the user that the selected range hid the saved entry. | The save handler now checks the selected range and switches the view to the entry's date, with an explicit message (§6). |
| F7 | Efficiency evidence filter affected only part of the calculation | Add 5 minutes of verified playback and 10 minutes of manually corrected focus; choose **Verified only**. The old numerator was filtered but the manual focus remained in the denominator. Separately, a measurable ratio above 100% was rejected or clamped. | The evidence filter was applied to segments only, and the utilization formula treated >100% as impossible. | `filterFocusByEvidence` is applied to focus sessions; playback utilization reports >100% and explains that playback may exceed tracked focus (§7). |
| F8 | Closed-tab time inflated Focus elapsed/paused time | Start a timer, close/reload the tab for an hour, then recover the timer. Active time was correctly capped at the last tick, but displayed/finished wall and paused time could include the closed hour. | Recovery excluded the gap from active time but not from wall-clock elapsed time. | Added `excludedWallMs`; recovery and finish subtract it from elapsed/paused calculations. The timer remains paused at the last observed tick (§8). |

---

## 4. Player learning-record editor implementation and tests

### Implementation

- New `frontend/src/features/player/LearningRecordEditor.tsx` renders a **Learning record** card beneath the player.
- New `frontend/src/components/ui/AnnotationFields.tsx` is shared by Player and Revision and owns:
  - confidence 1-5 (with "Not rated"),
  - revision date with strict calendar validation,
  - notes,
  - key concepts,
  - questions to investigate,
  - code reproduced / exercise done / built example,
  - needs revision.
- The editor targets the exact selected playlist occurrence through `identityKey(playlistId, entryId)`, not a numeric position alone.
- Edits are staged behind a **900 ms debounce**, then saved with `updateRecord`. Pending saves are flushed on:
  - selected occurrence change,
  - component unmount,
  - `visibilitychange` to hidden,
  - `pagehide`.
- A pending save stores its own immutable `playlistId`, `entryId`, `position`, and `videoId`. A navigation-triggered flush therefore writes to the entry that owned the draft, never to the lesson that rendered next.
- The save path uses metadata-only `annotationPatch`; it never changes status, completion, verified source, playback coverage, pause-note, sessions, or history.
- The separate pause-note is explicitly documented as belonging to the current playback session, not the persistent learning record.
- Feedback is exposed through a `role="status"` / `aria-live="polite"` message: dirty, saved, or error.
- Review status distinguishes:
  - never reviewed,
  - reviewed on a date,
  - reviewed on a date and now flagged again,
  - needs revision without a prior review.
- **Mark reviewed** calls the store action without deleting annotations; same-day repeat is disabled when there is no new active flag.
- Review history is shown in a collapsed `<details>` list with date and source (Player/Revision).

### Regression tests

`frontend/tests/player-learning-record.test.tsx` (6 tests):

1. Saves every metadata field to the exact selected entry without completing it.
2. Loads annotations per video, saves to the correct key, and survives reload.
3. Does not let completion toggles or player telemetry overwrite the draft.
4. Flushes an unfinished draft before switching videos.
5. Validates revision dates and confidence at the shared boundary.
6. Records review history once per day without deleting annotations.

The shared-field tests also exercise `numeric-fields.test.tsx` for field normalization.

---

## 5. Revision annotation persistence, review-state semantics, and all-lessons discovery

### Queue membership

`hasRevisionSignal` admits a lesson only when at least one current signal exists:

- `needsRevision === true`,
- confidence `1` or `2`,
- non-empty questions,
- explicit `codeReproduced === false`, `exerciseDone === false`, or `builtExample === false`,
- a non-empty revision date.

Historical notes, key concepts, confidence 3-5, a prior `revisionDoneAt`, and review history are **not** signals. This prevents "Mark revised" from appearing broken because an old annotation keeps the lesson queued forever.

### Review-state separation

- `ProgressRecord.revisionDoneAt` remains the fast latest-review mirror.
- `ProgressRecord.reviewHistory` is the append-only review log (`ReviewEvent` with id, reviewedAt, dateKey, source).
- `buildReviewPatch` clears `needsRevision` and `revisionDate`, records the review, and preserves every annotation and completion/evidence field.
- Same-day idempotency:
  - no second history entry if the display-timezone calendar day already exists in history or the `revisionDoneAt` date;
  - the XP dedup key is `rev:<playlist>:<entryId>:<dateKey>`, so repeat clicks cannot duplicate revision XP.
- Legacy records with `revisionDoneAt` but no history are backfilled with a synthetic legacy event on first review.
- A lesson can legitimately be both "Reviewed on ..." (history) and "Needs revision" (current work); Player and Revision explain this explicitly.

### All-lessons discovery

Revision now has two scopes:

- **Revision queue** — only records with an active signal; excludes orphaned records.
- **All lessons** — every entry in the playlist, including entries with no progress record and previously reviewed lessons.

Additional behavior:

- **Reviewed** filter appears in All lessons and matches any record with a last review date.
- Search always covers the whole playlist, not only the visible scope.
- A numeric search is treated as a position, including leading zeros.
- When a jump targets a lesson hidden by the queue or a filter, the UI explains why and switches to All lessons / clears the hiding filter.
- Reviewed lessons remain editable and their notes are preserved after leaving the queue.
- Orphaned records are shown separately and never counted as completion for a current video.

### Regression tests

`frontend/tests/revision-lifecycle.test.tsx` (2 tests) covers the full lifecycle:

- create annotation -> flag -> edit -> mark revised -> leave queue -> search reviewed lesson -> edit notes -> flag again -> same-day re-review -> reload -> verify notes, completion evidence, review history, and no duplicate XP;
- scope labels and the rule that historical notes or high confidence alone do not queue a lesson.

`frontend/tests/revision-ux.test.tsx` (7 existing tests) continues to cover sticky search, numeric/title jump, filter counts, clearing a hiding filter, and flagging a missing lesson from the message.

---

## 6. History formatting and filtering behavior

### Duration convention

`frontend/src/domain/duration/duration.ts` now exposes one aggregate formatter:

| Seconds | Output |
|---:|---|
| 0 | `0m` |
| 45 | `45s` |
| 90 | `1m 30s` |
| 3600 | `1h` |
| 3660 | `1h 1m` |

`formatSecondsHHMMSS` remains the exact clock formatter for per-video timelines and is not used for aggregate copy. `formatHuman` is the backwards-compatible UI name.

Zero remains a real value where it means "no matching records"; `n/a` is reserved for genuinely undefined calculations (for example, Efficiency with a zero focus denominator).

### Statistics and evidence

The History cards now read:

- **Focused (timer-observed)**, with a separate "+ X estimated correction" hint.
- **Verified playback active**.
- **Self-reported playback active**.
- **Unique content · verified / self-reported**, with the combined union as a hint.
- **Videos with playback · verified / self-reported**.
- **Completed videos · verified / manual**, with "completion date in range".

This separates:

- timer-observed focus from estimated manual corrections;
- Player-observed playback from hand-entered playback;
- verified completion from manual completion.

### Range scoping and empty states

- Every statistic, session row, and per-video detail is derived from the selected range and playlist.
- Focus and playback intervals are split at local-midnight boundaries in the display timezone.
- If no focus, playback, or coverage record exists in the range, the screen says it is a true empty result and suggests widening the range or adding a self-reported entry.
- The session list says "No sessions have been recorded in [range]" rather than showing a bare zero.
- Session detail is human-readable (start, finish, focused, wall clock, paused, evidence, note, video, active playback, unique gain) instead of raw JSON.
- All-time is labelled explicitly when the **All** preset is selected.
- Manual entries outside the selected range trigger a visible explanation and switch the view to the entry's date.

### Regression tests

`frontend/tests/history-presentation.test.tsx` (5 tests):

1. Duration formatting has no bare `0s`.
2. Verified, self-reported, observed, and estimated evidence remain separate.
3. A useful true-empty state is shown for an empty range.
4. A manual entry outside the range is explained and the range moves to it.
5. A manual entry persists through IndexedDB and, after a provider remount, updates the statistics, session list, and per-video detail consistently.

---

## 7. Efficiency formulas, independent examples, evidence semantics, and edge cases

### Formulas

```
contentEfficiency%   = uniqueContentSec / focusedStudySec * 100
playbackUtilization% = activePlaybackSec / eligibleFocusedSec * 100
overallEfficiency%   = sum(uniqueContentSec) / sum(focusedStudySec) * 100
```

- `activePlaybackSec` counts only playing wall time; pauses and buffering never enter the numerator.
- `focusedStudySec` counts active Focus seconds. Estimated corrections remain labelled estimated.
- `overallEfficiency` is the aggregate ratio, never the mean of daily percentages.
- Daily percentages with a zero denominator are omitted from the chart, not zero-filled.
- `n/a` means undefined, usually a zero denominator; it is not a zero performance score.

### Independent hand calculations

| Scenario | Calculation | Result |
|---|---|---:|
| 3 h focused study, 1 h unique content | `3600 / 10800 * 100` | `33.33%` |
| 90 min focused study, 60 min unique content | `3600 / 5400 * 100` | `66.67%` |
| 90 min focused study, 99 min unique content | `5940 / 5400 * 100` | `110%` |
| 10 min focused study, 12 min active playback | `720 / 600 * 100` | `120%` utilization |
| 752 s unique content, 1504 s focus | `752 / 1504 * 100` | `50%` |
| 0 unique content, 600 s focus | `0 / 600 * 100` | `0%` (real zero) |
| Any non-zero content, 0 focus | denominator zero | `n/a` |
| Day A 300/900, Day B 300/300 | aggregate `600 / 1200 * 100` | `50%`, not `66.67%` |
| Mixed verified 600/600 and manual 300/600 | aggregate `900 / 1200 * 100` | `75%` |
| Active playback 400 s, focus 800 s | `400 / 800 * 100` | `50%` utilization |
| Active playback 400 s, focus 0 | denominator zero | `n/a` |
| Active playback 120 s, focus 60 s | `120 / 60 * 100` | `200%` (reported, not clamped) |

### Evidence semantics

- **Verified** = Player-observed playback segments plus timer-observed focus (`estimated !== true`).
- **Self-reported** = manual timeline segments plus estimated focus corrections (`estimated === true`).
- The selector applies to **both** the numerator and denominator.
- Legacy focus sessions without an `estimated` field are treated as observed, not manual.
- The screen explains why a ratio can exceed 100%: playback can occur outside the Focus timer, and faster-than-real-time coverage is legitimate.
- The per-playlist rows use the same evidence filter and show `n/a (no focused study in this evidence scope)` when undefined.
- The 14-day chart leaves gaps for days without a denominator rather than drawing zeros.
- The trend comparison requires at least three positive observations in each seven-day window before calling a change meaningful.
- The UI explicitly notes that Arena's mean-of-daily-percentages is a different question from this page's aggregate ratio; both are intentional.

### Regression tests

`frontend/tests/efficiency-evidence.test.ts` (5 independent arithmetic tests) and `frontend/tests/efficiency-screen.test.tsx` (2 screen tests) cover numerator/denominator filtering, live updates after new sessions, >100% reporting, zero denominators, and explanations.

`frontend/tests/v2.test.ts` was intentionally updated: the old assertion `playbackUtilization(99999, 60) === null` encoded the removed clamp. The corrected expectation is approximately `166665%`. No assertion was removed or weakened.

---

## 8. Focus workflows and cross-feature consistency results

### Deterministic state machine

`frontend/src/domain/focus/focus.ts` stores:

- real start/pause/resume wall-clock anchors,
- active and paused intervals,
- active accumulated milliseconds,
- `lastUpdatedMs`,
- `excludedWallMs` for time while the page was closed.

Key rules:

- Active time excludes pauses and breaks.
- Hiding the tab pauses automatically.
- Recovery closes a running timer at the last persisted tick and returns it **paused**.
- Closed-tab time is excluded from active, elapsed, and paused calculations.
- Finish is idempotent: idle/finished returns `null`; the UI also guards with `finishing` and a set of finished timer ids; the store deduplicates by `clientId`.
- Sessions under 10 active seconds are not recorded.
- A manual correction is stored with `estimated: true` and no synthetic active intervals; it is never presented as timer-observed.
- Session notes are persisted with the recovery snapshot and restored after reload.

### Measured workflow examples

| Workflow | Verified result |
|---|---|
| Start, run 65 s, pause 60 s, resume 35 s, finish | active `100 s`, elapsed `160 s`, exactly one session, active intervals sum to `100 s` |
| Persist note, unmount, reopen 30 s later | note restored, timer recovered paused, active remains ~12 s, closed-tab time not counted |
| Manual correction 2 min after 20 s observed | active `120 s`, `estimated: true`, intervals empty, elapsed at least `120 s` |
| Start, run 90 s, pause to 5 min, resume to 6 min, finish | active `150 s`, elapsed `360 s`, paused `210 s` |
| Cross-midnight 23:50 -> 00:20 UTC | attributed `600 s` to 2026-10-27 and `1200 s` to 2026-10-28; sum equals active time |
| Recovery after a 2-hour gap from a 15 s persisted tick | active `15 s`, wall `15 s`, finished elapsed `15 s` |

### Cross-feature consistency

- History uses "Focused (timer-observed)", "estimated correction", "verified playback", and "self-reported playback".
- Efficiency uses the same verified/manual split for both sides of its ratios.
- Player and Revision share annotation field semantics and review status copy.
- Revision queue signals and History completion evidence never count a historical note as current mastery.
- Review history is validated by the v3 backup format and included in exports/restores.
- Timezone/day attribution is consistent: real UTC instants are stored; display-timezone calendar keys drive ranges, revision overdue, review idempotency, Focus day slices, and History splits.

Focus tests: `focus-timer.test.ts` (7 tests) and `focus-workflow.test.tsx` (3 end-to-end tests) all pass.

---

## 9. Additional bugs discovered and fixed

| ID | Bug | Impact | Fix |
|---|---|---|---|
| A1 | Pending Player annotation flush could write to the newly selected video | Notes could be saved to the wrong lesson when navigating within the 900 ms debounce window. | `PendingSave` now carries immutable entry identity; flush targets the owner of the draft; navigation/unmount/pagehide flush is covered by tests. |
| A2 | Playback segment capture used live `pos`/`entry` refs when closing a segment | A quick navigation/refresh could attribute wall time or timeline coverage to the next occurrence. | `openSegment` snapshots the entry, position, session id, timeline start, and rate; `closeSeg` uses only that snapshot. |
| A3 | Focus recovery excluded closed-tab time from active seconds but not from displayed/finished elapsed/paused seconds | A recovered 15-second session could report a multi-hour wall/paused duration. | Added `excludedWallMs` and subtracted it from `wallMs` and `finishFocus`; final pause interval ends at the last observed tick. |
| A4 | Focus note and manual correction were only in component state | Reload during an unfinished session lost the note/correction. | Both are persisted with the timer snapshot and restored; tests cover the note and estimated correction paths. |
| A5 | Rapid double Finish could race before React committed the idle state | Two session records or duplicate XP were possible in a narrow window. | UI `finishing` ref, finished-timer-id set, domain finished-state guard, and store `clientId` dedup. |
| A6 | Manual History entry outside the selected range was silently hidden | Users could believe the save failed. | The form now detects out-of-range saves, switches to that date, and explains what happened. |
| A7 | Repeated same-day **Mark revised** could append duplicate history/XP | Review history and XP ledger could be inflated. | `buildReviewPatch` checks history and `revisionDoneAt` date; XP dedup key includes the day. Tests assert one history entry and unchanged XP. |
| A8 | Backup validation ignored review history | A malformed or incomplete history could pass validation or be dropped. | `ReviewEvent` validation checks id, ISO instant, strict calendar date, source, and the 500-event cap; valid history round-trips. |
| A9 | History helpers were captured by memos with incomplete dependency arrays | A latent stale-render path could compute range/playlist totals from old helpers after a filter change. | Helpers are `useCallback` values and are included in memo dependencies; lint no longer reports this file. |
| A10 | Aggregate UI used a clock formatter for empty values | Empty History cards looked technical (`0s`, `0:00:00`). | Added `formatDuration`; exact clock formatting remains for per-video timelines. |
| A11 | Utilization had a test that asserted clamping | The test protected a behavior that hid real data. | Replaced the expectation with the measurable >100% ratio and added an explanatory screen test. This was a deliberate semantic correction, not a weakened assertion. |

---

## 10. Files changed and rationale

| File | Change | Rationale |
|---|---|---|
| `frontend/src/features/player/LearningRecordEditor.tsx` | New | Complete Player metadata editor with exact-occurrence identity, debounce, flush, validation, review status/history. |
| `frontend/src/components/ui/AnnotationFields.tsx` | New | One shared field/validation/patch implementation for Player and Revision. |
| `frontend/src/features/player/Player.tsx` | Modified | Mounts the editor; pauses-note isolation; occurrence-scoped verified telemetry; immutable segment capture. |
| `frontend/src/features/revision/Revision.tsx` | Modified | Queue vs All lessons, Reviewed filter, full-playlist search/jump, review-history display, clear contradictory-state copy. |
| `frontend/src/domain/revision/revision.ts` | Modified | `hasRevisionSignal`, `buildReviewPatch`, `lastReviewIso`, overdue/filter logic. |
| `frontend/src/features/history/History.tsx` | Modified | Evidence-separated stats, range-scoped session list/per-video detail, true-empty states, manual-entry feedback, human-readable detail. |
| `frontend/src/domain/duration/duration.ts` | Modified | `formatDuration`/`formatHuman` aggregate convention. |
| `frontend/src/features/efficiency/Efficiency.tsx` | Modified | Evidence filter on both sides, >100% explanation, formula copy, >100/0/n-a states. |
| `frontend/src/domain/efficiency/efficiency.ts` | Modified | `filterFocusByEvidence`, no clamping, aggregate and daily semantics. |
| `frontend/src/features/focus/Focus.tsx` | Modified | Note/manual persistence, finish guards, recovery messaging, estimated correction path. |
| `frontend/src/domain/focus/focus.ts` | New | Deterministic timer state machine with intervals, recovery, `excludedWallMs`, idempotent finish. |
| `frontend/src/app/store.tsx` | Modified | `markReviewed`, session idempotency, review persistence, migration/persistence integration. |
| `frontend/src/types/index.ts` | Modified | `ReviewEvent`, `reviewHistory`, focus intervals, estimated/evidence fields. |
| `frontend/src/services/persistence/backup.ts` | New/modified | v3 validation including strict review-history validation and atomic restore staging. |
| `frontend/tests/player-learning-record.test.tsx` | New | 6 Player editor tests. |
| `frontend/tests/revision-lifecycle.test.tsx` | New | 2 complete review-lifecycle tests. |
| `frontend/tests/history-presentation.test.tsx` | New | 5 History presentation/persistence tests. |
| `frontend/tests/efficiency-evidence.test.ts` | New | 5 independent arithmetic tests. |
| `frontend/tests/efficiency-screen.test.tsx` | New | 2 evidence/explanation screen tests. |
| `frontend/tests/focus-workflow.test.tsx` | New | 3 end-to-end Focus workflow tests. |
| `frontend/tests/focus-timer.test.ts` | New/modified | 7 timer math, recovery, cross-midnight, minimum-duration tests. |
| `frontend/tests/backup.test.ts` | New/modified | 11 validation, round-trip, atomic restore, and review-history tests. |
| `frontend/tests/v2.test.ts` | Modified | Corrected the old utilization clamp expectation. |
| `frontend/tests/scale.test.ts` | Modified | Removed an unused lint directive. |
| `HOW_TO_USE_LEARNQUEST.md` | Modified | Documents the learning record, all-lessons/reviewed workflow, review history, and range-consistent History behavior. |
| `README.md` | Modified | Feature summary now mentions persistent learning records and the all-lessons review workflow. |
| `frontend/src/features/focus/Focus.tsx` | Modified | Removed one unused `eslint-disable` directive after the deps cleanup. |
| `frontend/src/features/history/History.tsx` | Modified | `useCallback` helper stabilization and final dependency cleanup. |
| `backend/src/server.ts`, `backend/tests/cache.test.ts` | Modified | Removed unused lint directives; no runtime behavior change. |

The tracked diff also contains first-pass files (identity, backend hardening, settings, playlist operations, etc.) that were already present at baseline. They were preserved, not reverted.

---

## 11. Regression tests and exact verification results

### New or expanded second-pass coverage

| Suite | Tests | What it proves |
|---|---:|---|
| `player-learning-record.test.tsx` | 6 | Every field saves to the exact entry; per-video reload; completion/telemetry cannot overwrite drafts; navigation flush; validation; review history idempotency. |
| `revision-lifecycle.test.tsx` | 2 | Full create/flag/review/leave-queue/search/edit/reflag/reload lifecycle; honest scope and queue signals. |
| `history-presentation.test.tsx` | 5 | Duration formatting; evidence separation; true-empty state; out-of-range manual entry; manual entry persistence through IndexedDB and remount, including per-video detail. |
| `efficiency-evidence.test.ts` | 5 | Independent arithmetic for content efficiency, aggregate ratio, utilization, evidence filtering, and mixed verified/manual examples. |
| `efficiency-screen.test.tsx` | 2 | Evidence selector filters both numerator and denominator; zero-focus explanation and live updates. |
| `focus-workflow.test.tsx` | 3 | Start/pause/resume/finish; pause exclusion; duplicate-finish blocking; note recovery; estimated correction. |
| `focus-timer.test.ts` | 7 | Real timestamps; repeated pause/resume; cross-midnight split; recovery; sanitization; 10-second minimum; paused-finish interval. |
| `backup.test.ts` | 11 | v3 round-trip; malformed review history; timestamps/NaN/duplicates; cross-references; full-restore semantics; legacy v1; atomic replacement and clear-all. |

Net test growth: **226 -> 250** (+24 test cases; six new second-pass suites contain 23 cases and one backup validation case was added). Existing first-pass suites (`identity`, `store-integrity`, `numeric-fields`, `regression-domain`, `revision-ux`, `time-correctness`, `fair-efficiency`, `api-client`, `scale`, etc.) all still pass.

### Exact gates

| Command | Result |
|---|---|
| `cd frontend; npm test` | **29 files passed, 250/250 tests passed** |
| `cd frontend; npm run typecheck` | **Passed** |
| `cd frontend; npm run lint` | **Passed: 0 errors, 4 warnings** |
| `cd frontend; npm run build` | **Passed** (tsc + Vite) |
| `cd backend; npm test` | **6 files passed, 26/26 tests passed** |
| `cd backend; npm run typecheck` | **Passed** |
| `cd backend; npm run lint` | **Passed: 0 errors, 8 warnings** |
| `cd backend; npm run build` | **Passed** |
| `cd frontend; npm audit --omit=dev --audit-level=low` | **0 vulnerabilities** |
| `cd backend; npm audit --omit=dev --audit-level=low` | **0 vulnerabilities** |
| `cd frontend; npm audit --audit-level=low` | **6 vulnerabilities**, dev toolchain; exit 1 |
| `cd backend; npm audit --audit-level=low` | **6 vulnerabilities**, dev toolchain; exit 1 |

### Test-integrity notes

- No test was skipped, marked todo, or suppressed.
- `v2.test.ts` expectation was changed from `null` to `~166665` because the old value asserted the defect (clamping). The corrected behavior is independently covered by `efficiency-evidence.test.ts`.
- Focus tests use an explicit "arm focus" step so the store hydrates with real timers before fake timers are installed; this avoids IndexedDB timer deadlocks.
- Backup/migration tests use isolated fake IndexedDB keys and never touch a real user database.
- The History persistence test pins the UTC date before saving. When the screen is mounted directly in a test, its form can initialize with the pre-hydration device timezone; the real app gates screens on store readiness. The test documents this and verifies the real persisted result.

---

## 12. Build, lint, typecheck, and dependency-audit outcomes

### Typecheck and build

- Frontend: `tsc --noEmit -p tsconfig.json` passed as part of `npm run build`.
- Backend: `tsc --noEmit -p tsconfig.json` and `tsc -p tsconfig.json` passed.
- Production frontend build passed:
  - 2,243 modules transformed;
  - main chunk `index-DvZC7c2r.js` 326.53 kB (gzip 100.85 kB);
  - largest chunk `generateCategoricalChart-CHTYlmZ_.js` 385.17 kB (gzip 106.41 kB);
  - CSS 41.01 kB (gzip 7.63 kB);
  - no >500 kB warning.
- Backend production build passed.

### Lint

- Frontend: `0 errors`, `4 warnings`.
  - `TimezonePicker` useMemo unnecessary `open` dependency.
  - `Analytics` useMemo unnecessary `today` dependency.
  - `Competition` useMemo unnecessary `todayTick` dependency.
  - `Efficiency` useMemo unnecessary `todayTick` dependency.
  - These are deliberate day-tick/memo refresh dependencies; no error and no known behavioral defect.
- Backend: `0 errors`, `8 warnings`.
  - Seven `@typescript-eslint/no-explicit-any` warnings in YouTube service/middleware.
  - One `any` warning in error middleware.
  - No unused directives remain.
- Real ESLint is executed in both packages; lint can fail the build gate (unlike the pre-remediation `|| exit 0` scripts).

### Dependency audit

- Production dependency audit: **0 vulnerabilities** in both packages.
- Full audit: **6 vulnerabilities** in each package, all in the development/test toolchain:
  - `@vitest/mocker` / `vitest` path traversal and mock registration advisories;
  - `esbuild` development-server request disclosure;
  - `tinypool` prototype-pollution/RCE gadget.
- `npm audit fix --force` would install `vitest@5.0.5`, a breaking major upgrade. It was **not** applied; forcing it during this pass could destabilize the test harness and is outside the requested scope.
- The high-severity `body-parser` advisory from the prior baseline remains fixed via the existing override.

### Environment-file status

- No `.env` file was created or modified.
- `backend/.env` exists but is pre-existing, git-ignored, and dated 2026-10-13; it was not read or written.
- `frontend/.env` and a repository-root `.env` do not exist.
- `backend/.env.example` and `render.yaml` were already modified from the first pass and were left untouched.
- No secret value was printed.

---

## 13. Browser and accessibility checks performed and not performed

### Performed (jsdom / structural)

- Rendered the real Player, Revision, History, Efficiency, and Focus components through the real store provider with fake IndexedDB.
- Keyboard interactions:
  - Enter in the Revision find field triggers search/jump;
  - Dropdown supports Arrow keys, Home/End, Enter/Space, Escape;
  - NumberField supports Enter/Escape/blur commit and boundary normalization;
  - Revision jump moves focus to the matching card.
- Accessibility structure:
  - labels for every annotation field and numeric field;
  - `aria-invalid` and error descriptions for invalid revision dates;
  - `aria-pressed` on scope/filter buttons;
  - `aria-expanded`, `aria-haspopup`, and listbox option semantics on Dropdown;
  - `role="status"` / `aria-live` save and range messages;
  - revision cards are focusable and labelled with position/title;
  - fieldset/legend grouping for learning evidence.
- Responsive/sticky structure inspected in source: sticky Revision toolbar, scroll margin, mobile header offset, and reduced-motion-aware smooth scrolling.
- No real IndexedDB browser profile was used; `fake-indexeddb` is the test substrate.

### Not performed

- No real Chrome, Firefox, Safari, Edge, iOS, or Android session.
- No live YouTube IFrame API verification (embed errors, buffering, seek behavior, actual playback telemetry).
- No real screen-reader pass (NVDA, VoiceOver, JAWS) or forced-colors/high-contrast check.
- No 200% zoom, mobile viewport, touch-target, or visual regression screenshot comparison.
- No real browser storage quota, private-mode, cross-tab, or background-throttling test.
- No pixel-level comparison against the supplied screenshots.

These are the main reasons the report distinguishes structural jsdom verification from real-browser acceptance.

---

## 14. Remaining limitations, risks, and deferred items

1. **Dev-toolchain advisories remain.**
   - Blocker: the available fix is `vitest@5.0.5`, a breaking major upgrade of Vitest/Vite-adjacent tooling.
   - Reproduction: `npm audit` in either package.
   - Mitigation: production audits are clean; upgrade the test toolchain in a dedicated change with a full suite run.

2. **No real-browser or live-YouTube verification.**
   - Blocker: this environment is headless and has no YouTube session/embed.
   - Risks: sticky toolbar behavior, actual focus rings, responsive layout, playback event ordering, and IFrame error paths remain visually unverified.
   - Reproduction: open the built app in Chrome/Firefox, run the acceptance checklist in §15, and test a real playlist.

3. **No screen-reader or high-contrast audit.**
   - Labels, roles, and keyboard paths are structurally present, but announcements and visual contrast need manual assistive-technology testing.

4. **Player autosave has a small crash window.**
   - Edits are debounced by 900 ms and flushed on navigation, unmount, visibility-hidden, and pagehide. A hard browser crash before a flush can still lose the last keystrokes.
   - This is a deliberate tradeoff to avoid a write per keystroke; the explicit **Save learning record** button is available immediately.

5. **Focus depends on localStorage for the recovery snapshot.**
   - Private mode or quota failure can prevent recovery; the timer still works in memory for the current page. No learning session is fabricated, and a manual History entry remains available.

6. **Review idempotency uses the display-timezone calendar day at review time.**
   - Changing the display timezone later does not rewrite existing history. A user who changes timezone between two reviews on the same UTC day could create two entries; this follows the product's "calendar day in the display timezone" rule and is documented in the UI copy.

7. **Review history is capped.**
   - A single progress record keeps at most 500 review events; backup validation enforces the same cap. Older events beyond the cap are dropped by design. The latest review mirror remains available.

8. **Legacy review backfill uses the stored instant's date prefix.**
   - A pre-history record's synthetic legacy event may show a UTC date that differs from the display-timezone date. Only affects records created before `reviewHistory` existed.

9. **Lint warnings remain.**
   - Four frontend hook-dependency warnings and eight backend `any` warnings are non-failing. They are documented above; no known behavioral failure is associated with them.

10. **Changes remain uncommitted.**
    - No commit or push was requested. The report and tests are in the working tree; the user must review and commit them deliberately.

---

## 15. Manual acceptance checklist

Use a disposable browser profile or an exported backup. Do not test mutations on real learning data without a backup.

### Data safety first

- [ ] Export a JSON backup from Reports and confirm it downloads.
- [ ] Confirm the backup includes playlists, progress, sessions, segments, and settings.
- [ ] Do not run Clear All or restore against real data unless the exported backup is verified.

### Player learning record

- [ ] Open a playlist -> Player -> choose a lesson.
- [ ] Confirm the **Learning record** card appears with confidence, revision date, notes, key concepts, questions, code, exercise, built example, and needs-revision fields.
- [ ] Change every field; wait at least one second; confirm "Learning record saved."
- [ ] Confirm the video is **not** marked complete or verified by saving metadata.
- [ ] Reload; confirm every field persists for the exact lesson.
- [ ] Type a note and immediately switch videos; confirm the draft is saved to the original lesson and the new lesson is unaffected.
- [ ] Switch playlists and back; confirm annotations load per exact occurrence.
- [ ] Enter an invalid revision date; confirm the inline error and that other draft fields remain.
- [ ] Toggle completion and play telemetry; confirm annotations are not overwritten.
- [ ] Confirm the pause-note remains distinct from the persistent learning record.

### Review lifecycle

- [ ] Flag a lesson, add notes/concepts/questions, and mark it revised.
- [ ] Confirm the flag and revision date clear, notes remain, and a dated review appears.
- [ ] Confirm the lesson leaves the active queue.
- [ ] Open **All lessons**, use **Reviewed**, and find the lesson by title and by position.
- [ ] Edit the reviewed lesson's notes; flag it again.
- [ ] Confirm the UI explains that the review is history and the new flag is current work.
- [ ] Mark revised again on the same day; confirm no duplicate history entry and no duplicate XP.
- [ ] Reload; confirm notes, completion evidence, and one review history entry remain.

### History

- [ ] Select an empty range; confirm the true-empty explanation and "No sessions have been recorded".
- [ ] Select a range with verified and self-reported data; confirm the six cards separate the evidence types.
- [ ] Open a session row; confirm human-readable detail (no raw JSON).
- [ ] Add a valid self-reported entry in the current range; confirm statistics, session list, and per-video detail update.
- [ ] Add an entry for a date outside the range; confirm the view switches to that date and explains why.
- [ ] Reload; confirm the self-reported entry persists and remains labelled self-reported.
- [ ] Test a cross-midnight session and a non-UTC display timezone; confirm day splits and range totals.

### Efficiency

- [ ] With focus time but no unique content, confirm content efficiency shows a real `0%`, not `n/a`.
- [ ] With unique content but zero focus, confirm `n/a` and the denominator explanation.
- [ ] Confirm a >100% utilization or content ratio is displayed, not clamped.
- [ ] Switch Evidence between All / Verified / Self-reported; confirm the numerator **and** focus denominator change together.
- [ ] Confirm the aggregate figure is not the mean of daily percentages.
- [ ] Confirm zero-focus days create gaps in the 14-day chart rather than zero points.

### Focus

- [ ] Start, pause for a minute, resume, and finish; confirm active time excludes the pause and wall time includes it.
- [ ] Click Finish twice rapidly; confirm exactly one session and no duplicate XP.
- [ ] Enter a session note and a manual correction; finish; confirm the note is saved and the correction is labelled estimated.
- [ ] Start a timer, reload/close the tab, and reopen; confirm recovery is paused and closed-tab time is not counted.
- [ ] Confirm hiding the tab pauses automatically.
- [ ] Start and finish a session under 10 seconds; confirm it is discarded with a notice.

### Accessibility and polish

- [ ] Navigate Revision search, Jump, filters, and cards using only the keyboard.
- [ ] Open/close Dropdowns with arrows, Home/End, Enter/Space, and Escape.
- [ ] Confirm every annotation input has a stable label and invalid dates announce an error.
- [ ] Confirm status messages are announced (or visibly updated) for save, error, empty range, and review outcomes.
- [ ] Test at mobile width and 200% zoom; confirm no horizontal scrolling in primary flows and the Revision toolbar stays usable.
- [ ] Test with reduced motion enabled; confirm smooth scrolling becomes immediate.
- [ ] Check the browser console for unexpected errors during a full pass.

### Final verification

- [ ] Run `frontend: npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] Run `backend: npm test && npm run typecheck && npm run lint && npm run build`.
- [ ] Run `npm audit --omit=dev` in both packages.
- [ ] Confirm no `.env` file was created or modified during testing.

---

## Report integrity

- Target filename did not exist before this report was written; no prior report was overwritten.
- Prior report preserved: `docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md`.
- No terminal output contained the full report or any secret.
