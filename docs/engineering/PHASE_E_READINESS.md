# LearnQuest — Phase E Status

Phase E = **Learning Workflow & Product Experience Modernization** (dashboard → player → records → goals continuity).
Phase E was implemented and verified 2026-11-13 and is committed as `67e01e0` on top of `0bcfd91` (see `PHASE_E_WORKFLOW.md` for the evidence report). No source changes under the chart engine, Arena, auth, or storage.

## What landed, mapped to the opportunity list

- **P1 — Dashboard Resume → Player.** The CTA navigates to `#/player` at the correct
  occurrence; explicitly untracked secondary "Open on YouTube" retained; completed
  playlists offer "Review from lesson #1".
- **P2 — Preferences consolidated.** Settings is the canonical place for learning
  preferences; Reports slimmed to export/backup/restore + playlists table + orphan review;
  XP-rules disclosure moved to Settings; Clear cached metadata / Clear ALL learning data
  moved into Settings → Data & privacy with unchanged safeguards.
- **P3 — Canonical add in Library.** URL fetch + JSON snapshot import in one shared
  `AddPlaylist` component; Onboarding reuses it; Reports links to it.
- **P4 — Goals + Focus integration.** Goals shows "Today's focus goal" synced with Focus
  (both directions) above flexible goals — data models untouched.
- **P5 — Orphan discoverability.** Library and Dashboard count + "Review playlist
  changes" link focus the Reports review section.
- **P6 — Record access.** Player aside gains a live summary + Open/Hide collapse in place
  (focus-managed); editor state persists across collapse and occurrence switches.
- **P7 — Range → checkpoint.** Library range explorer and Checkpoints page prefill the
  New-checkpoint form; nothing is created without explicit confirmation.
- **P8 — Actionable empty states** across Dashboard, Library, Goals, Checkpoints, Modules.
- **P9 — Copy/heading consistency** on touched screens.

## Defects found and fixed in Phase E

- buildEntryProgressIndex matched records by occurrence-order before direct identity —
  a record stored under `<pid>::<entryId>` for occurrence 2 was re-matched to occurrence 1.
  Matching is now two-phase (direct identity → legacy position keys → occurrence pairing).
- **EXPORT-1** fixed in isolation (account-export manifest now names the real archive entry).
- Chromium harnesses updated for the collapsed record editor (open-before-measure) and for
  strict-mode selector collisions; the compass dock opens via keyboard activation; the
  chart overflow probe is event-driven.

## Interim verification (all on this host)

- Frontend Vitest **528 passed**; backend Vitest **257 passed** (+3 Mongo suites skipped).
- Baseline browser fixtures **35/35 pass, twice consecutively** (Chromium `LQ_BROWSER_EXECUTABLE`).
- Arena Chromium suite **7/7**.
- Typecheck clean; lint 0 errors; frontend + backend builds pass; EXPORT-1 regression now green.
- Known-flaky paths treated per the ×3-greens policy; the baseline now passes twice in a row.

## Non-goals (unchanged)

Chart engine, Arena (v2 compat + v3 ledger), verification semantics, compass navigation,
auth/session/CSRF, cloud merge, Mongo storage adapters, migration tooling, XP ledger.

## Phase G / H prerequisites (unchanged)

- `docs/user-doc/MIGRATION_RUNBOOK.md` and `MIGRATION_ROLLBACK.md` remain **missing**
  (deleted in `7391d9c`); restore from history only with owner approval.
- No production migration is authorized.
- `HOW_TO_USE_LEARNQUEST.md` was updated for Phase E flows (and stale Arena v2 wording was
  corrected to the v3 scoring semantics).
- Re-run `graphify update .` after these source changes (AST-only).
