# Phase E — Learning Workflow & Product Experience Modernization

**Date:** 2026-11-13 · **Base:** `0bcfd91` (+ Phase E changes, uncommitted) · **Agent:** Principal Full-Stack Engineer / React Architect / QA Lead

Phase E makes LearnQuest's existing features work together as one continuous
learning experience. It began after Phase D was substantively verified and the
Graphify knowledge base was accepted. All Phase A–D guarantees are preserved:
chart engine, Arena v3, compass navigation, design system, auth/session
contract, cloud merge semantics, occurrence identity.

## E0 — Preparation

- Working directory verified `E:\progressGameTracker`, branch `main`, HEAD `0bcfd91`.
- Knowledge base re-read: `PROJECT_KNOWLEDGE.md`, `DATA_FLOWS.md`, `PHASE_E_READINESS.md`, `AGENTS.md`, `TESTING.md`.
- **EXPORT-1 fixed in isolation** (account-export manifest named
  `learning-data/challenge-enabled.json`, which the archive never contained →
  renamed to `learning-data/challenge-settings.json`). `npm run test:regressions`
  now green; `TESTING.md` updated; no other code touched.
- Stale knowledge-document references corrected (`domain/goals/goals.ts`,
  `domain/settings/preferences.ts`, `domain/progress/gamification.ts`;
  "6 unpushed commits" → 7). The 7 broken docs/ links remain a Phase G prerequisite (unchanged).
- Baseline verified: frontend vitest (one pre-existing host-contention failure — see below), backend 257 passed.

## Product changes (source)

- **E1 Dashboard continuity.** "Resume" is now a hash-route link to the in-app
  Player and lands on the correct occurrence (learns the same selector as the
  dashboard). External YouTube is an explicitly untracked secondary link; a
  fully completed playlist offers Review-from-lesson-#1 instead of a
  misleading Resume. Selection is shared via `computePlaylistProgress().nextPosition`.
- **Identity fix (E1-critical).** `buildEntryProgressIndex` matched records
  occurrence-order *before* direct identity matches, so a record stored under
  `<pid>::<entryId>` for occurrence 2 was stolen by occurrence 1. Matching is
  now two-phase: direct identity wins globally, then legacy position keys,
  then occurrence-order pairing. Regression coverage in `identity.test.ts`
  and `dashboard-resume.test.tsx`.
- **E2 Canonical add + consolidated preferences.** `AddPlaylist` (URL fetch +
  JSON snapshot import) is the one implementation; Library is primary and
  exposes it (button; empty state opens it), Onboarding reuses it, Reports
  links to it. Reports "Preferences" card removed; Settings is the canonical
  place for learning preferences (XP-rules disclosure added). "Clear cached
  metadata" and "Clear all learning data…" moved into Settings → Data &
  privacy with unchanged confirmation/ownership safeguards.
- **E3 Discoverability.** Orphaned records surface via a Library + Dashboard
  count banner that deep-links to Reports and focuses the review heading
  (pending-intent, hash-route safe). Empty states across Dashboard, Library,
  Goals, Checkpoints, Modules now carry one working primary action.
- **E4 Goals integration.** Goals page now shows "Today's focus goal" (same
  record as Focus, both directions) above flexible goals — two models, one
  coherent screen; nothing merged or rewritten. Focus daily-goal editor
  initializes from the stored goal (or preference when unset).
- **E5 Learning-record access.** Player aside gains a live summary (confidence,
  notes, questions/evidence, review status) and an Open/Hide record toggle; the
  editor is now collapsible in place with explicit focus movement (never a
  page jump; `hidden` keeps editor state across collapse and occurrence switches);
  the editor adds a "Hide learning record" control.
- **E6 Range → checkpoint.** Library range explorer has "Create checkpoint";
  Checkpoints page lists "Checkpoint" per saved range. Both prefill the
  New-checkpoint form (range + suggested label) and require explicit
  confirmation; nothing is created silently; source saved ranges are never
  mutated implicitly.

## NOT changed (scope discipline)

Chart engine, Arena (v2 compat + v3 ledger), compass navigation, theme system,
auth/session/CSRF/cookies, cloud three-way merge, storage adapters, Mongo
migration tooling, XP ledger semantics, verified-evidence semantics.

## Verification status (all executed on this host, 2026-11-13)

- Frontend Vitest: 64 files / **528 passed** (baseline 499 + 29 new assertions net of the
  EXPORT-1 fix green).
- Backend Vitest: 32 files / **257 passed**, 3 Mongo integration suites skipped (opt-in only).
- Browser fixtures: **baseline 35/35 pass, two consecutive runs** (Chromium `LQ_BROWSER_EXECUTABLE`);
  Phase E suite **9/9**; Arena Chromium **7/7**.
- Typecheck clean (frontend + backend). Lint 0 errors (3 frontend warnings, pre-existing;
  88 backend warnings, pre-existing). Builds pass (main chunk 493.59 kB < 500 kB warn).
- EXPORT-1 fixed and covered by `test:regressions` (green). No previously-passing test left failing.

Known flake policy: previously flaky browser paths (compass attachment, chart resize probe)
were made event-driven and pass twice consecutively here; keep the ×3-greens rule before declaring stable.

## Remaining limits (not verified)

- Visual baselines were checked in smoke mode only; `LQ_VISUAL_MODE=verify` (exact-image
  comparison vs the committed references) was not run this session — reference PNGs are
  OS/architecture scoped to the recording host.
- Chromium only; no Firefox/Safari/physical-device checks; no assistive-technology audit.
- Cloud/SSE invalidation paths exercised only through the pre-existing isolated suite;
  no live deployment was contacted (synthetic local fixtures only).
- Compass navigation, theme bootstrap, chart engine, Arena scoring — intentionally
  untested by this phase beyond the unchanged suites, which pass.
- `docs/user-doc/MIGRATION_RUNBOOK.md` and `MIGRATION_ROLLBACK.md` remain **missing**
  (deleted in `7391d9c`). Do not invent procedures; restore with owner approval
  (Phase G prerequisite).
- Graphify graph was refreshed from the working tree (`graphify update .`; report still
  stamped `0bcfd91`). AST-only; ~1% INFERRED edges; community names are placeholders.

