---
name: learnquest-engineering
description: "Use when modifying, reviewing, debugging, or testing the LearnQuest repository: React 18 + Vite frontend, Express and MongoDB backend, authenticated cloud sync, local IndexedDB test mode, learning-domain calculations, accessibility, and deployment scripts. Guides minimal, verified changes that preserve domain invariants, user data, and pre-existing work."
---

# LearnQuest Engineering

This is a repository-specific engineering skill. Load it before changing LearnQuest source, tests, storage, authentication, calculations, or UI.

The observations below were verified against the working tree at HEAD `3107d11` on 2026-10-31. The repository is actively changing and can contain uncommitted user work. Re-inspect the current source before relying on any detail. **Current source and executed test results outrank README claims, audit reports, and prompts.**

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
docs/user-doc/audit2/         Chronological audit/report archive
```

## Architecture and invariants

### Frontend shell and state

- Navigation is hash-based (`#dash`, `#learn`, `#account/security`, and so on) in `frontend/src/app/App.tsx`. There is **no React Router and no Next.js**. Do not introduce Next.js, RSC, server actions, Next server APIs, or a second router for a small navigation change.
- Heavy chart screens use React 18 `lazy()` and `Suspense`. Preserve code-splitting when adding screens.
- `StoreProvider` in `frontend/src/app/store.tsx` is the central state/action layer. Put persistence, authentication, and domain mutations behind existing store actions rather than adding independent component-level storage or calculations.
- Local mode uses IndexedDB (`frontend/src/services/persistence/db.ts`). Test mode defaults to local; every other mode defaults to cloud. Cloud mode must not silently fall back to IndexedDB or present a failed cloud read as an empty account.
- Cloud writes use optimistic versions and a three-way merge: last server-confirmed base, local pending state, and newest server state. `frontend/src/services/persistence/cloudMerge.ts` merges by stable record identity, never array index, and surfaces conflicts for an explicit keep-local/use-server decision. Do not replace this with last-write-wins or a silent reload.
- `frontend/src/services/api/http.ts` deliberately keeps browser requests same-origin under `/api`, includes credentials, adds the CSRF token to mutations, and distinguishes session expiry from ordinary wrong-credential errors. Preserve those distinctions. Do not add tokens to `localStorage` or build cross-origin API calls without reviewing cookie, CSP, and proxy behavior.

### Backend and authentication

- `backend/src/app.ts` mounts `/api/auth`, `/api/account`, `/api/playlists`, and playlist metadata routes. Express validation, rate limiting, trusted-origin checks, Helmet, CORS, and JSON limits are part of the security boundary.
- Sessions are server-side and cookie-based: production uses a `__Host-lq_session` cookie with `Secure`, `HttpOnly`, and `SameSite=Lax`; development uses the non-prefixed name. Mutations require `X-CSRF-Token` and a trusted origin.
- Google is the only registration path. Password sign-in is available after onboarding. Email actions are single-use, purpose-bound, HMAC-digested, expiring tokens. Sensitive actions use a recent-reauthentication window.
- Account deletion is a resumable, verified cascade across all account-scoped collections, not a single document delete. Do not simplify it to a cascade that can report success early.
- Keep secrets server-side. YouTube metadata fetching, Google OAuth, Brevo email, and MongoDB credentials never belong in frontend code or `VITE_*` variables.

### Storage

- Learning state has 20 user collections: `playlists`, `meta`, `progress`, `ranges`, `checkpoints`, `modules`, `sessions`, `goals`, `xp`, `achievements`, `segments`, `playSessions`, `queue`, `flexGoals`, `challenge`, `challengeEnabled`, `rankHistory`, `settings`, `prefs`, and `activeId`.
- `LQ_USER_DATA_STORE=legacy` is the default and confirmed production mode. It reads/writes `lq_data_*` collections. `unified` uses `lq_user_data` and requires an explicit cutover acknowledgement in production. There is no automatic fallback and no dual-write. Do not imply that a passing test makes unified production-ready.
- `GET /api/account/data` returns `{ ok, schemaVersion, loadedAt, state, version }` with every learning domain present. State writes are validated server-side, bounded by a default 8 MB envelope, versioned in `lq_state_versions`, and applied transactionally where the store supports transactions.
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

- Preserve the established dark glass design: deep navy surfaces (`#0b0e1a` family), violet/cyan accents, Tailwind utility styling, and compact cards. Reuse the primitives in `frontend/src/components/ui/ui.tsx` (`Card`, `Btn`, `Field`, `inputCls`, `ProgressBar`, `Empty`), dialogs/popups, and existing chart theme.
- Desktop uses a sidebar; mobile uses a focus-trapped drawer. Keep the existing `max-w-6xl` content rhythm and `sm:`/`lg:` responsive behavior. Verify affected pages at narrow and wide widths.
- Preserve keyboard access, visible `focus-visible` rings, labeled controls, `role`/`aria-*` semantics, reduced-motion behavior, disabled/loading states, and explicit empty/error states. Do not reduce accessibility to make a test pass.
- Copy must remain honest: “verified” only for observed evidence, “self-reported” for manual history, “efficiency” for the ratio, “Arena” for the simulation. Avoid presenting a provisional or fictional score as a fair real ranking.

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
- No Playwright configuration/spec or Playwright dependency is present in this snapshot. jsdom tests are not real-browser E2E and cannot prove BroadcastChannel timing, iframe behavior, sleep/visibility, or cross-device propagation. Do not claim they do.
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
4. `docs/user-doc/audit2/22_..._2026-10-30.md` and earlier reports (report-only, point-in-time evidence; often list intentionally unimplemented remediation).
5. `LEARNQUEST_PHASE_23_...txt` (future scope, not an implementation instruction unless explicitly requested).

Known discrepancies observed at this snapshot—verify them before repeating them as fact:

- The README links to `docs/DEPLOYMENT_MULTIUSER.md`, which was not present in the inspected docs tree. Deployment claims may be historical.
- README/manual describe an alternate same-site custom-domain API topology using `VITE_API_BASE_URL`; current `http.ts` deliberately forces same-origin `/api`. Do not “fix” either side without checking the current deployment contract, cookie policy, and tests.
- Historical audit test-file counts and status claims can differ from the current working tree, which contains additional untracked tests and source files. Count and re-run; never quote old counts as current verification.
- The local environment used for investigation may be Node 24.11.0 while both packages declare `>=24.22.1 <25`. This is a documented limitation, not permission to change engines or dependencies. Report runtime mismatch if it affects verification.
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
