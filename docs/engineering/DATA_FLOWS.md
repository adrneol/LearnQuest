# LearnQuest — Critical Data Flows

How evidence moves through the system, end to end. Each flow lists the owning files, the data
contract, and the integrity rules. Read `PROJECT_KNOWLEDGE.md` first. All paths verified
2026-11-13 at `aabeed8`.

## 1. Playlist import & refresh

`store.addSnapshot(snapshot)` → normalize occurrence identity → IndexedDB (local) or
`PUT/POST /api/account/data` (cloud, versioned) → selectors in screens.

- Sources: YouTube via `GET /api/playlists` (server-side API key) or JSON snapshot import (client-side `parseImportFile`), `frontend/src/features/reports/Reports.tsx`, `frontend/src/features/playlists/Playlists.tsx` (Onboarding).
- After a refresh, snapshot entries are re-keyed by **occurrence identity** (`domain/progress/identity.ts::normalizeSnapshotIdentity`); added/removed/moved entries can mark ranges/checkpoints `needsReview` — boundaries are **preserved** until the user confirms.
- Unresolved durations (deleted/private videos) stay `null`; totals labeled incomplete.
- 1000-entry production import cap; unresolved entries block Arena runs (see flow 7).
- Identity rule: `entryId` is stable per occurrence. Duplicate `videoId`s are distinct occurrences; a re-inserted duplicate never inherits another occurrence's progress.

## 2. Player → playback evidence → verified completion

`Player.tsx` → `verifiedSegmentsFor()` (identity-scoped) → `summarizeVerifiedSegments()`
→ `completionFromCoverage(uniqueSec, durationSec, { threshold: 0.9 })`

- Segments (`PlaybackSegment`) are written via `s.addSegments([seg])` on PAUSED/BUFFERING/ENDED/seek; sought spans are never credited (2.5 s jump detection at 2 Hz poll).
- `PlaySession` (active playback, unique gain, content sec, pause sec, note) is written on ENDED/finalize; XP awarded once per dedup key.
- Verified completion requires **player-observed evidence** at the configured threshold; manual completion is a separate state (`status: done`, `source: manual`); self-reported entries (History) are separate again. Labels must not be swapped.
- `PlayerLearningRecord` (`features/player/LearningRecordEditor.tsx`) edits **annotations only** (notes, concepts, questions, exercises, revision date/flags) — never completion/telemetry. Debounced save (900 ms), flush on hidden/pagehide/unmount, identity-keyed so navigation never misattributes a draft.

## 3. Focus → sessions → analytics

`Focus.tsx` (timer) → `domain/focus/focus.ts` (`startFocus/pauseFocus/finishFocus`) → `s.sessions`
→ `attributeFocusByDay` → `Analytics.tsx` / `Efficiency.tsx` / `Dashboard.tsx`.

- Active intervals only; pauses, closed tabs, sleep gaps excluded (monotonic+wall checks); gaps >1 min need review; estimated (manual-correction) sessions are recorded as such and never presented as verified playback.
- `Efficiency` = **aggregate unique content ÷ focused time** (a ratio of recorded values, not learning quality). Keep the label and tooltip honest.
- Analytics attributes by **wall-clock intervals split at timezone/DST boundaries** (`domain/time/time.ts`), not naive `Date` slicing.

## 4. Revision & learning-record lifecycle

`Mark reviewed` (Player editor or Revision page) → `s.markReviewed(...)` → record updated: current
flag cleared, review appended to `reviewHistory` (dated, source-tagged) — notes/confidence/history
**preserved**; XP `rev:<playlistId>:<entryId>` deduped per occurrence.

- Revision page (`features/revision/Revision.tsx`) groups by queue/all-lessons, jump/flag tools, sticky toolbar; `PlayerLearningRecord` shows the same record with a "reviewed" chip and history.
- Cross-references: `domain/revision/revision.ts` (`lastReviewIso`, `ReviewPatchResult`, filter helpers); `RevisionCard` in `Revision.tsx:440`; both paths call the same store actions.

## 5. Checkpoints, modules, ranges, goals

- **Checkpoint**: `saveCheckpoint({ playlistId, label, start, end })`; one inclusive range; `needsReview` on refresh; progress = `computeRangeProgress` (count + duration when resolved).
- **Modules**: ordered groups of lessons per playlist; move/rename/delete; completion counts via shared progress index.
- **Saved ranges**: created in Library (`saveRange`), listed in Dashboard/Checkpoints; independent of checkpoints (a checkpoint can be seeded manually from a saved range today — see PHASE_E_READINESS P7).
- **Goals (two systems, do not merge without approval)**:
  1. Daily focus goal by `dateKey` (`s.goals[today]`) — set in `Focus.tsx`, shown on Dashboard; `minViableSec` floor.
  2. Flexible goals (`s.flexGoals`, `Goals.tsx`) — video-count / unique-content / focus / playback / checkpoint metrics, optional playlist scope and `Due today` date, pause/resume/achieved status; progress via `goalCurrentValue` + `goalProgress`.

## 6. Authentication → session state (backend → frontend)

- Google OAuth (only registration path) → server-side session (`backend/src/auth/sessions.ts`) → cookie `__Host-lq_session` (prod; `Secure`, `HttpOnly`, `SameSite=Lax`) → `requireAuth` revalidates per request (sliding idle renewal bounded by absolute expiry).
- Same-origin `/api/*` only; CSP `connect-src 'self'`; mutations require `X-CSRF-Token` + trusted origin; session rotation on privilege change.
- Cross-tab (same profile): BroadcastChannel + storage-event sync.
- Cross-profile/device: authenticated SSE at `GET /api/auth/events` (`connectSSE` client; MongoDB capped-collection `lq_auth_events` fanout; per-account 20 streams / 1,000 per process; heartbeat 25 s; client treats 70 s silence as dead; reconnect 3→5→10→20→40→60 s). Published message: `{type:'auth-invalidated', reason:'sessions-revoked'|'password-reset'}` — no user/session identifiers.
- Client runs the canonical signed-out transition on receipt; server revocation remains authoritative.
- Password reset: single-use HMAC-digested email action tokens (purpose-bound, ~30 min TTL); reset signs out all sessions. Account deletion: resumable, verified cascade (password or fresh Google reauth + `DELETE MY ACCOUNT` phrase), reported complete only at zero remaining counts.

## 7. Arena scoring & persistence (arena v3)

`makeArenaRun(seed/setup/basis/zone)` → frozen basis `[position, entryId, videoId, durationSec][]`
→ `observeArena()` → `computeArenaUserEvidence(modelVersion='arena-v3', bounds)` →
`scoreArenaRun()` → `sealArenaResult()` → `transitionArena()` → persisted in the `challenge`
singleton's `arena` ledger.

- Rivals: independent seeded draws (`mulberry32(hashStringToUint32(...))`); cadence/pace/endurance; difficulty shifts rival traits only.
- Qualifying day (same rule for user & rivals): ≥300 s new verified coverage or a completed lesson, **and** ≥600 s focus-or-playback activity (greater of the two). Rewatches don't re-qualify; estimated/draft focus excluded.
- Board: score desc → progress → consistency → stable id; ties share a rank (1,2,2,4); unranked rows sorted by id.
- Sealing: completion stores replay artifact; mismatch → recorded rank/score kept, conflicting leaderboard suppressed.
- Ledger bounds: ≤20 history (delete-to-free-capacity), ≤90 checkpoints/run, ≤2,000 opponents (`validArenaSetup`); backup v3 round-trips it (`backup.test.ts`, `arena-runs.test.ts`); frontend and backend validators agree (`arenaValidation.ts` both trees).
- Local mode: read-update-write inside `writeChain` transaction, stale-action recheck, failure keeps existing records (`store.tsx updateArena`).
- **Legacy v2 records** (`arena-v2` model, `challenge.fixed`, `rankHistory`) remain readable; they lack the frozen evidence for exact replay and are labeled as such in the UI. v2 code stays for compatibility — do not delete without a migration plan.

## 8. Cloud synchronization (mongo ⇄ browser)

Owner: `StoreProvider` cloud mode. Read: `GET /api/account/data` → canonical envelope (never falls back to IndexedDB; `503/TIMEOUT` ≠ expired session; pending onboarding → `409 ONBOARDING_REQUIRED` → onboarding screen).

Write: optimistic local state → version-stamped push → three-way merge by **record identity** (`cloudMerge.ts`) against server state → conflicts surface for explicit keep-local/use-server per area; unrelated changes auto-merge. Failure → optimistic change stays pending with retry in the workspace header (`SyncIndicator`).

Cross-device conflict banner (`#cloud-conflicts`) lists area + count; nothing overwritten silently. `LQ_USER_DATA_STORE=legacy` is production; `unified` requires `LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1` and is fail-closed otherwise; no fallback, no dual-write.

## 9. Backup, restore, export

- **Backup JSON v3** (restore-compatible): `buildBackup`/`validateBackup`/`importBackup` (`services/persistence/backup.ts`); 20-domain state incl. Arena ledger; restore is atomic + pre-restore backup download; invalid entries fail validation with named problems.
- **Account export** (human-readable, non-restorable): `services/exports/accountExport.ts` + `zip.ts` → `LearnQuest-Account-Export/` (README, manifest, per-domain JSON, CSV reports); no secrets.
- **Known defect:** account-export manifest filename list disagrees with archive contents — `EXPORT-1` (reproduces 2026-11-13); only deferred regression.
- Browser-local IndexedDB → account import is a **separate** process from Mongo legacy→unified migration; never conflate.

## 10. Legacy → unified MongoDB adapters

`backend/src/store.ts` (interface + `USER_COLLECTIONS`, `UNIFIED_USER_DATA_COLLECTION`,
`createUnifiedDomainCollection`) → `backend/src/db/mongo.ts` (legacy/unified plumbing) +
`memoryAdapter.ts` (in-memory tests) + `adapter.ts` facade → `userData.ts` service layer.
Migration ops: `backend/src/services/userDataMigration.ts`, `migrationControl.ts` (write freeze,
draining, parity, `lq_state_versions`), `legacyRetirement.ts` (guarded retirement),
`scripts/migrateUserData.ts` / `inspectUserData.ts` / `compareMigrationReports.ts` / `retireLegacyUserData.ts`.

**No production migration or retirement is authorized.** The runbooks that gate it (`docs/user-doc/MIGRATION_RUNBOOK.md`, `MIGRATION_ROLLBACK.md`) are **missing from this tree** (deleted in `7391d9c`); restore from history requires owner approval.
