# LearnQuest Remediation Implementation Report

**Date:** 2026-10-27  
**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**HEAD:** `d9f3dc721b534728f3ff7ce76b4325ceebd5691b` (`finally`, 2026-10-14)  
**Scope:** LQ-001–LQ-039, Revision sticky/search UX, numeric-field normalization, full Focus audit, and additional bug-hunt findings.

---

## 1. Executive summary

All 39 supplied findings (LQ-001–LQ-039) were implemented and verified: **39 Fixed, 0 Partially Fixed, 0 Not Fixed, 0 Not Applicable**. In addition, 12 defects found during the audit or during test execution were fixed, including two high-severity data-loss/identity issues discovered while validating the remediation itself.

The largest changes are:

- Stable playlist-entry identity with migration, duplicate-occurrence handling, per-playlist reconciliation, and orphan-for-review behavior instead of position-based completion transfer.
- A version-3, fully validated backup format with cross-reference checks, atomic IndexedDB replacement, and a pre-restore backup download.
- A deterministic Focus timer built from real wall-clock anchors and active/paused intervals, with focused-tab visibility pausing, recovery-as-paused, and idempotent completion.
- Complete separation of verified player evidence from manual/estimated evidence across Player, History, Analytics, Efficiency, Arena, Goals, and exports.
- A rebuilt Revision toolbar with sticky positioning, one find field, Enter-to-jump, filter counts, filter-aware navigation, highlighting, focus handling, and inline errors.
- Consistent timezone/day attribution using the device IANA zone for the `local` sentinel, including cross-midnight playback and Focus splitting.
- Real ESLint execution in both packages, a small `body-parser` security override, backend rate-limit/proxy hardening, and lazy-loaded heavy frontend tabs.

Final measured gates:

| Gate | Result |
|---|---|
| Frontend tests | **226 / 226 passed** (23 files) |
| Backend tests | **26 / 26 passed** (6 files) |
| Frontend typecheck | **Passed** |
| Backend typecheck | **Passed** |
| Frontend lint | **Passed, 0 errors / 11 warnings** |
| Backend lint | **Passed, 0 errors / 10 warnings** |
| Frontend production build | **Passed**; largest chunk 385.17 kB (gzip 106.41 kB), no >500 kB warning |
| Backend production build/typecheck | **Passed** |
| Dependency audit | `body-parser` high fixed; 6 dev-toolchain advisories remain in each package (Vitest/Vite chain) |

No `.env` file was created or modified. `backend/.env.example` and `render.yaml` now document `TRUST_PROXY_HOPS=1`; no secret was read aloud or changed.

Remaining limitations are disclosed in §14. The most important are the intentionally deferred frontend CSP, unpatched dev-only Vitest/Vite advisories, and the fact that no real-browser, screen-reader, or live YouTube verification was performed.

---

## 2. Baseline state and verification

### Repository state before changes

- Branch `main`, HEAD `d9f3dc7`, working tree already contained the two untracked prompt files:
  - `learnquest-audit-prompt.txt`
  - `learnquest-fix-prompt.txt`
- Both files were preserved byte-for-byte and are still untracked.
- No commits, pushes, branch changes, stashes, resets, cleans, or destructive checkouts were performed.

### Baseline measurements

| Check | Baseline result |
|---|---|
| Frontend tests | 174 / 174 passed (16 files) |
| Backend tests | 18 / 18 passed (4 files) |
| Typechecks | Clean in both packages |
| Frontend build | Passed; one 785.05 kB JS chunk (gzip 222.22 kB) with Vite's >500 kB warning |
| Lint | Not effective: scripts ended in `|| exit 0`, ESLint was absent, so “lint” could not fail |
| Dependency audit | `body-parser@1.20.8` high advisory via `express@4.22.3`; dev-chain Vitest/Vite advisories |

### Baseline defects confirmed

The baseline confirmed the supplied findings: position-keyed progress, unvalidated/merging restore, synthetic Focus timestamps, conflated evidence, annotation loss on unmark, missing lint, the body-parser advisory, and the Revision/numeric UX problems. No baseline test failure was hidden; all later failures were from newly added regression tests and were fixed rather than suppressed.

---

## 3. Status of every supplied finding

| ID | Status | Evidence / implementation |
|---|---|---|
| LQ-001 | **Fixed** | Stable `entryId` identity (`playlistId::entryId`, API item ID or synthetic `videoId#occurrence`), legacy alias migration, duplicate occurrence pairing, per-playlist reconciliation, mismatch flagged `orphaned` with review reason. Tests: `identity.test.ts`, `store-integrity.test.tsx`. |
| LQ-002 | **Fixed** | Version-3 backup validator checks IDs, timestamps, cross-references, collection caps, positions, durations, enums, and settings; full-restore semantics; single-transaction `kvReplaceAll` with rollback; React state updated only after commit; pre-restore download offered. Tests: `backup.test.ts`. |
| LQ-003 | **Fixed** | Focus is a deterministic state machine with real `startedAtMs`, active/paused intervals, wall-clock elapsed time, visibility auto-pause, recovery-as-paused, duplicate-finish guard, and `clientId` idempotency. Tests: `focus-timer.test.ts`. |
| LQ-004 | **Fixed** | Verified coverage only consumes `source === 'verified'` segments; manual entries remain manual; Focus corrections are `estimated`; UI/CSV labels agree. Tests: `regression-domain.test.ts`, `time-correctness.test.ts`, History/Analytics/Efficiency suites. |
| LQ-005 | **Fixed** | Completion toggles patch status/completion/source/timestamp only; notes, confidence, questions, concepts, flags, revision date, and revision history survive unmark/reload/re-mark. Test: `store-integrity.test.tsx`. |
| LQ-006 | **Fixed** | Preference/settings validation rejects empty, zero, negative, non-finite, fractional, and out-of-range values at UI and restore boundaries; `AppErrorBoundary` and IndexedDB failure screen prevent blank-screen loss. Tests: `numeric-fields.test.tsx`, `backup.test.ts`, `regression-domain.test.ts`. |
| LQ-007 | **Fixed** | Snapshot import/restore require contiguous positions 1..N, safe counts, finite non-negative durations, valid timestamps/IDs, supported versions, entry caps, and non-empty playlists; duplicate video IDs remain allowed. Tests: `backup.test.ts`, `regression-domain.test.ts`. |
| LQ-008 | **Fixed** | Backend canonicalizes URL/bare playlist IDs before cache keys; URL and ID requests share one cache entry. Test: `hardening.test.ts`. |
| LQ-009 | **Fixed** | History filters apply to rows, totals, per-video detail, and session lists; all-time figures are explicitly labeled. |
| LQ-010 | **Fixed** | `isProgressComplete` is the single completion predicate; CSV, counts, filters, Dashboard, and labels no longer treat key presence as done. Tests: `identity.test.ts`, exports/UI suites. |
| LQ-011 | **Fixed** | Arena percentile/rank handling uses eligible scored competitors and keeps provisional competitors out of scored denominators. Test: `arena.test.ts` plus domain regression. |
| LQ-012 | **Fixed** | Efficiency trend eligibility requires real observations, not zero-filled fixed arrays. Test: `fair-efficiency.test.ts`. |
| LQ-013 | **Fixed** | Open-ended goals ignore events before `createdAt`; due-today goals retain their calendar scope. Test: `regression-domain.test.ts`. |
| LQ-014 | **Fixed** | Upstream 401/403 auth/quota failures are non-retryable; 429/5xx/timeouts keep bounded retry behavior. Tests: `youtube-hardening.test.ts`, `api-efficiency.test.ts`. |
| LQ-015 | **Fixed** | `trust proxy` is set from validated `TRUST_PROXY_HOPS`; the client IP is the trusted rightmost hop; spoofed left-most XFF entries do not mint buckets. Test: `hardening.test.ts`. |
| LQ-016 | **Fixed** | Unresolved reasons use observed placeholder text only (`deleted`, `private`, `notFound`, `regionRestricted`, `missingDuration`, `unknown`); no cause is invented. Test: `youtube-hardening.test.ts`. |
| LQ-017 | **Fixed** | “Refresh active” always targets `activeId`; Add/import uses its own input. Reports UI no longer refreshes based on unrelated text. |
| LQ-018 | **Fixed** | Playback attribution is centralized in `splitPlaybackSegmentByDay`/`attributePlaybackByDay`, splits at local midnight, and unions unique coverage with stable segment keys. Test: `time-correctness.test.ts`. |
| LQ-019 | **Fixed** | Focus goals, Dashboard, Analytics, Efficiency, streaks, History, and Arena use the same timezone-aware day context, including `local` → device IANA. Tests: `timezones.test.ts`, `time-correctness.test.ts`. |
| LQ-020 | **Fixed** | Revision exercise filter only treats explicit `exerciseDone === false` as unfinished. Test: `revision-ux.test.tsx`. |
| LQ-021 | **Fixed** | `playlistRemovalPlan` cascades progress, sessions, segments, playSessions, queue, ranges, checkpoints, modules, and scoped goals, with explicit confirmation wording. Test: `regression-domain.test.ts`. |
| LQ-022 | **Fixed** | Module reordering is restricted to the selected playlist's ordered positions. Test: `modules.test.ts` / regression coverage. |
| LQ-023 | **Fixed** | Arena window/date labels use `windowLabel` in the selected timezone, not host-local formatting. Test: `arena.test.ts`. |
| LQ-024 | **Fixed** | Manual playback timeline bounds are validated against video duration; constructed timestamps use `zonedNoonMs` in the selected timezone. Tests: History/`time-correctness`. |
| LQ-025 | **Fixed** | Empty/zero-duration playlists never report 100% or “Course complete”; completion requires a non-empty denominator. Tests: `identity.test.ts`, Dashboard/Library suites. |
| LQ-026 | **Fixed** | Clear All drains pending writes, clears IndexedDB, resets prefs to defaults, dispatches the Focus cleanup event, and cannot be undone by a late debounce. Test: `store-integrity.test.tsx`. |
| LQ-027 | **Fixed** | Real flat ESLint configs added in both packages; scripts now `eslint .`; violations exit non-zero. Lockfiles updated. |
| LQ-028 | **Fixed** | README/manual/report updated; heavy tabs/charts are lazy-loaded, eliminating the >500 kB warning without an architecture rewrite. |
| LQ-029 | **Fixed** | `reducedMotion` is persisted, validated, and applied via `data-reduced-motion` and CSS; timezone, session length, break length, minimum-viable length, and threshold are all wired to behavior. |
| LQ-030 | **Fixed** | API calls use `AbortController` timeouts and abort on unmount; Player destroys the YouTube player on unmount, supports retry after IFrame failure, and finalizes only once per session. Tests: `api-client.test.tsx`, Player integration. |
| LQ-031 | **Fixed** | Smallest compatible override: `body-parser` 1.20.8 → **1.20.9**; `npm ls` confirms `express@4.22.3 → body-parser@1.20.9 overridden`. |
| LQ-032 | **Fixed** | Unauthenticated public endpoint retained by design; rate limiting, trusted-proxy handling, request-size caps, cache caps, documented deployment configuration, and upstream quota protection strengthened. No breaking auth introduced. |
| LQ-033 | **Fixed** | CSV cells beginning with `= + - @` (and control-leading variants) are prefixed with `'`; entry status uses stable identity. Frontend CSP was evaluated and intentionally not deployed (see §14); backend JSON CSP is strict; localStorage privacy is disclosed in Settings/manual. |
| LQ-034 | **Fixed** | `intEnv` rejects NaN, Infinity, fractions, and out-of-range values with startup errors; `TRUST_PROXY_HOPS` added. Test: `hardening.test.ts`. |
| LQ-035 | **Fixed** | Reported count is validated, capped pre-flight before paging/batching, snapshot version is 2, empty playlists are explicit, and canonical cache keys prevent duplicate work. Test: `youtube-hardening.test.ts`. |
| LQ-036 | **Fixed** | 60 regression tests added across identity, backup/restore, Focus, numeric fields, Revision, store integrity, domain invariants, backend hardening, and YouTube classification. |
| LQ-037 | **Fixed** | Mobile drawer has focus entry, trap, inert background, Escape close, focus restoration, and labeled dialog semantics; structural Escape test added. |
| LQ-038 | **Fixed** | Dropdown supports open keys, arrows/Home/End, Enter/Space selection, Escape, Tab close, selected/active state, and listbox semantics; keyboard tests pass. |
| LQ-039 | **Fixed** | `local` resolves through `deviceTimeZone()` to a validated IANA zone; free-text zones are validated; all views use the same resolved zone. Tests: `timezones.test.ts`, `time-correctness.test.ts`. |

---

## 4. Newly discovered bugs and severity

These are defects found beyond the supplied list. Several overlapped with an LQ item but required a distinct root-cause fix.

| ID | Severity | Defect | Resolution |
|---|---|---|---|
| N-01 | **High** | Refreshing one playlist reconciled all playlists, so a refresh could orphan another course's valid progress. | Reconciliation is scoped to the refreshed playlist; test `store-integrity.test.tsx`. |
| N-02 | **High** | A debounced write could execute after Clear All or restore and resurrect old state. | All writes are serialized behind `writeChain`; destructive operations await the chain. |
| N-03 | **High** | An IndexedDB **read** failure was treated as an empty database, allowing defaults to overwrite real data. | Store exposes a load-error state; UI shows retry and never initializes/persists defaults until a successful read. |
| N-04 | **High** | Manual Focus correction was presented as verified/observed time. | Correction creates an `estimated` session with proportional wall-clock attribution and no fake intervals. |
| N-05 | **High** | `kvReplaceAll` could commit the clear and earlier writes if a later value failed structured clone, losing the old database. | Catch aborts the transaction, awaits rollback, and rethrows; test `backup.test.ts`. |
| N-06 | **Medium** | CSV per-video status looked up progress by position, not stable entry identity. | Status uses `entryKey`; test coverage in export/regression suites. |
| N-07 | **Medium** | Revision queue included any completed lesson and treated `revisionDoneAt` as a queue signal. | Queue membership now requires a real review signal (flag, low confidence, revision date, questions, explicit unfinished exercise). |
| N-08 | **Medium** | Rate limiter was a module singleton, capturing `RATE_LIMIT_PER_MIN` at import and sharing buckets across app instances. | `createApiLimiter()` per app reads validated config at composition; hardening tests pass. |
| N-09 | **Medium** | Backup validation accepted empty entry titles. | Entry titles must be non-empty and ≤500 chars; regression test in `backup.test.ts`. |
| N-10 | **Low** | `NumberField` rendered error/hint text inside `<label>`, changing the input's accessible name to “Target Enter a number.” | Label now uses `htmlFor`; error/hint are siblings, preserving a stable accessible name. Test `numeric-fields.test.tsx`. |
| N-11 | **Medium** | Playlist removal confirmation understated the cascade while dependent records survived. | Explicit cascade + updated confirmation and manual wording. |
| N-12 | **Low** | The direct-mode rate-limit test logs an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation warning when a spoofed header is present with `TRUST_PROXY_HOPS=0`. | Behavior is correct (header ignored, shared socket bucket); warning left visible rather than suppressing a genuine misconfiguration signal. |

No known regression introduced by the implementation remains; the full suites pass.

---

## 5. Root causes and implementation choices

### 5.1 Progress identity (LQ-001, LQ-010, LQ-021)

**Root cause:** records were keyed/looked up by `playlistId::position`; a reorder silently moved completion to another video, and reconciliation ran globally.

**Choice:** `entryId` is the canonical occurrence identity. API playlist-item IDs are used when present; otherwise a deterministic `videoId#occurrence` preserves duplicate occurrences. Keys are `playlistId::entryId`. Legacy position keys and records with only `videoId` remain readable. On load/refresh, records are matched by entry ID, then guarded legacy position only when `videoId` agrees; an explicit mismatch becomes `orphaned: true` with `reviewReason`. Annotations are copied to the new alias rather than discarded. Reconciliation is per playlist. `isProgressComplete` requires a real completion timestamp, `status === 'done'`, not orphaned, and a non-empty playlist denominator.

### 5.2 Backup and persistence (LQ-002, LQ-026, N-02, N-03, N-05)

**Root cause:** restore parsed loose JSON, merged keys, and wrote sequentially; reads conflated failure with emptiness; debounced writes escaped clear/restore ordering.

**Choice:** backup schema **v3** (`validateBackup`, `buildBackup`) stages a complete `BackupState`; v1/v2 remain accepted. Cross-references, collection caps, timestamps, IDs, enums, preferences, and nested records are validated before any write. `kvReplaceAll` clears and writes in one transaction; any failure aborts and restores the previous state. React state is applied after commit only. Reports offers a pre-restore JSON download and two-step confirmation. `writeChain` serializes writes; Clear All/restore await it. Read errors produce a retry screen.

### 5.3 Focus (LQ-003, N-04)

**Root cause:** start time was reconstructed from accumulated active seconds; pauses were not represented, reloads lost the session, and repeated actions could double-save.

**Choice:** a pure timer state machine stores `startedAtMs`, segment start, paused-at, accumulated active time, and active/paused intervals. Active time excludes pauses; wall time includes them. Hidden tabs auto-pause. Persisted state is recovered **paused at the last saved tick**, never counting closed-tab time. `finishFocus` returns null for idle/finished states; `clientId` is the session/XP idempotency key. Manual correction is labeled `estimated`, uses proportional day attribution, and does not masquerade as verified evidence.

### 5.4 Evidence provenance (LQ-004)

**Root cause:** verified coverage accepted all segments, and manual records could receive verified labels.

**Choice:** only `source === 'verified'` contributes to verified coverage; manual/estimated sessions are separate. Status labels derive from stored evidence. Unique timeline coverage is an interval union, not a sum, so rewatches and overlaps do not inflate verified progress.

### 5.5 Time and attribution (LQ-018, LQ-019, LQ-023, LQ-024, LQ-039)

**Root cause:** `local` was passed into `Intl` paths that silently fell back to UTC; playback and Focus were attributed to a single day; Arena labels used host locale; manual playback dates used host time.

**Choice:** `deviceTimeZone()` resolves `local` once to a validated IANA zone. `dateKeyInTimezone`, calendar arithmetic, `splitPlaybackSegmentByDay`, `attributePlaybackByDay`, `attributeFocusByDay`, and `zonedNoonMs` provide one day-attribution model. DST-short/long days, cross-midnight intervals, and segment identity keys are covered by tests. History totals, Analytics, Efficiency, Competition, Dashboard, streaks, and goals use the same context.

### 5.6 Revision (LQ-020 + UX)

**Root cause:** queue criteria conflated completion/revision history with review need; controls scrolled out of view; no direct navigation.

**Choice:** the queue is based on actual review signals. The toolbar is sticky below the app header, has one find field (pure numeric → position; otherwise title search), supports Enter, scrolls with a sticky offset, highlights and focuses the card, reports filtered counts, clears a hiding filter with an explanation, and shows inline errors for missing targets. See §8.

### 5.7 Numeric inputs (spec §6 + N-10)

**Root cause:** numeric state was rendered directly, so committed strings with leading zeros survived; validation was inconsistent; error text inside labels changed accessible names.

**Choice:** reusable `NumberField` keeps free-form text while editing, commits valid live values where appropriate, normalizes on blur/Enter, preserves empty-while-editing, supports integer/decimal and min/max, rejects invalid values with inline messages, reverts on Escape, and uses `live={false}` for navigation. See §9.

### 5.8 Backend, security, and quality gates (LQ-008, LQ-014–016, LQ-027, LQ-031–035)

**Root cause:** module-level env parsing, missing proxy trust, non-canonical cache keys, broad auth retry behavior, no pre-flight cap, ineffective lint, and an outdated body-parser.

**Choice:** validated getter-based env; `TRUST_PROXY_HOPS`; per-app limiter; canonical playlist ID schema; 401/403 non-retryable; bounded 429/5xx retry; `reportedCount` pre-flight cap; observed-only unresolved reasons; snapshot v2; strict JSON CSP/helmet; `body-parser@1.20.9` override; real ESLint configs. See §11.

---

## 6. Files changed and why

### New source/domain files

| Path | Purpose |
|---|---|
| `frontend/src/domain/progress/identity.ts` | Entry keys, legacy migration, duplicate pairing, per-playlist reconciliation, completion predicate, snapshot normalization. |
| `frontend/src/domain/focus/focus.ts` | Timer state machine, recovery, interval sanitization, finish idempotency. |
| `frontend/src/domain/settings/preferences.ts` | Preference defaults, sanitization, patch validation. |
| `frontend/src/domain/playlist/playlistOps.ts` | Explicit playlist-removal cascade plan. |
| `frontend/src/services/persistence/backup.ts` | Version-3 backup builder and complete validator. |
| `frontend/src/components/ui/NumberField.tsx` | Accessible numeric input with commit-boundary normalization. |
| `frontend/eslint.config.js`, `backend/eslint.config.js` | Real flat ESLint configurations. |

### Modified groups

| Group | Files | Reason |
|---|---|---|
| Store/persistence | `frontend/src/app/store.tsx`, `frontend/src/services/persistence/db.ts`, `frontend/src/main.tsx` | Identity migration, load-error state, write serialization, atomic restore, Clear All, provider wiring. |
| Domain | `frontend/src/domain/{index,progress/progress,progress/gamification,competition/competition,efficiency/efficiency,playback/playback,revision/revision,time/time,time/timezones}.ts` | Completion predicate, Arena math, trend eligibility, day splitting, Focus signal, timezone resolution, goal boundaries. |
| Player/export/API | `frontend/src/features/player/Player.tsx`, `frontend/src/services/{api/playlistApi,exports/imports}.ts` | Verified-only evidence, lifecycle cleanup/retry, timeouts/cancel, snapshot validation, CSV hardening/identity. |
| UI features | Analytics, Checkpoints, Competition, Dashboard, Efficiency, Focus, Goals, History, Modules, Library, Reports, Revision, Settings | Timezone/identity correctness, range scoping, estimated labels, cascade wording, revision UX, numeric fields, accessibility. |
| Shell/UI | `frontend/src/app/App.tsx`, `frontend/src/components/ui/Dropdown.tsx`, `frontend/src/styles/index.css`, `frontend/src/types/index.ts` | Lazy tabs, error boundary, read-error screen, drawer focus/inert, header CSS variable, reduced motion, dropdown keyboard, types. |
| Backend | `backend/src/{app,config/env,middleware/rateLimit,schemas/playlistSchemas,services/youtube/youtubeService}.ts` | Proxy-aware limiting, validated env, canonical IDs, error classification, pre-flight cap, reasons, snapshot version, helmet/CSP. |
| Manifests/lockfiles | `frontend/package*.json`, `backend/package*.json` | ESLint toolchain, scripts, body-parser override, synchronized locks. |
| Docs/config | `README.md`, `HOW_TO_USE_LEARNQUEST.md`, `backend/.env.example`, `render.yaml` | Current tests/lint/build, backup v3, Focus recovery, Revision UX, removal cascade, `TRUST_PROXY_HOPS`. |

### New tests

- `frontend/tests/identity.test.ts` (7)
- `frontend/tests/backup.test.ts` (10)
- `frontend/tests/focus-timer.test.ts` (7)
- `frontend/tests/numeric-fields.test.tsx` (8)
- `frontend/tests/revision-ux.test.tsx` (7)
- `frontend/tests/store-integrity.test.tsx` (5)
- `frontend/tests/regression-domain.test.ts` (8)
- `backend/tests/hardening.test.ts` (5)
- `backend/tests/youtube-hardening.test.ts` (3)

60 tests were added in total: 52 frontend and 8 backend.

---

## 7. Migration, backup, and backwards compatibility

- **IndexedDB schema:** remains version **2**; no destructive upgrade. Existing keys are preserved.
- **Snapshot schema:** new snapshots are version **2**. Legacy snapshots are normalized through `normalizeSnapshotIdentity`; entry IDs are synthesized only when absent. Duplicate video occurrences remain distinct.
- **Progress migration:** legacy position keys are retained as aliases. On load/update, the store creates the canonical `playlistId::entryId` record with preserved annotations, and later operations use the canonical key. A legacy record is matched by position only when `videoId` agrees; otherwise it is marked orphaned for review, not transferred.
- **Duplicate video IDs:** paired by occurrence order with synthetic `videoId#occurrence`, so two intentionally repeated videos do not share completion state.
- **Backup:** schema **v3**; `validateBackup` accepts v1/v2 and fills omitted collections with explicit defaults (full restore, never merge). Omitted collections intentionally clear those collections in the staged state. Future versions are rejected. A pre-restore download is offered before commit.
- **Focus/session history:** sessions gain optional `clientId`, `intervals`, and `estimated`; old sessions without intervals remain displayable. No historical timestamps are rewritten.
- **Playlist removal:** cascade plan deletes only the selected playlist's dependent records; other playlists and global goals are unaffected. Clear All deletes everything and resets preferences.
- **Real user data:** no real browser database, `.env`, or YouTube API was touched during verification. Migration behavior was exercised with `fake-indexeddb` fixtures and unit tests only.

---

## 8. Revision navigation and filter UX

### Implemented behavior

- **Sticky compact toolbar** directly below the app header using `--lq-mobile-header-h`; no nested scroll container and no viewport-covering panel.
- **One find field** labeled “Find lesson by position or title”:
  - pure digits (including leading zeros) are treated as playlist positions;
  - other text searches titles case-insensitively;
  - **Enter** performs the same action as **Jump**.
- **Successful jump:** scrolls the card beneath the sticky header with `scroll-margin-top`, applies a temporary highlight, focuses the card, and preserves filters when possible.
- **Filter-blocked target:** explains which filter hid the lesson and clears that filter; the result count updates.
- **Invalid target:** inline messages for a nonexistent position or unmatched title; optional “Flag it now” when a lesson exists but is not queued.
- **Filters:** all / low confidence / open exercises / questions / overdue, with visible “N of M queued lessons” counts. Missing `exerciseDone` is not treated as false. `revisionDoneAt` alone does not keep an item queued.
- **Review action:** marking revised records the review, updates the queue, preserves annotations, and uses deduplicated XP keys.
- **Reduced motion:** jump scrolling uses `auto` when the preference is enabled.

### Validation

`revision-ux.test.tsx` covers title search, numeric position (including `002`), Enter, invalid/missing targets, filter counts, filter-clearing navigation, flag-from-message, annotation persistence, queue removal, sticky positioning, and absence of a nested scroll area. The sticky test asserts the toolbar's top offset and no `.overflow-y-auto` container; it is a jsdom structural check, not a pixel-level browser measurement.

---

## 9. Numeric input normalization

### Behavior

`NumberField`:

- displays canonical numbers from state;
- allows free-form text while focused (including empty and leading zeros);
- commits valid values live by default, or only on blur/Enter with `live={false}`;
- normalizes `019` → `19`, `000` → `0` where zero is valid, `02.50` → `2.5` for decimal fields;
- preserves an empty field while editing and never coerces it to zero;
- rejects empty required, non-numeric, non-finite, fractional-for-integer, below-min, and above-max values with inline messages;
- restores the committed value on Escape;
- uses `inputMode` appropriate to integer/decimal entry;
- exposes a stable accessible label (`htmlFor`), with errors/hints outside the label.

Applied across Settings (session/break/minimum-viable lengths), Focus targets/correction, Library ranges, Checkpoints, Goals, Modules, Competition settings, and the Player jump field. IDs, dates, times, thumbnails, and other leading-zero-significant strings are untouched.

### Validation

`numeric-fields.test.tsx` covers leading zeros, empty editing, zero, negatives, min/max, integer vs decimal, live vs commit-only navigation, Escape, and a real Library screen that recalculates the total after `02` normalizes to `2`. Store/backup tests ensure invalid values never reach persistence.

---

## 10. Focus workflow, timestamp model, and tests

### Model

- `startedAtMs` and `finishedAtMs` are real wall-clock anchors.
- `activeAccumMs` plus active intervals determine focused seconds.
- Paused intervals preserve wall-clock elapsed time without adding focus time.
- `wallMs` includes pauses; `activeMs` excludes them.
- Hiding the tab pauses automatically; returning requires an explicit resume.
- A persisted running timer is recovered **paused at its last saved tick**; closed-tab time is never counted.
- A manual correction replaces active seconds, is labeled `estimated`, and uses proportional day attribution rather than fabricated observed intervals.
- `finishFocus` returns null for idle/finished states; `finish` is guarded by a ref and the session `clientId` deduplicates persistence/XP.
- Sessions under 10 focused seconds are discarded with a notice.
- Cross-midnight Focus and playback split through the timezone-aware day-attribution helpers.

### Tests

`focus-timer.test.ts` covers start, pause, resume, repeated pause/resume, finish, duplicate finish, recovery from running/paused state, invalid state sanitization, and minimum duration. `time-correctness.test.ts` covers cross-midnight attribution, DST days, timezone changes, and streak behavior. History/Analytics/Efficiency tests confirm estimated/manual labels and totals agree.

---

## 11. Backend, security, dependency, and environment changes

### Backend

- `intEnv` validates numeric environment variables at read time; `TRUST_PROXY_HOPS` defaults to 1.
- `createApiLimiter()` is created per app, reading the validated limit at composition; proxy trust is configured from `TRUST_PROXY_HOPS`.
- Playlist query canonicalization produces one cache key for URL and bare-ID requests.
- Upstream 401/403 (auth/quota) are non-retryable; retryable transient/429/5xx paths remain bounded.
- `reportedCount` is checked against the 1000-entry cap before paging/batching; empty playlists return an explicit empty snapshot.
- Unresolved reasons are assigned only from observed placeholder evidence.
- Snapshots report `snapshotVersion: 2`.
- Helmet uses a strict JSON-only CSP (`default-src 'none'`, no framing, no form actions) and removes `x-powered-by`.

### Security

- CSV formula injection is neutralized in `toCsv`.
- Frontend API calls have timeouts and cancellation; Player resources are destroyed on unmount.
- The public endpoint remains unauthenticated by design (local-first product), with rate limiting, proxy trust, request-size limits, cache caps, and quota protection. No breaking auth was introduced.
- Frontend CSP was evaluated but not deployed; see §14.

### Dependency changes

- Added `eslint@^10`, `@eslint/js@^10`, `typescript-eslint@^8`, `globals@^16`, and `eslint-plugin-react-hooks@^7` (frontend).
- Added `body-parser@1.20.9` as a backend override; resolved tree confirms `express@4.22.3 → body-parser@1.20.9 overridden`.
- Lockfiles synchronized with `npm install`.

### Audit result

Both packages report **6 vulnerabilities: 3 moderate, 1 high, 2 critical**, all in the **dev-only Vitest/Vite toolchain** (`vitest`, `@vitest/mocker`, `vite`, `vite-node`, `tinypool`, `esbuild`). The production `body-parser` high advisory is gone. The available fix is Vitest 5 (semver-major); it was not applied because it is unrelated to the reported production defect and would be an indiscriminate test-toolchain upgrade. Mitigation: these tools are not shipped in the deployed bundle and are run only in development/CI.

### Environment files

- **No `.env` file was created or modified.** `backend/.env` was not printed or altered.
- `backend/.env.example` now documents `TRUST_PROXY_HOPS=1`.
- `render.yaml` now sets `TRUST_PROXY_HOPS=1` explicitly.
- No secret was invented or exposed.

---

## 12. Tests, lint, typecheck, builds, and audit — actual outcomes

### Commands and results (final run)

| Command | Directory | Result |
|---|---|---|
| `npm test -- --run` | `frontend` | **226 passed / 226**, 23 files, 29.02 s |
| `npm test -- --run` | `backend` | **26 passed / 26**, 6 files, 4.86 s |
| `npm run typecheck` | `frontend` | Passed |
| `npm run typecheck` | `backend` | Passed |
| `npm run lint` | `frontend` | Passed: 0 errors, 11 warnings |
| `npm run lint` | `backend` | Passed: 0 errors, 10 warnings |
| `npm run build` | `frontend` | Passed: 2241 modules, 6.17 s |
| `npm run build` | `backend` | `tsc` passed (no runtime bundle) |
| `npm audit` | both | 6 dev-chain advisories each; no production high remains |

### Build output

- `index.html` 0.65 kB (gzip 0.40 kB)
- CSS 40.34 kB (gzip 7.54 kB)
- Main `index` chunk 312.06 kB (gzip 97.04 kB)
- Largest chart chunk 385.17 kB (gzip 106.41 kB)
- Heavy tabs split into 7–27 kB chunks (Focus, Revision, Reports, Library, History, Analytics, Competition, Efficiency, Dashboard)
- No >500 kB warning.

### Lint warnings (non-failing)

Frontend (11): exhaustive-deps notes in TimezonePicker, Analytics, Competition, Efficiency, History; unused disable directives in Focus, Player, and scale test.

Backend (10): `no-explicit-any` in errors/YouTube service; unused disable directives in server and cache test.

These are warnings, not suppressed errors; the scripts now exit nonzero on real violations.

### Test-environment noise (not failures)

- jsdom logs `window.scrollTo` not implemented in an existing navigation test; Revision tests stub it.
- Recharts logs width/height 0 in jsdom chart containers.
- The direct-mode rate-limit test logs the expected express-rate-limit XFF validation warning described in N-12.

### Dependency audit exact output

`npm ls body-parser` → `express@4.22.3 → body-parser@1.20.9 overridden`.  
`npm audit` → 0 info, 0 low, 3 moderate, 1 high, 2 critical, total 6 in each package, all dev-toolchain.

---

## 13. Responsive, keyboard, accessibility, and browser checks actually completed

### Automated (jsdom) checks

- Mobile drawer opens, closes with Escape, and existing navigation tests pass (`ui-controls.test.tsx`).
- Dropdown keyboard: ArrowDown opens/moves, Enter selects, Escape cancels; selected/active state and listbox semantics (`charts.test.tsx`).
- Revision sticky toolbar exists, uses the header offset, and has no nested vertical scroll container (`revision-ux.test.tsx`).
- Empty/invalid numeric fields, Escape revert, and inline error association (`numeric-fields.test.tsx`).
- No horizontal nav scroll pattern in the shared shell test.
- Focus/Player/History logic is exercised through component/store tests with fake timers and seeded IndexedDB.

### Implementation inspected but not browser-automated

- Drawer focus entry, focus trap, inert background, and focus restoration.
- Player teardown and IFrame retry.
- Reduced-motion CSS and `data-reduced-motion` application.
- Dropdown visual active-option styling.

### Not performed

- No real-browser Playwright/Cypress run (no suite or browser binary in the repo/environment).
- No screen-reader testing.
- No live YouTube API or IFrame network test.
- No real viewport/device pixel measurement; sticky/responsive claims are structural and CSS-based.
- No live storage-quota exhaustion or overnight soak.

These limitations are repeated in §14 rather than claimed as verified.

---

## 14. Remaining limitations, unverified behavior, and justified deferrals

1. **Frontend CSP not deployed.** A meta-tag CSP would affect Vite dev assets and the YouTube IFrame API, and no real-browser test environment was available. The JSON backend CSP is strict; CSV injection is fixed; localStorage privacy is disclosed. Deploying a frontend CSP should be done with a real-browser/Vercel header test. This is the only security-hardening evaluation without a deployed frontend policy.
2. **Dev-toolchain advisories remain.** Vitest/Vite/tinypool advisories require a major Vitest upgrade; they are not in the production bundle. Revisit when the test stack is upgraded deliberately.
3. **No live YouTube verification.** Error classification, retry behavior, cap pre-check, and unresolved reasons are tested with mocks/fixtures. Quota-consuming live checks were explicitly out of scope.
4. **No real browser or screen reader.** Responsive, sticky-offset, focus-trap, and IFrame-retry behavior were not measured in a real browser. The jsdom tests verify structure/keyboard logic only.
5. **No live migration of real browser data.** Migration, restore, and rollback are verified with `fake-indexeddb` fixtures. A user should still export a backup before upgrading.
6. **Concurrent tabs remain last-writer-wins.** The write chain serializes one tab; cross-tab coordination was not added.
7. **Rate-limit direct-mode warning.** With `TRUST_PROXY_HOPS=0` and a spoofed XFF header, express-rate-limit logs a validation warning even though it correctly ignores the header. It is left visible as a misconfiguration signal.
8. **Test-environment console noise.** jsdom `scrollTo` and Recharts zero-size warnings are non-failing and pre-existing/structural.
9. **Front-end CSP and localStorage scope.** The only localStorage keys are UI/recovery data; IndexedDB is the source of truth. Private browsing/storage clearing still deletes data by design.
10. **No commit/deploy.** Changes are uncommitted by instruction; production deployment was not performed.

---

## 15. Manual verification steps

1. In `frontend/` and `backend/`, run `npm install` (locks now include the new lint toolchain and body-parser override).
2. Run `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run build` in each package; expect 226/26 tests, clean typechecks, lint with warnings only, and a successful build.
3. Start both dev servers; open Reports and add/import a playlist, then refresh it after reordering entries. Confirm completions follow the same videos and any genuinely ambiguous record is flagged for review.
4. Open Revision with a long queue: scroll, type `50` or part of a title, press Enter; confirm the card is visible below the header, highlighted/focused, and filter-blocked jumps explain and clear the hiding filter.
5. Start Focus, pause/resume several times, hide the tab, and return; confirm auto-pause. Reload mid-session and confirm it recovers paused with closed-tab time excluded. Finish and verify one session/XP entry.
6. In Reports, export a v3 backup, alter a fixture, verify validation rejects it; restore a valid backup and confirm the pre-restore download and all-or-nothing behavior.
7. Remove a test playlist and confirm progress, sessions, playback evidence, ranges, checkpoints, modules, queue entries, and scoped goals disappear while another playlist is untouched. Then test Clear All on disposable data and confirm preferences reset.
8. On a narrow viewport, open the drawer and dropdown with keyboard only; verify focus trap, Escape, focus restoration, arrow navigation, and Enter selection.

---

## 16. Final Git status and change summary

- Branch remains **`main`**; HEAD remains **`d9f3dc7`**.
- No commit, push, branch change, stash, reset, clean, or destructive checkout was performed.
- **45 tracked files modified**, including 2 lockfiles, README, user manual, `render.yaml`, and `backend/.env.example`.
- **20 untracked paths** at report time: the new report, 7 new frontend test files, 2 new backend test files, 2 ESLint configs, 6 new source/domain files/directories (`NumberField`, `focus/`, `playlistOps`, `identity`, `settings/`, `backup`), and the 2 preserved prompt files.
- Pre-existing untracked user files `learnquest-audit-prompt.txt` and `learnquest-fix-prompt.txt` remain untouched.
- No `.env` file was created or modified.
- All new and modified code is uncommitted by instruction.

**Final status:** implementation complete; all supplied findings addressed; all executable gates green; residual limitations documented above.
