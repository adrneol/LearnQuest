# AGENTS.md — LearnQuest

Guidance for coding agents working in this repository. Keep this file short; details live in
`docs/engineering/` and `TESTING.md`. **Source and tests outrank this file.**

## Project in one paragraph

LearnQuest turns public YouTube playlists into measurable learning journeys: exact per-video
durations (never averaged), verified playback evidence in an embedded player, focus sessions,
goals, checkpoints, modules, revision, reports, and an optional clearly-labeled **fictional**
Arena. Authenticated accounts; learning data lives in MongoDB scoped to the account; IndexedDB
is the local/test mode. Two independent apps (`frontend/` React 18 + Vite + TS, `backend/`
Express + TS + MongoDB). No root install; hash routing; no router library; `StoreProvider`
(`frontend/src/app/store.tsx`) owns learning state.

## Before you edit — read in this order

1. `docs/engineering/PROJECT_KNOWLEDGE.md` — architecture, domain ownership, invariants, god nodes.
2. `docs/engineering/DATA_FLOWS.md` — end-to-end evidence flows (import → restore).
3. `docs/engineering/PHASE_E_READINESS.md` — current baseline, completed phases, scoped opportunities.
4. `.agents/skills/learnquest-engineering/SKILL.md` — authoritative repo rules and safeguards.
5. Then inspect the actual source you will touch — never trust this file over source.

## Working rules (these are invariants)

- Never modify application behavior unless the task says so. No new dependencies, no schema/storage
  changes, no auth changes, no scoring/telemetry semantics changes without explicit approval.
- Keep missing data missing (never zero-fill/average); keep occurrence **identity** (`entryId`), never positions.
- Verified ≠ manual ≠ self-reported; honest labels in UI copy.
- Compass navigation (B.5), design tokens (B), chart engine (C/C.1), Arena v3 (D): preserve.
- Never touch `.env`, `backend/data`, production services, or live accounts. Synthetic test data only.
- Never commit, push, deploy, migrate, or delete without explicit owner approval.

## Verification commands (run from repo root)

```powershell
npm --prefix frontend test        # Vitest; baseline 499 passed (2026-11-13)
npm --prefix backend test         # Vitest; baseline 257 passed (+3 Mongo suites skipped)
npm --prefix frontend run typecheck; npm --prefix backend run typecheck
npm --prefix frontend run lint;   npm --prefix backend run lint   # 0 errors required
npm --prefix frontend run build;  npm --prefix backend run build
node --test frontend/tests/browser/arena.browser.mjs            # Arena smoke (Chromium)
node scripts/check-markdown-links.mjs                            # docs link gate
```

Known red: `EXPORT-1` in `npm --prefix frontend run test:regressions` (account-export manifest ≠ archive).
Real-browser fixtures need `LQ_BROWSER_EXECUTABLE`; Mongo integration suites need `LQ_TEST_MONGO_URI`
and stay skipped otherwise. Do not run browser/integration suites against anything but disposable,
synthetic environments.

## Repository status notes (2026-11-13)

- `docs/user-doc/` was deleted in `7391d9c`; README/manual links are broken until restored from Git history (owner decision).
- Generated graph: `graphify-out/` (git-ignored). Query it; verify against source.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
