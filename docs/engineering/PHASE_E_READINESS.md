# LearnQuest — Phase E Readiness

Phase E = **Learning Workflow & Product Experience Modernization** (dashboard → player → records → goals continuity).
No Phase E code exists yet (2026-11-13). This document records the verified baseline and the
scoped opportunity list. All source references re-verified against `aabeed8`.

## Verified baseline (2026-11-13)

- Frontend Vitest **499 passed / 58 files**; backend Vitest **257 passed** (+3 Mongo integration suites skipped).
- Arena browser suite **7/7** (`tests/browser/arena.browser.mjs`, isolated Chromium, synthetic fixtures).
- Typecheck clean (both apps). Lint 0 errors (3 frontend warnings; 88 backend warnings, pre-existing).
- Frontend build OK (main chunk 493.59 kB < 500 kB warn). Backend build OK.
- EXPORT-1 (account-export manifest mismatch) reproduces — only deferred regression.
- Working tree clean; 6 unpushed commits (phases A–D). `graphify-out/` is git-ignored tooling output.
- Node `v24.22.2` (satisfies `>=24.22.1 <25`).

## Completed predecessor phases (preserve — never revert)

- **A** regression/browser-fixture foundation · **B** design system & themes · **B.5** compass navigation
  (`components/navigation/NavigationDock.tsx`, `app/routes.tsx`, hash routing, 15 destinations,
  Learn/Insights/Manage) · **C / C.1** chart engine (occurrence-stable positions, exact-second
  plotting, multi-resolution, synced inspection) · **D** arena-v3 (frozen basis, deterministic
  seeded rivals, versioned scoring, replay artifacts, ledger bounds ≤20 runs / ≤90 checkpoints / ≤2,000
  opponents, dual frontend+backend validation, backup v3).

See `PHASE_D_ARENA.md` and `TESTING.md` for their engineering reports; both verified in the 2026-11-13 handoff.

## Phase E opportunities (evidence-backed, scoped)

Priority order recommended (see sequence). Each item preserves data semantics; none changes storage,
scoring, or auth.

- **P1 — Dashboard "Resume" bypasses tracked playback.** `Dashboard.tsx:52-57, 72-75` builds an
  external `youtube.com/watch?v=…` URL; the app's one-button CTA leaves the product. Route the primary
  action to `#/player` at the next unfinished position; keep "Open on YouTube" as an explicitly
  labeled secondary link. Risk: low. Tests: dashboard CTA contract + one Chromium assertion.
- **P2 — Duplicated preference surfaces.** Timezone / default session / reduced-motion appear in
  `Settings.tsx:56-102` **and** `Reports.tsx:160-194` (inside the "Export and restore" page, which also
  carries XP rules and destructive "Clear all data…"). Consolidate learning prefs into Settings;
  Reports keeps export/import/restore. Also update `PAGE_DESCRIPTIONS.reports` (`App.tsx:98`).
- **P3 — Three playlist add/refresh surfaces, one dead pointer.** Add/refresh in
  `Reports.tsx:148-156` and `Playlists.tsx` Onboarding; `PlaylistManager.tsx:122` says "Add one from
  Library or Reports" but Library has no add control. Provide one canonical add entry (Library header),
  delegate elsewhere.
- **P4 — Two disjoint goal systems.** Daily focus goal (`s.goals[today]`, set in `Focus.tsx:507-518`,
  shown on Dashboard "Set one in Focus") vs flexible goals (`Goals.tsx`, `s.flexGoals`). No cross-links;
  Goals page never mentions daily goals. **Needs owner product decision** (merge displays under Goals?
  keep models separate?). Never silently merge data models.
- **P5 — Orphaned records buried in Reports.** `Reports.tsx:204-243` is the only "playlist changes need
  review" surface. Add a compact count + deep link from Library or Dashboard (data:
  `Object.entries(s.progress).filter(([,r]) => r.orphaned)`).
- **P6 — Learning-record access is below the fold.** `LearningRecordEditor.tsx` sits at the bottom of
  the Player page (`Player.tsx:596`); "Open learning record" (`Player.tsx:568-571`) focuses the heading only.
  Give the aside a direct status summary + expand affordance; editor keeps its annotations-only contract.
- **P7 — Saved ranges divorced from checkpoints.** Library `saveRange` (`Library.tsx:132`) vs Checkpoints
  (`Checkpoints.tsx`); no "Create checkpoint from this range" shortcut. One-store-action change.
- **P8 — Empty-state guidance drift.** Terse `Empty` states name no working next action
  (`Goals.tsx:109`, `Library.tsx:58`, `Checkpoints.tsx:18`, `PlaylistManager.tsx:122`). Standardize:
  each empty state → one CTA to the route that solves it.
- **P9 — Copy/label consistency (not behavior).** Ad-hoc heading levels vs `lq-section-title`
  (`Efficiency.tsx:120`, Reports bold headings); goal/label wording across Dashboard/Focus/Goals.
- **Non-goals:** chart engine, arena semantics, focus/XP evidence, cloud merge, compass navigation,
  theme system, storage layout. No new dependencies; no persistence/schema changes.

## Regression risks

- Dashboard CTA change is the single most visible product change; keep XP/progress semantics untouched.
- Consolidation (P2) touches deletion/clear-data flows — re-run the browser baseline's deletion fixtures.
- P4 touches two goal families users already have data in; display-level only unless owner approves model change.
- Copy changes can break Testing-Library assertions that match literal strings — sweep `frontend/tests/`
  for exact-copy assertions when editing labels.

## Recommended implementation order

1. **E‑0** Owner decision on P4; docs/restore decision (links are broken today); re-baseline browser refs.
2. **E‑1** P1 (Dashboard CTA → Player) + P9 labels pass.
3. **E‑2** P2 + P3 consolidation (Settings/Reports/Library).
4. **E‑3** P5 + P8 (orphans affordance, empty-state CTAs).
5. **E‑4** P4 implementation after owner call (or link-level fallback).
6. **E‑5** P6 + P7 (record access, range→checkpoint shortcut).
7. **E‑6** Full verification; update `HOW_TO_USE_LEARNQUEST.md` sections; Phase E completion report.

## Acceptance criteria (per increment)

- All previously-passing suites stay green (frontend 499+new / backend 257); typecheck, lint, build clean.
- Chromium checks re-run where touched (player, dashboard, deletion) — no visual/interaction regressions.
- No storage, scoring, or auth behavior changes; diff confined to intended surfaces; `git status --short` clean otherwise.
- Copy changes reflected in `HOW_TO_USE_LEARNQUEST.md` only when behavior changes; otherwise docs unchanged.
- Honest evidence semantics preserved in every string ("verified" / "self-reported" / "estimate").

## Known defects to keep visible

- **EXPORT-1** — account export manifest ≠ archive; fix in a targeted increment before release work.
- **Docs tree missing** — README/manual links broken; restore from pre-`7391d9c` history with owner approval.
- **C.1 compass timing flake** — treat known-flaky paths as unstable until repeat runs are green ×3.
- Graphify graph is **AST-only**: docs carry no semantic edges; 2% INFERRED edges; community names are
  placeholders; re-run `graphify update .` after any source change (AST-only, free).
