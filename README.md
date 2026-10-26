# LearnQuest — YouTube Course Analytics & Learning Tracker

Turn any public YouTube playlist into a measurable learning journey: exact
per-video duration math (never averages), an embedded player with
verified-coverage tracking, focus sessions, modules, checkpoints, goals,
revision scheduling, efficiency analytics, and an optional fictional Arena —
all local-first, with your data staying in your browser.

> **New here?** Start the app in minutes below, then read the full user manual:
> [HOW_TO_USE_LEARNQUEST.md](./HOW_TO_USE_LEARNQUEST.md).

## What it does

- **Playlist analysis** — import a public YouTube playlist; every entry keeps
  its real duration and totals are computed with integer-second arithmetic.
- **Learning tracking** — mark videos complete by hand (manual) or earn
  **verified** completion through watched coverage in the embedded player.
- **Focus sessions** — a study timer with pause/resume, notes, and manual
  correction; only active seconds are recorded.
- **Organization** - modules (your own chapters), checkpoints (range
  milestones), saved ranges, and a revision workflow with confidence ratings,
  persistent learning records, review history, and an all-lessons browser.
- **Goals & motivation** — daily and flexible goals, streaks, XP, achievements.
- **Efficiency analytics** — unique content ÷ focused study time, with
  aggregate-vs-daily semantics documented in the UI.
- **Arena (optional, off by default)** — a clearly labeled fictional
  simulation that ranks average daily efficiency; never real people.
- **Reports** — versioned (v3) JSON backups, CSV exports, validated atomic restore.

## How it works

```text
progressGameTracker/
├── frontend/    # React + Vite + TS UI; owns ALL learning data (IndexedDB)
├── backend/     # Node + Express proxy: YouTube Data API v3 → normalized metadata
├── docs/audits/ # verification reports (acceptance + analytics + storage)
├── render.yaml  # backend deploy config (rootDir: backend)
├── README.md / HOW_TO_USE_LEARNQUEST.md
```

- The **backend** only fetches and normalizes public playlist metadata
  (original ISO 8601 durations). It keeps a bounded ephemeral cache
  (TTL + 50-playlist LRU) and stores no user data.
- The **frontend** parses durations and computes every total, percentage,
  goal, efficiency figure, and simulated score in one domain engine
  (`frontend/src/domain`). Learning records persist in IndexedDB
  (`learnquest-db`) in your browser.
- The secret API key lives server-side only (`backend/.env`, never committed).

## Technology

Frontend: React 18, Vite 6, TypeScript, Tailwind CSS, Recharts, `idb`.
Backend: Node.js, Express, `express-rate-limit`, `helmet`, `cors`, `dotenv`.
Tests: Vitest, Supertest, Testing Library, fake-indexeddb.

## Requirements

- **Node.js 20+** and **npm 9+** (`node --version`, `npm --version`).
- A **YouTube Data API v3 key** for live playlist imports (or use JSON
  snapshot import, which works fully offline).

## Local setup

Each app installs independently — there is no root install step.

```powershell
# 1. Install dependencies (run once per app)
cd frontend
npm install
cd ..\backend
npm install

# 2. Configure the backend key (see Configuration below)

# 3. Start both servers (two terminals)
# Terminal A:
cd backend
npm run dev      # API on http://localhost:3001
# Terminal B:
cd frontend
npm run dev      # App on http://localhost:5173
```

Open **http://localhost:5173**. Without a backend key, playlist-URL fetching
reports the missing integration; JSON import (Reports) works fully offline.

## Configuration

Backend (`backend/.env` — create from `backend/.env.example`, never commit):

| Variable | Purpose | Default |
|---|---|---|
| `YOUTUBE_API_KEY` | **Secret.** Server-side only | _(required for live imports)_ |
| `PORT` | API port | `3001` |
| `CORS_ORIGIN` | Allowed frontend origin(s) | `http://localhost:5173` |
| `CACHE_TTL_SEC` | Metadata cache TTL | `600` |
| `CACHE_MAX_ENTRIES` | Metadata cache size cap | `50` |
| `RATE_LIMIT_PER_MIN` | Per-IP request limit | `30` |
| `TRUST_PROXY_HOPS` | Trusted reverse-proxy hops; `0` for direct traffic | `1` |

Frontend (`frontend/.env.local`, optional — template: `frontend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API origin prefix; empty = same-origin `/api` (dev proxy handles it) | _(empty)_ |

Production on Vercel: set `VITE_API_BASE_URL` to the Render backend origin
with **no trailing slash and no `/api` suffix**
(e.g. `https://YOUR-RENDER-SERVICE.onrender.com` — your real hostname from
the Render dashboard), on the **Production** environment, then **redeploy**
(Vite embeds it at build time). The app also tolerates a trailing slash,
and the status pill re-checks on tab focus after an outage or cold start.

Order of operations: copy `backend/.env.example` → `backend/.env`, paste the
key, restart the backend, then confirm **Settings → Backend connection**
reads "● Connected — API key configured" (or `GET /api/health` shows
`"hasKey":true`).

## Development commands

Run each from its own directory (`frontend/` or `backend/`):

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server (backend `:3001`, frontend `:5173`) |
| `npm test` | Run that app's test suite (frontend 226, backend 26) |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run lint` | ESLint, real failures exit non-zero (warnings do not) |
| `npm run build` | Production build (`frontend/dist`, `backend/dist`) |
| `npm run start` | _(backend)_ Serve the built API (`node dist/server.js`) |
| `npm run preview` | _(frontend)_ Preview the production build locally |

## Production deployment

- **Backend → Render** via `render.yaml`: service root `backend/`,
  build `npm ci && npm run build`, start `npm run start`. Set
  `YOUTUBE_API_KEY` (secret, not synced), `CORS_ORIGIN` (your frontend
  origin), and the cache/rate-limit vars. Free-tier footprint is small
  (measured ~17 MB heap / ~77 MB RSS with four cached playlists); the
  filesystem is ephemeral by design — nothing essential lives there.
- **Frontend → Vercel** (or any static host): project root `frontend/`,
  build `npm run build`, output `dist`. Set `VITE_API_BASE_URL` to the
  backend origin when the API is hosted separately.

## Data persistence and privacy

- Learning records (progress, sessions, goals, modules, checkpoints,
  revision data, settings) live **only in your browser's IndexedDB**.
  There are no accounts and no cloud sync — export JSON backups regularly
  (Reports → Backup JSON) and keep the file yourself.
- The backend sees only playlist metadata requests; it stores no learning
  history. The YouTube API is used solely to resolve public playlist
  entries and durations.
- Deleting browser data (or an unrecoverable storage failure) deletes local
  progress. A storage read failure shows a recovery screen instead of treating
  the database as empty; a write failure shows one actionable backup notice.
  Concurrent tabs are last-writer-wins.
- Small UI-only preferences and an interrupted-focus timer snapshot are kept
  in `localStorage` on this device; they are never sent to the backend.

## Limitations

- Timed in-browser playback events, overnight soak runs, live quota
  metering, 2000+-video stress, and live storage-quota exhaustion are
  verified by unit/integration tests and inspection — not by live runs here.
  See [`docs/audits/V7_FINAL_ACCEPTANCE.md`](./docs/audits/V7_FINAL_ACCEPTANCE.md).
- Playlists are capped at **1000 entries** per fetch (larger ones are
  rejected with a clear error, never silently truncated).
- Quota costs ≈ 5 units per 100-video import/refresh, ≈ 21 per 500-video
  one; navigation costs nothing. Your Google Cloud quota may differ from
  the 10,000/day default.

## Troubleshooting

| Symptom | Fix |
|---|---|
| API key missing | Follow Configuration; restart backend; Recheck in Settings |
| Invalid/restricted key | Allow YouTube Data API v3 + backend host in Google Cloud; restart |
| Quota exhausted | Wait for daily reset; use JSON import meanwhile |
| Playlist fetch fails | Re-paste URL/ID; check public visibility; try Refresh active |
| Unresolved videos | Expected for deleted/private/region-blocked items; totals stay labeled incomplete |
| Player won't embed (101/150) | Use Open on YouTube; log a self-reported History entry |
| Totals look wrong | Confirm range endpoints and unresolved flags; content duration ≠ study time |
| Port conflict (`EADDRINUSE`) | Stop the other process or change `PORT` in `backend/.env` |
| Frontend can't reach backend | Check `VITE_API_BASE_URL` (Production env, exact Render origin, no trailing slash or `/api` suffix, then redeploy), `CORS_ORIGIN` (exact Vercel origin), and that both dev servers run |

## Documentation

- [HOW_TO_USE_LEARNQUEST.md](./HOW_TO_USE_LEARNQUEST.md) — complete user manual.
- [docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md](./docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md) — current remediation report and verification matrix.
- [docs/audits/V7_FINAL_ACCEPTANCE.md](./docs/audits/V7_FINAL_ACCEPTANCE.md) — historical feature acceptance matrix and real-browser evidence.
- [docs/audits/V6_FINAL_AUDIT.md](./docs/audits/V6_FINAL_AUDIT.md) — reliability/API-efficiency audit.
- [docs/audits/TIME_AND_ANALYTICS_AUDIT.md](./docs/audits/TIME_AND_ANALYTICS_AUDIT.md) — time-correctness matrix.
- [docs/audits/STORAGE_AND_SCALE_AUDIT.md](./docs/audits/STORAGE_AND_SCALE_AUDIT.md) — storage, memory, and scale measurements.
