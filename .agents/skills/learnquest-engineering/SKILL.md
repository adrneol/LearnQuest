---
name: learnquest-engineering
description: "Use when modifying, reviewing, debugging, or testing the LearnQuest repository: React 18 + Vite frontend, Express and MongoDB backend, authenticated cloud sync, local IndexedDB test mode, learning-domain calculations, accessibility, and deployment scripts. Guides minimal, verified changes that preserve domain invariants, user data, and pre-existing work."
---

# LearnQuest Engineering

This is a repository-specific engineering skill. Load it before changing LearnQuest source, tests, storage, authentication, calculations, or UI.

The observations below were verified against the working tree at HEAD `7391d9c` on 2026-11-10 (audit Phase 1 -> Phase 2 refresh). The repository is actively changing and can contain uncommitted user work. Re-inspect the current source before relying on any detail. **Current source and executed test results outrank README claims, audit reports, and prompts.**

## Non-negotiable safeguards

- Start by reading `git status --short` and inspecting the full tracked diff plus the contents of relevant untracked files. Pre-existing modifications, deletions, and untracked files are the user's work.
- Preserve unrelated user changes. Never restore a deleted file, overwrite a modified file, reformat unrelated code, or remove an untracked file merely because it looks unexpected or differs from an audit report.
- Never run destructive Git commands: no `git reset --hard`, `git clean`, `git checkout -- .`, `git restore` over user work, destructive rebase, or stash/pop that can discard changes. Do not stage or commit unless explicitly authorized.
- Do not install dependencies, upgrade versions, regenerate lockfiles, or change package manifests unless the task requires it and the user authorizes it.
- Never read, print, copy, or expose `.env` files, credentials, API keys, session tokens, CSRF tokens, email-link tokens, MongoDB URIs, or real user data. Use `.env.example` and test fakes.
- No live database operations against a real MongoDB deployment: no migrations, collection/index changes, deletes, or diagnostic scripts pointed at production. No real account or learning-data mutation.
- Production learning storage must remain on the confirmed **legacy** layout. Do not run the unified cutover, migrate data, retire legacy collections, deploy, or change production configuration.
- Do not start the Phase 23 implementation from `LEARNQUEST_PHASE_23_COMPLETE_IMPLEMENTATION_PROMPT_2026-10-30.txt` unless the user explicitly asks for that phase.
- Preserve TypeScript strictness. Do not weaken `tsconfig`, ESLint, Vitest, or validation to make a change pass. Do not use blanket `any`, `@ts-ignore`, or disabled tests as a shortcut.
- Add regression coverage for behavior changes. Never claim a test, build, browser flow, security check, or live integration passed when it was not actually run.
- Do not commit, push, deploy, rotate credentials, or alter production infrastructure without explicit authorization.

## Repository shape

LearnQuest is two independent npm projects. There is no root install step.

| Area | Confirmed implementation |
|---|---|
| Frontend | React 18.3, Vite 6, TypeScript 5.6 strict, Tailwind CSS 4, Recharts 2, `idb` 8, `lucide-react` |
| Backend | Node 24.22.1+ (`>=24.22.1 <25`), Express 4.21, MongoDB driver 7, Zod 4, `jose`, `@node-rs/argon2`, `helmet`, `cors`, `express-rate-limit` |
| Frontend tests | Vitest 4 + jsdom + Testing Library + `fake-indexeddb`; UI and domain tests live under `frontend/tests/` and colocated `src/**/*.test.*` files |
| Backend tests | Vitest 4 (node environment) + Supertest; route/store/security tests under `backend/tests/` |
| Runtime data | MongoDB cloud mode for authenticated accounts; IndexedDB local mode for tests and explicit local use |
| Deploy config | `frontend/vercel.json`, `render.yaml`; Node is pinned at 24.22.1 in `backend/.node-version` |

Key locations:

```text
frontend/src/app/             App shell, hash navigation, StoreProvider, auth sync
frontend/src/domain/          Pure calculation and reconciliation engines
frontend/src/features/        Page-level feature screens
frontend/src/components/      UI primitives, charts, layout, dialogs
frontend/src/services/        API transport, IndexedDB, backup, exports, notifications
frontend/src/styles/          Tailwind entry and global design CSS
backend/src/routes/           Auth, account, playlist, playlist-management endpoints
backend/src/auth/             Sessions, accounts, OAuth, action tokens, write leases
backend/src/services/         Learning-data validation, account lifecycle, playlists
backend/src/db/               Mongo adapters, lifecycle, indexes, in-memory tests support
backend/src/scripts/          Migration, inspection, diagnostics, retirement tools
docs/user-doc/MIGRATION_RUNBOOK.md # legacy → unified cutover gates (restored 2026-11-10)
docs/user-doc/MIGRATION_ROLLBACK.md # abort / reverse / retirement criteria (restored 2026-11-10)
```

## Architecture and invariants

### Frontend shell and state

- Navigation is hash-based (`#dash`, `#learn`, `#account/security`, and so on) in `frontend/src/app/App.tsx`. There is **no React Router and no Next.js**. Do not introduce Next.js, RSC, server actions, Next server APIs, or a second router for a small navigation change.
- Heavy chart screens use React 18 `lazy()` and `Suspense`. Preserve code-splitting when adding screens.
- Charts with long categorical axes use `frontend/src/components/charts/PanChart.tsx` (custom horizontal explorer: pointer/touch drag, shift+wheel/deltaX, keyboard, range slider, fixed Y-axis strip). `DurationBars`, `CumulativeLine`, `CumulativeChart` and the Analytics distribution are the integration points. Do not swap back to native horizontal scrollbars.
- `StoreProvider` in `frontend/src/app/store.tsx` is the central state/action layer. Put persistence, authentication, and domain mutations behind existing store actions rather than adding independent component-level storage or calculations.
- Local mode uses IndexedDB (`frontend/src/services/persistence/db.ts`). Test mode defaults to local; every other mode defaults to cloud. Cloud mode must not silently fall back to IndexedDB or present a failed cloud read as an empty account.
- Cloud writes use optimistic versions and a three-way merge: last server-confirmed base, local pending state, and newest server state. `frontend/src/services/persistence/cloudMerge.ts` merges by stable record identity, never array index, and surfaces conflicts for an explicit keep-local/use-server decision. Do not replace this with last-write-wins or a silent reload.
- `frontend/src/services/api/readiness.ts` is the singleton backend-readiness coordinator (bounded exponential backoff + jitter, `Retry-After`, distinguishes 503/timeout from 401). `store.tsx bootstrap`/`loadCloud` must use it for cold-start auto-resume; never treat `503`/`TIMEOUT`/`NETWORK` as an expired session.
- `frontend/src/services/api/http.ts` deliberately keeps browser requests same-origin under `/api`, includes credentials, adds the CSRF token to mutations, and distinguishes session expiry from ordinary wrong-credential errors. Preserve those distinctions. Do not add tokens to `localStorage` or build cross-origin API calls without reviewing cookie, CSP, and proxy behavior. No frontend fetch may retry non-idempotent ops; readiness retries are GET-only and capped.

### Backend and authentication

- `backend/src/app.ts` mounts `/api/auth`, `/api/account`, `/api/playlists`, and playlist metadata routes. Express validation, rate limiting, trusted-origin checks, Helmet, CORS, and JSON limits are part of the security boundary.
- Sessions are server-side and cookie-based: production uses a `__Host-lq_session` cookie with `Secure`, `HttpOnly`, and `SameSite=Lax`; development uses the non-prefixed name. Mutations require `X-CSRF-Token` and a trusted origin. `requireAuth` refreshes the cookie `Max-Age` on each touch (sliding renewal bounded by absolute expiry); never weaken HttpOnly/Secure/SameSite. `revokeAllSessions` is atomic via write-lease; onboarding expiry (`google_register` 30-min) is enforced in `requireAuth` for all gated paths.
- `POST /auth/logout` is idempotent without CSRF (SameSite+Lax+trusted-origin protected); `logout-all` uses `auth+csrf` inside the same atomic lease.
- Google is the only registration path. Password sign-in is available after onboarding. Email actions are single-use, purpose-bound, HMAC-digested, expiring tokens. Sensitive actions use a recent-reauthentication window.
- Account deletion is a resumable, verified cascade across all account-scoped collections, not a single document delete. Do not simplify it to a cascade that can report success early.
- Keep secrets server-side. YouTube metadata fetching, Google OAuth, Brevo email, and MongoDB credentials never belong in frontend code or `VITE_*` variables.

### Storage

- Learning state has 20 user collections: `playlists`, `meta`, `progress`, `ranges`, `checkpoints`, `modules`, `sessions`, `goals`, `xp`, `achievements`, `segments`, `playSessions`, `queue`, `flexGoals`, `challenge`, `challengeEnabled`, `rankHistory`, `settings`, `prefs`, and `activeId`.
- `LQ_USER_DATA_STORE=legacy` is the default and confirmed production mode. It reads/writes `lq_data_*` collections. `unified` uses `lq_user_data` and requires an explicit cutover acknowledgement in production. There is no automatic fallback and no dual-write. Do not imply that a passing test makes unified production-ready. Cutover is gated by owner approval of backup/dry-run/parity evidence; M7 requires explicit sign-off separate from implementation.
- Backfill guard: `readUserState` hard-fails when unified is selected but empty while legacy is non-empty (empty-unified trap). Frontend rejects `schemaVersion !== 1` explicitly with a 502 and never initializes blank state.
- `GET /api/account/data` returns `{ ok, schemaVersion, loadedAt, state, version }` with every learning domain present. State writes are validated server-side, bounded by a default 8 MB envelope, versioned in `lq_state_versions`, and applied transactionally where the store supports transactions.
- Account export & full backup are two products: `frontend/src/services/exports/accountExport.ts` builds the organized `LearnQuest-Account-Export/` ZIP (README, manifest, one JSON per domain, CSV reports) — no secrets; it does NOT restore. `buildBackup`/`validateBackup`/`importBackup` (services/persistence/backup.ts) is the restore-compatible Backup JSON v3. Keep both; do not merge or replace either.
- Adding a new persisted domain is cross-cutting: frontend types/defaults/store, backup/import, cloud merge behavior, backend `USER_COLLECTIONS`, collection kind and bounds, indexes, deletion scope, migration mapping, and regression tests. Do not add frontend state that assumes the server already persists it.

### Domain rules that must remain true

1. **Occurrence identity, not position.** Progress and annotations use stable `entryId` identities. Positions are presentation details and can change after a playlist refresh; duplicate video IDs are distinct occurrences. Use the identity helpers in `frontend/src/domain/progress/identity.ts`.
2. **Duration integrity.** Unknown or unresolved durations are never averaged, guessed, or silently dropped. Totals stay explicitly incomplete when data is missing. Use integer-second/hour-safe domain helpers.
3. **Verified versus self-reported evidence.** Manual completion, verified playback, and self-reported history are distinct states and labels. Never infer verified completion from manual or self-reported data.
4. **Playback coverage.** Unique coverage is the union of observed timeline intervals. Rewatches increase playback totals, not unique coverage. Verified completion uses only player-observed evidence and the configured threshold (default 90%, allowed 50–100%).
5. **Focus integrity.** Active focus time excludes paused/absent time. Focus v2 uses monotonic and wall-clock checks, excludes or caps suspicious gaps, requires review for long interruptions, and records only sessions at least 10 seconds long. Finish/recovery and XP award are idempotent. Do not count a closed tab or sleep gap as concentration.
6. **Efficiency semantics.** Efficiency is aggregate unique content ÷ focused time, not comprehension, retention, intelligence, or learning quality. Preserve that distinction in code, labels, tooltips, empty states, and reports.
7. **Arena semantics.** Arena is an optional, deterministic, fictional simulation (`arena-v2`) with synthetic competitors. Score = 75% bounded progress + 25% bounded consistency; users/rivals are provisional until at least 3 qualifying days and 7 observed days. It is not a real-person ranking or a scientific measure. Keep it clearly labeled and off by default unless an existing setting says otherwise.
8. **Goals, streaks, and XP.** Use calendar-day attribution in the user's display timezone. DST and partial days must be handled by the time/domain helpers, not ad hoc `Date` math. XP awards require a dedup key; repeated finish/recovery must not double-award.
9. **Revision and notes.** Recording a review clears current flags while preserving annotations and appending history. Do not overwrite notes, confidence, dates, or revision history as a side effect of unrelated playlist changes.
10. **Playlist refreshes.** Added, removed, or moved entries may mark ranges/checkpoints `needsReview`. Preserve original boundaries until the user confirms; never silently rewrite them.

### UI and accessibility

- Design system: CSS variables under `:root[data-theme="dark"|"light"]` in `frontend/src/styles/index.css`; neutral monochrome palette (graphite/charcoal dark, off-white light), single inverted-neutral accent (`--accent`, near-white on dark / near-black on light, with `--accent-text` as its foreground). Semantic colors are reserved for genuine success/warning/destructive meaning. No purple/violet/indigo, no glow, no gradients, no glassmorphic blur. Global `.glass` and radial gradients removed; `Card` is a flat `bg-[var(--surface)] border`. Charts read tokens from `frontend/src/components/charts/theme.ts` (`useChartTheme()` hook) and never hardcode hex; primary series is a neutral near-monochrome tone. `frontend/src/app/theme.ts` owns get/init/set/system, persisted in `localStorage lq-theme`, applied pre-paint via inline script in `index.html` (no FOUC). `components/ui/ui.tsx` primitives (`Card`, `Btn`, `Field`, `inputCls`, `ProgressBar`, `Empty`, plus `Skeleton`, `CheckField`, `SectionHeading`) are theme-tokenized with the neutral accent for `primary` buttons.
- Sidebar: `frontend/src/app/App.tsx` — Groups Learn/Plan/Insights/Manage with Account footer entry distinct from tab; icons hierarchical (Dashboard `LayoutDashboard`); active state is a restrained neutral (subtle surface + 2px `--text` indicator + semibold), no permanent connection-status badge in sidebar/footer/header, `SyncIndicator` is transient-only (in-flight, failure-with-retry, conflicts).
- Zero-AI-slop directive (2026-11-10): every screen must read as deliberately designed for LearnQuest — no decorative gradients, no permanent status badges, no purple accents, no repetitive card-within-card layouts, minimal explanatory copy. Security notices and destructive-action warnings are preserved verbatim in content, only de-decorated visually. Confirmed scope: Account, Settings, Sidebar/header, shared primitives, charts, Dashboard, global token sweep. Pages not individually redesigned line-by-line get the same token system automatically; deeper per-page copy/hierarchy audits remain as follow-up work if requested.
- Desktop uses a sidebar; mobile uses a focus-trapped drawer. Keep the existing `max-w-6xl` content rhythm and `sm:`/`lg:` responsive behavior. Verify affected pages at narrow and wide widths.
- Preserve keyboard access, visible `focus-visible` rings, labeled controls, `role`/`aria-*` semantics, reduced-motion behavior, disabled/loading states, and explicit empty/error states. Do not reduce accessibility to make a test pass.
- Copy must remain honest: “verified” only for observed evidence, “self-reported” for manual history, “efficiency” for the ratio, “Arena” for the simulation. Avoid presenting a provisional or fictional score as a fair real ranking.

## Skill hierarchy

- `learnquest-engineering` = authoritative project engineering rules (this file).
- `frontend-design` = visual design direction and implementation (read it before redesigning screens).
- `impeccable` (`.opencode/skills/impeccable`, project-local via `impeccable install --scope=project`) = design critique, polish, detector and visual QA. Ask before enabling the hook. `impeccable.cmd context` prints the loaded directive; detector via `.opencode/skills/impeccable/scripts/impeccable.cmd detect --json <files>`.
- `web-design-guidelines` = accessibility/responsive/UX review skill (fetches fresh rules from the canonical source URL each review).
- Specialists `mongodb-schema-design`, `security-best-practices`, `playwright-best-practices-for-agents`, `vercel-react-best-practices` remain subject to the restrictions table below. No specialist skill may override LearnQuest's security, data integrity or business-logic invariants.
- LearnQuest's explicit brief (graphite/near-black neutral palette, calm restrained UI, no forbidden purple/violet/indigo decoration) wins over any skill's default aesthetic suggestions, consistent with `frontend-design`'s "the brief's own words always win".

## Commands and test strategy

Run commands from the relevant app directory:

```powershell
cd frontend
npm test                         # full Vitest suite
npm test -- tests/foo.test.ts   # focused test file
npm run typecheck
npm run lint
npm run build                    # tsc --noEmit + Vite production build
npm run dev
npm run preview                  # serves dist/ as production preview (no /api)
node tests/browser/*.mjs         # real-browser harnesses/probes (Chromium via playwright-core)
```

```powershell
cd backend
npm test
npm test -- tests/foo.test.ts
npm run typecheck
npm run lint
npm run build                    # tsc production build
npm run dev
```

Additional backend scripts exist for operators (`migrate:user-data`, `inspect:user-data`, `diagnose:mongo`, `retire:legacy-data`). They are not normal development commands. Do not run them against real infrastructure; the migration is dry-run by default but must still be treated as production-sensitive.

Testing rules:

- Add focused domain unit tests for calculation/identity/time changes.
- Add store/API integration tests for persistence, authentication, sync, and error paths.
- Add route tests with Supertest and in-memory stores for backend behavior; never require live MongoDB, Google, or Brevo.
- Use `fake-indexeddb` for local persistence and fake timers where timing is deterministic.
- Run the focused test first, then the affected app suite, typecheck, lint, and build as risk dictates. If a command was not run, say so.
- No Playwright configuration/spec for the `@playwright/test` runner exists in this repository. The real harness is hand-rolled `playwright-core 1.64.1` with `frontend/tests/browser/*.mjs` (chromium + firefox), run via `npm run test:browser*`. jsdom tests are not real-browser E2E and cannot prove BroadcastChannel timing, iframe behavior, sleep/visibility, or cross-device propagation. Do not claim they do. If an existing/authorized suite is added later, follow `playwright-best-practices-for-agents` (locator priority, web-first assertions, isolation, auth-state reuse, no-hard-wait).
- There is no confirmed automated accessibility, load, or security-penetration suite. Component focus-trap tests are not a full accessibility audit.

## Eight-step workflow

1. **Understand the request.** Restate the intended behavior, affected user flow, acceptance criteria, and explicit exclusions. Identify whether the task is code, tests, docs, review-only, or an audit follow-up. Do not silently expand scope.
2. **Inspect before editing.** Read `git status --short`, the full relevant diff, and the current implementation, tests, types, and docs. Check for user changes in every file you might touch. Confirm the real stack and scripts rather than trusting an audit report.
3. **Identify risks.** Check domain invariants, identity/time semantics, cloud/local persistence, auth/CSRF/session behavior, migration/deletion impact, responsive/accessibility behavior, and test coverage. Record assumptions that cannot be proven from source.
4. **Make the smallest coherent change.** Reuse existing domain helpers, store actions, API transport, backend repositories, and UI primitives. Prefer a contained fix over a parallel implementation or a broad refactor. Do not add dependencies for convenience.
5. **Add regression coverage.** Test the bug or new behavior at the lowest reliable layer, then add integration coverage if the change crosses store/API/persistence boundaries. Include failure, empty, conflict, and repeated-action cases where relevant.
6. **Run verification.** Execute focused tests, the affected suite, typecheck, lint, and build as appropriate. Fix failures before proceeding. Do not install missing tools, skip tests, or loosen assertions to get green output.
7. **Inspect the final diff and tree.** Use `git status --short` and the diff to confirm only intended files changed, user modifications/deletions/untracked work remain intact, no secrets or generated junk were added, and no unrelated formatting churn occurred.
8. **Report verified results and limits.** State what changed and why, the exact commands run and their outcomes, tests added, files touched, and anything not verified (live services, real browser, production, load, accessibility, migrations). Report residual risk honestly.

If a step reveals a contradictory requirement or a change would exceed the requested scope, stop and surface the trade-off rather than improvising a destructive or broad solution.

## Specialist skill coordination

Load only the specialist skills relevant to the task, and apply their guidance through the compatibility rules below.

| Specialist skill | Use when | LearnQuest-specific restrictions |
|---|---|---|
| `vercel-react-best-practices` | Reviewing or writing React performance/bundle code | Use framework-independent React 18/Vite advice only. **Do not** apply Next.js, RSC, server actions, `next/dynamic`, `React.cache`, `useEffectEvent`, `use()`, `<Activity>`, or other React 19-only APIs. Prefer existing `lazy`/`Suspense`, stable keys, narrowed effects, immutable state updates, and direct imports where already compatible. Never launch a broad performance refactor without measured need and authorization. |
| `playwright-best-practices-for-agents` | The task explicitly requires browser/E2E testing | No Playwright setup exists in this repository. **Do not install `@playwright/test`, `@playwright/cli`, browsers, or scaffold configs automatically.** Obtaining authorization is required before adding a suite. If an existing/authorized suite is added later, follow its locator priority, web-first assertions, isolation, auth-state reuse, and no-hard-wait rules. Keep jsdom tests separate from real-browser claims. |
| `security-best-practices` | The user explicitly requests a security review, report, or secure-by-default auth/security work | Read the relevant JavaScript/TypeScript and Express references, but verify they match Express 4.21 and React 18. The available React guidance targets React 19.x; adapt component/API advice instead of copying React 19 code. Preserve CSRF, trusted origin, cookie, session, rate-limit, single-use-token, recent-auth, and non-enumeration behavior. Never expose secrets or run live attacks. |
| `mongodb-schema-design` | The task explicitly involves MongoDB schema, indexes, queries, lifecycle, or storage design | Inspect the current 20-collection model and existing indexes first. Treat design guidance as advisory, not a license to reshape production data. **No live `mongosh`, Atlas, migration, index, or query operations.** Validate changes with source-level reasoning, in-memory repositories, and tests; propose risky migrations separately for owner approval. Production storage stays legacy. |

When specialist guidance conflicts with the repository (for example, Next.js-only patterns), the repository's actual architecture and this skill win. Document the conflict instead of forcing the pattern.

## Source-of-truth and known drift

Use this evidence order:

1. Current source code and schema definitions.
2. Tests actually executed in this session.
3. `README.md` and `HOW_TO_USE_LEARNQUEST.md` (useful intent, but can lag source).
4. `docs/user-doc/MIGRATION_RUNBOOK.md` and `MIGRATION_ROLLBACK.md` (authoritative for the storage cutover; the former `docs/user-doc/audit2/` archive is absent from this tree — do not cite it).
5. `LEARNQUEST_PHASE_23_...txt` (future scope, not an implementation instruction unless explicitly requested).

Known discrepancies observed at this snapshot—verify them before repeating them as fact:

- The README no longer promotes `VITE_API_BASE_URL`; the manual may still lag in places. Current contract: http.ts forces same-origin `/api`; cookies are first-party via the Vercel rewrite. Do not “fix” either side without checking the current deployment contract, cookie policy, and tests.
- README/manual describe an alternate same-site custom-domain API topology using `VITE_API_BASE_URL`; current `http.ts` deliberately forces same-origin `/api`. Do not “fix” either side without checking the current deployment contract, cookie policy, and tests.
- Historical audit test-file counts and status claims can differ from the current working tree, which contains additional untracked tests and source files. Count and re-run; never quote old counts as current verification.
- Node runtime verified `v24.22.2` at 2026-11-10 (engines `>=24.22.1 <25` satisfied).
- Current docs tree: `docs/` may still be deleted in some checkouts — re-check `read docs` before relying on README links to `docs/user-doc/...`. Restored in Phase 2/3: `docs/user-doc/MIGRATION_RUNBOOK.md` and `MIGRATION_ROLLBACK.md` (see `docs/README.md`).
- Audit report 22 states that real-browser E2E, live MongoDB writes/migration, live production checks, load testing, and accessibility audits were not performed. Preserve those limits in any follow-up report.

If source and documentation disagree, do not silently rewrite the docs or the code. State the discrepancy and follow the user's requested scope. Unless asked for a docs update, keep report-only files unchanged.

## Final response checklist

Report:

- the exact files created or changed;
- the behavior implemented and any important architectural decision;
- regression tests added;
- commands run with pass/fail results, distinguishing focused tests from full verification;
- checks not run and why (for example, no live MongoDB, no real-browser suite, no accessibility audit);
- known assumptions, documentation drift, or residual risks;
- confirmation that unrelated user changes, deletions, untracked files, secrets, and production data were left untouched.

Never end with “all tests pass” unless the exact commands were executed successfully in this session.
