# LearnQuest — Course Analytics, Playback Tracking, Efficiency & Simulated Arena

Turn any public YouTube playlist into a measurable learning journey: exact per-video duration math (never averages), an embedded player with verified-coverage telemetry, flexible goals, timezone-correct history, a documented efficiency engine, and an optional fictional study arena — all local-first.

> **New user? Start with the complete manual: [HOW_TO_USE_LEARNQUEST.md](./HOW_TO_USE_LEARNQUEST.md)** — setup, every screen, formulas, troubleshooting, and a full walkthrough. This README covers what the project is, how to run it, and where things live.

## Layout

```
frontend/            # React + Vite + TS + Tailwind + Recharts + idb
  src/app/           # shell (sidebar/drawer nav, hash routing), tabs, store
  src/components/    # ui (cards, buttons, Dropdown, TimezonePicker, dialogs, popups),
                     # layout (Notifier), charts (theme, DurationBars, CumulativeLine, CumulativeChart)
  src/features/      # dashboard, playlists (library), player, analytics, modules,
                     # goals, checkpoints, focus, efficiency, competition,
                     # revision, history, reports, settings
  src/domain/        # THE single calculation engine:
                     # duration, playlist, progress, playback, efficiency,
                     # goals, competition, time, analytics
  src/services/      # api (typed backend contract), persistence (IndexedDB),
                     # exports (CSV/import validation), notifications
  src/types/         # shared records (UTC instants; tz is presentation-only)
  tests/             # vitest suites
backend/             # Node + TS + Express — YouTube Data API v3 proxy
  src/config/        # env (getters; secrets never leave the server)
  src/routes/        # /api/health, /api/playlist, /api/cache
  src/controllers/   # request handling + cache wiring
  src/services/youtube/  # pagination + 50-ID batching + normalization
  src/middleware/    # per-app rate limit, secret-safe error handler
  src/schemas/       # request validation (input checks, not learning math)
  src/cache/         # per-app TTL memory cache
  src/types/         # NormalizedSnapshot contract (ISO durations!)
  src/utils/         # playlist-ID parsing
  tests/             # supertest + contract tests
```

**One engine rule:** the backend returns normalized metadata with the *original ISO 8601 durations* (`durationIso`). Only `frontend/src/domain` parses durations and computes totals, percentages, goals, efficiency, and simulated scores. Verified by grep: no `parseISO`/`durationSec` computation in `backend/src`, no `apps/` or `packages/` references anywhere.

## Quick start

Requirements: Node 20+, npm 9+.

```powershell
npm install
npm run dev          # backend :3001 + frontend :5173 together (two-terminal: npm run dev:backend / dev:frontend)
npm test             # backend 6 + frontend 101
npm run typecheck
npm run build
```

Open http://localhost:5173. Without a backend key, playlist-URL fetching reports the missing integration; JSON import (Reports) works fully offline.

## YouTube API key

Live playlist fetching needs a **YouTube Data API v3 key** in `backend/.env`:

```
YOUTUBE_API_KEY=…
```

(If yours is missing: Google Cloud → enable YouTube Data API v3 → create a key restricted to that API + your backend host → paste into `backend/.env` → restart the backend. Never put it in a `VITE_` variable, `frontend/`, chat, or Git — `backend/.env` is git-ignored.)

Confirm: **Settings → Backend connection** reads “● Connected — API key configured”, or `GET /api/health` shows `"hasKey":true`. Without a key, URL fetching reports the gap and JSON snapshot import (Reports) works fully offline. Full steps + troubleshooting: [HOW_TO_USE_LEARNQUEST.md §D](./HOW_TO_USE_LEARNQUEST.md#d-youtube-api-setup).

## Environment variables

| File | Var | Purpose |
|---|---|---|
| `backend/.env` | `YOUTUBE_API_KEY` | **Secret.** Server-side only. Never `VITE_`, never committed |
| `backend/.env` | `PORT` / `CORS_ORIGIN` / `CACHE_TTL_SEC` / `RATE_LIMIT_PER_MIN` | Port, allowed origins, cache TTL, per-IP limit |
| `frontend/.env.local` | `VITE_API_BASE_URL` | Optional; empty = same-origin `/api` (dev proxy handles it) |

`.gitignore` covers `.env` / `.env.local`; only `.env.example` files are versioned.

## API contract

- `GET /api/health` → `{ ok, hasKey, version, time }` (no secret).
- `GET /api/playlist?url=<URL-or-ID>` → `{ snapshot, cached }`; snapshot entries carry `durationIso: string | null` + best-effort `unresolvedReason`. Frontend parses ISO → seconds; missing durations mark totals `INCOMPLETE`.

## Feature notes & measurement rules

- **Player:** official YouTube IFrame API; position polled ~2×/s (documented resolution). Seeks never credit skipped spans; buffering never counts; duplicate events deduped by segment id; refresh ends verification (no background credit). Completion states: not started / in progress / **verified** (≥ threshold unique coverage, default 90%, Settings 50–100%) / **manual** (checkbox/override, always labelled) / needs revision / unavailable. Embed-disabled videos fall back to Open-on-YouTube (unverifiable there).
- **Coverage quantities** kept separate: unique seconds (interval union), total playback content (incl. repeats), active wall seconds, focused study seconds.
- **History:** focus + playback sessions with cross-midnight splitting at the selected timezone's date boundaries; per-video drill-down; self-reported entries explicitly labelled (never verified).
- **Goals:** video-count, unique-content, focus-time, playback-time, checkpoint; daily or open-ended; achieved only when the condition holds (deduped); missed/paused states honest.
- **Timezone:** custom searchable picker (city/region/alias, live computed UTC offsets, full IANA catalogue with curated fallback, legacy-name resolution for older ICU builds); local + UTC + worldwide zones; events stored as UTC; changing display tz recomputes reports without refetching.
- **Library range explorer:** start/end inputs bound to `1–N`, Full/First/Middle/Final presets, Save; chart selector with **Video duration** (bars only) and **Cumulative duration** (line only) views sharing one data pipeline — never mixed; every entry plotted with adaptive tick labels; incomplete-data warnings. Dashboard/analytics cumulative charts stay line-only.
- **Navigation:** grouped sidebar collapsing to a 68px icon rail (compact status dot, tooltips, content reflow) + mobile drawer (Escape/backdrop close, focus restore), hash routing so back/forward works, compact API status linking to Settings. Tasteful thin scrollbars for the app's own scroll regions; page scrolling stays native. No horizontal page overflow (verified 0px at 360/768/1280).
- **Library sorting:** playlist order, longest/shortest first (numeric `durationSec`), title A–Z/Z–A via one tested `sortEntries` utility; unresolved always last, ties by position, stored order never mutated; sort changes reset to page 1 and pages clamp after filtering.
- **Dropdowns:** shared portal-based listbox (no card can clip it; flips upward when tight; keyboard + screen-reader semantics) used for playlist switching, filters, sorting, goals, arena, history, and preferences. Timezone picker adds search + live offsets.
- **Efficiency:** `uniqueContent ÷ focusedStudy × 100` (null when denominator is 0 — never NaN); utilization capped at 100 with inconsistency rejection; overall is the **aggregate ratio over the current evidence selection, never the mean of dailies**; Evidence filter separates verified vs self-reported; real measurements never clamped (worked examples + definitions in the screen's help box); >100% possible above 1× speed and is not “better”.
- **Arena (optional, off by default):** FIXED basis — average daily content efficiency (volume/XP/tier never ranked). Cohorts 10–2000; rival daily cap 1–12 h default 6 h (rivals only); tier distribution (sums to 100) separate from tier **efficiency bands** (Ultra 100–110% … Below Average 20–39.9%) with per-tier daily variation; coherent per-day histories (focus → daily eff → content, capped by remaining playlist) seeded per calendar date — same seed + settings + window dates = same rivals across refreshes, rolling window slides to new dates as days advance; gamer aliases; eligibility gates with constructive provisional UX (never ranked last for thin data); shared-rank ties; strictly-below percentiles; percentage-point gaps; exact-date window label + period-labelled paginated leaderboard (25/50/100, Top/Near-me, search, jump). Every surface labelled fictional simulation.
- **Reports playlists:** compact searchable table with status dots, per-row overflow menu (rename/archive/remove), bounded scroll for large collections.
- **Storage:** IndexedDB `learnquest-db` v2 (additive migration — v1 keys preserved); versioned JSON backup v2 (restores v1 too); CSV exports carry playlist/position identity; clear-metadata vs clear-all are separate; sim reset never erases real data.

## Verification (actually run)

- Tests **107/107**: backend 6 (incl. ISO-passthrough contract + pagination), frontend 101 (duration/range engine + hand-computed verification fixture, sort utility incl. string-sort trap, custom Dropdown/portal + chart helpers incl. bar-only/line-only separation, playback dedup/seek/thresholds, efficiency edge cases incl. aggregate-vs-mean and full hand-verified path story, goals, competition determinism/aliases/cohort stability/tier-band conformance/session coherence/ties/percentile/gaps, midnight split, DST transitions for New_York/London/Kolkata/Tokyo/UTC, picker catalogue, module parsing, UI workflow tests with seeded IndexedDB).
- Live YouTube verification (with the configured key, never printed): Sigma playlist `PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w` returns **139/139 resolved**, positions 1–139 in order; independently summed: **1–84 = 28:30:15, 85–139 = 28:00:41, total = 56:30:56**, invariant `A+B=C` holds. (Measured values for the report only — the app computes them live from metadata; nothing is hardcoded.)
- `tsc --noEmit` clean in both workspaces; `vite build` + API `tsc` build succeed.
- API smoke: `200 /api/health {hasKey:false}`, `503` playlist without key, `400` missing arg, no secret in bodies. Web preview serves 200.
- **Browser-verified in headless Chromium (Playwright 1.64, real browser): 57/57 checks** across 360/768/1280px — zero horizontal overflow, seeded range total `2:03:05` + incomplete warning, range recalculation `1:00:00`, bar/line view switching without mixing, longest-first row reorder, 80px collapse rail, drawer open/Escape-close, hash routing, arena banner/aliases/rank wording/period labels/pagination/seed explainer, timezone search showing live `UTC+05:30`, zero console/page errors. Screenshots reviewed (dashboard, library, arena, settings).
- Secret audit: no `AIza` key material and no key value in the frontend bundle (single `YOUTUBE_API_KEY=…` documentation string in Settings help text); `backend/.env` + `frontend/.env.local` git-ignored.

## Deploy

- Frontend → Vercel: root `frontend/`, build `npm run build --workspace=frontend`, output `dist`; set `VITE_API_BASE_URL` if API is separate.
- Backend → Render via `render.yaml`: root `backend/`, start `node dist/server.js`; set the five env vars; restrict the key to the host.
