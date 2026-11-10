# Phase D Arena engineering report

## Model and evidence

Arena v3 uses the same 75-point coverage and 25-point consistency policy for the learner and all fictional rivals. The denominator is the exact duration of the run's frozen playlist, with stable occurrence IDs even for duplicate video IDs. Unresolved durations prevent creation. A qualifying day requires 300 seconds of new verified coverage or a completed lesson, plus at least 600 seconds of focus or observed playback. Activity uses the greater of focus and playback. Overlapping playback wall intervals are unioned before counting activity, and rewatches do not add verified content. Estimated focus and unsaved focus drafts do not qualify. A completion can contribute coverage, but it cannot qualify a day by itself or erase earlier playback.

The earlier evidence loss came from checking current completion status while reconstructing past daily playback. Arena v3 accounts for that earlier activity independently. It matches frozen playlist evidence by occurrence identity and video ID, including records marked removed by a playlist refresh. A newly inserted duplicate does not inherit another occurrence's credit. The original rank snapshots and fixed metadata remain readable in Legacy Arena records and keep their original interpretation. They lack the frozen evidence required for an exact replay.

## Rival generation and ranking

Arena v3 is explicit in the persisted contract. The engine uses independent seeded draws for rival identity, study cadence, pace, endurance, and daily variation. Difficulty changes cadence and typical study time for rivals. It does not enter the learner's score. Rival daily study produces bounded coverage and simulated completions at the frozen lesson boundaries. This is a fictional cohort, with no statistical claim about real learners.

Ranking sorts by full-precision score, then coverage, consistency, and stable ID. One pass assigns competition ranks such as 1, 2, 2, 4. Secondary ordering never breaks a score tie. Unqualified participants have no rank. The interface paginates 25 rows, supports search and direct access to the learner row, and offers rival comparison, a ranked score distribution, per-day eligibility evidence, and explicitly saved rank checkpoints.

## Lifecycle and replay

- **Practice** compares the learner and rivals over the same rolling window of closed local days. Both coverage and qualification use that window. Pause seals the displayed view. Resume catches up to recorded learning in the window. Reset archives the current result and creates a new run with the same seed, configuration, and basis, with an empty checkpoint list.
- **Fixed challenge** starts at local midnight, using the next local date when created after midnight. The timezone and calendar dates are frozen. Only closed local dates count. The end is the local midnight following the final date. A spring DST day can therefore be 23 hours. Verified intervals are clipped to the challenge's exact UTC bounds. Early finalization still includes only closed days. The saved result records the evidence cutoff, while planned dates remain available for interpretation.
- **Completion** saves a replay artifact containing exact aggregate coverage, dated qualification inputs, observed-day count, score and rank. Configuration, model, frozen playlist basis and seed remain with the run. Replay regenerates the same rivals and uses saved evidence. It does not read current learning state. If replay differs from the sealed result, the recorded score remains visible and the conflicting leaderboard is suppressed.
- **Archive** moves a completed result to archived status. Creating a new simulation while one is active seals and archives the active run. History is bounded to 20 runs and each run can record 90 rank checkpoints. The UI asks the user to delete a selected archived record at capacity rather than pruning automatically.
- **Delete** asks for confirmation using the selected run name and removes only that run and its embedded Arena results. Repeating a delete or applying a stale replacement is safe.

## Storage and compatibility

The versioned Arena ledger is additive inside the existing challenge singleton. Backup v3 preserves the new ledger and older fixed metadata. Frontend restore and API validation enforce the same bounds. There are no new MongoDB collections, schema-version changes, migrations, or production data operations. Older client backup readers predate this nested ledger and cannot be relied on to restore it.

Local Arena management commits an IndexedDB read-update-write transaction before confirming success. A stale action rechecks the stored run identity. The general local save preserves that committed ledger, and restore and clear operations wait for the write chain. The browser fixture verified both immediate reload and a rejected write leaving the selected run intact. Cloud mode uses the existing versioned singleton synchronization and conflict review. An optimistic cloud change remains pending on a failed save, with retry available in the workspace header.

## Interface

The first-use screen offers Practice or Fixed challenge, difficulty, duration and cohort size, with seed and basis details behind disclosure. Active and sealed views emphasize identity, score, rank and leaderboard. The score explanation and management controls are secondary. Mobile hides the optional coverage column while keeping rank, learner and score readable. It places the leaderboard before the explanation in visual and keyboard order. The Arena uses LearnQuest surface, typography, focus and motion conventions.

## Files

- Scoring, time boundaries, generation, and transitions under `frontend/src/domain/competition`.
- Store, IndexedDB and backup integration in `frontend/src/app/store.tsx` and `frontend/src/services/persistence`.
- API contract validation in `backend/src/services/arenaValidation.ts` and `userData.ts`.
- Arena interface in `frontend/src/features/competition/Competition.tsx`.
- Tests in `frontend/tests/arena-regressions.test.ts`, `arena-runs.test.ts`, and `frontend/tests/browser/arena.browser.mjs`.

## Verification limits

Testing uses synthetic data and isolated Chromium, including emulated touch. Physical-device input, Safari, Firefox, assistive technology and a live cloud deployment were not verified. A sealed result represents evidence available when it was captured, not a reconstruction of mutable data that had already been deleted. Phase E requires separate approval.
Scores describe a private fictional comparison. The storage validator checks the record contract, while replay checks its score and rank. This is not third-party certification of user-entered learning records.

## Measurements

- The final focused Node 24 synthetic run generated and ranked 2,000 rivals over 90 date keys in 213 ms. A previous run with the same lesson-boundary generator measured 1,633 ms under concurrent checks. These are observed wall times, not an A/B benchmark or a device guarantee.
- Windows headless Chromium took 614 ms from filling and submitting the 2,000-opponent setup to seeing the leaderboard in the closed-day rerun. This includes Playwright and rendering overhead. The table rendered 25 data rows plus its header.
- Final ranked browser fixtures placed the learner first and 87th using actual inputs to the scoring model. The six reviewed widths were 320, 390, 768, 1024, 1440 and 1920 px. Review captures are under `frontend/test-results/visual/phase-d`.

## Test results

| Check | Result |
| --- | --- |
| Broad frontend Vitest | 498 passed and one new frozen-duration boundary case failed in the run that overlapped its final clipping change. |
| Fresh frontend Arena and backup run | 49 passed on the final source, including the frozen-duration case and the two promoted audit regressions. |
| Backend Vitest | 257 passed and 3 MongoDB rehearsal cases skipped. |
| Combined Chromium baseline | 42 passed, including both exact Library references and the Phase C/C.1 chart and compass checks. |
| Final closed-day Arena Chromium | 7 passed, including 2,000 opponents, failed deletion, rank extremes, and archive reload. |
| Focus and final archive Chromium checks | 3 and 2 entries passed, respectively. |
| Deferred regression suite | EXPORT-1 reproduced. It remains the only deferred case in this suite. |

The earlier browser pass found a reload race between Arena actions and the old
debounced save. The final Arena cases verify the committed transaction before
reload and deliberately reject a synthetic delete write to verify recovery.
