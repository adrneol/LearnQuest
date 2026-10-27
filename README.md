# LearnQuest — YouTube Course Analytics & Learning Tracker

Turn any public YouTube playlist into a measurable learning journey: exact
per-video duration math (never averages), an embedded player with
verified-coverage tracking, focus sessions, modules, checkpoints, goals,
revision scheduling, efficiency analytics, and an optional fictional Arena.

LearnQuest now has **authenticated multi-user accounts**: Google is the only
registration path, password sign-in and single-use email-link recovery are
available afterwards, and learning data is stored server-side in MongoDB and
scoped to the signed-in account. A local IndexedDB path remains for automated tests and development.

> **New here?** Start the app in minutes below, then read the full user manual:
> [HOW_TO_USE_LEARNQUEST.md](./HOW_TO_USE_LEARNQUEST.md).

## What it does

- **Playlist analysis** — import a public YouTube playlist; every entry keeps
  its real duration and totals are computed with integer-second arithmetic.
- **Learning tracking** — mark videos complete by hand (manual) or earn
  **verified** completion through watched coverage in the embedded player.
- **Focus sessions** — a study timer with pause/resume, notes, and manual
  correction; only active seconds are recorded.
- **Organization** — modules, checkpoints (one video-range field with an
  automatic label), saved ranges, and a revision workflow with confidence
  ratings, persistent learning records, review history, and an all-lessons
  browser.
- **Two-choice playlist removal** — **archive** keeps every record and can be
  restored, while **permanent delete** removes only reliably attributable
  account-owned records after typing the displayed title.
- **Goals & motivation** — daily and flexible goals, streaks, XP, achievements.
- **Efficiency analytics** — unique content ÷ focused study time, with
  aggregate-vs-daily semantics documented in the UI.
- **Arena (optional, off by default)** — a clearly labeled fictional
  simulation that ranks average daily efficiency; never real people.
- **Accounts** — Google-only registration, Argon2id password sign-in,
  single-use Brevo email links for password recovery and email verification,
  server-side sessions, account export and deletion.
- **Reports** — versioned (v3) JSON backups, CSV exports, validated atomic restore.

## How it works

```text
progressGameTracker/
├── frontend/    # React + Vite + TS UI; account UI + learning data views
├── backend/     # Node + Express: YouTube metadata, auth, accounts, MongoDB
├── docs/        # user-facing setup docs
├── docs/audits/ # verification reports (acceptance + analytics + storage)
├── render.yaml  # backend deploy config (rootDir: backend)
├── README.md / HOW_TO_USE_LEARNQUEST.md
```

- The **backend** fetches and normalizes public playlist metadata, serves the
  authenticated account API, and stores learning collections in MongoDB.
  Password hashes use Argon2id; email action tokens are stored only as
  HMAC digests, are purpose-bound and atomically single-use; sessions are
  server-side and rotated on privilege changes.
- The **frontend** parses durations and computes every total, percentage,
  goal, efficiency figure, and simulated score in one domain engine
  (`frontend/src/domain`). In production it defaults to cloud mode and never
  silently falls back to browser-only state for an authenticated account.
- Secrets live server-side only (`backend/.env`, never committed). Google,
  Brevo, and MongoDB credentials are never sent to the browser.

## Technology

Frontend: React 18, Vite 6, TypeScript, Tailwind CSS, Recharts, `idb`.
Backend: Node.js 24 LTS, Express, MongoDB driver, `jose`, Argon2id
(`@node-rs/argon2`), Zod, `express-rate-limit`, `helmet`, `cors`.
Tests: Vitest, Supertest, Testing Library, fake-indexeddb.

## Requirements

- **Node.js 24.22.1+ (24 LTS)** and **npm 9+** (`node --version`,
  `npm --version`). `backend/.node-version` pins the patched version.
- A **MongoDB** deployment (Atlas or self-hosted) for accounts and cloud data.
- A **Google OAuth 2.0 / OIDC** web client for Google-only registration.
- A **Brevo** account, API key, and verified sender for password-reset and
  email-verification links.
- A **YouTube Data API v3 key** for live playlist imports (JSON snapshot
  import works without it).

## Local setup

Each app installs independently — there is no root install step.

```powershell
# 1. Install dependencies (run once per app)
cd frontend
npm install
cd ..\backend
npm install

# 2. Configure backend/.env from backend/.env.example (see Configuration)
#    Generate the two required secrets once:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Start both servers (two terminals)
# Terminal A:
cd backend
npm run dev      # API on http://localhost:3001
# Terminal B:
cd frontend
npm run dev      # App on http://localhost:5173
```

Open **http://localhost:5173**. With account services configured, the login
screen offers **Continue with Google**; registration completes with a
username, display name, and password. If required credentials are missing,
the app shows a fail-closed setup screen instead of enabling a fake login.

### External service setup

Detailed step-by-step instructions (Google redirect URI, Brevo sender
verification, MongoDB Atlas network access, Render/Vercel variables) are in
[docs/DEPLOYMENT_MULTIUSER.md](./docs/DEPLOYMENT_MULTIUSER.md).

## Configuration

Backend (`backend/.env` — create from `backend/.env.example`, never commit):

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | API port | `3001` |
| `APP_ORIGIN` | Frontend origin used for cookies/CORS/links | `http://localhost:5173` |
| `API_ORIGIN` | Backend origin; default Google redirect base | `http://localhost:3001` |
| `CORS_ORIGIN` | Exact allowed browser origin(s), comma-separated | `http://localhost:5173` |
| `TRUST_PROXY_HOPS` | Trusted reverse-proxy hops; `0` for direct traffic | `1` |
| `YOUTUBE_API_KEY` | **Secret.** Server-side only | _(optional)_ |
| `CACHE_TTL_SEC` | Metadata cache TTL | `600` |
| `CACHE_MAX_ENTRIES` | Metadata cache size cap | `50` |
| `MONGODB_URI` | **Secret.** MongoDB connection string | _(required)_ |
| `MONGODB_DB_NAME` | Database name | `learnquest` |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID | _(required)_ |
| `GOOGLE_CLIENT_SECRET` | **Secret.** Google OAuth client secret | _(required)_ |
| `GOOGLE_REDIRECT_URI` | Must end in `/api/auth/google/callback` | `${API_ORIGIN}/api/auth/google/callback` |
| `BREVO_API_KEY` | **Secret.** Brevo transactional email key | _(required)_ |
| `BREVO_SENDER_EMAIL` | Brevo-verified sender address | _(required)_ |
| `BREVO_SENDER_NAME` | Sender display name | `LearnQuest` |
| `SESSION_SECRET` | **Secret.** 32+ chars; generate, never reuse | _(required)_ |
| `EMAIL_ACTION_HMAC_SECRET` | **Secret.** 32+ chars; signs single-use email action tokens | _(required)_ |
| `SESSION_IDLE_HOURS` | Idle session lifetime | `168` |
| `SESSION_ABSOLUTE_DAYS` | Absolute session lifetime | `30` |
| `REAUTH_WINDOW_MIN` | Recent reauthentication window | `10` |
| `EMAIL_ACTION_TTL_MIN` | Password-reset/email-verification link lifetime | `30` |
| `EMAIL_ACTION_RESEND_SEC` | Cooldown before another link is issued | `60` |
| `AUTH_RATE_LIMIT_PER_MIN` | Auth endpoint limit per IP | `20` |
| `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` | Email-action request limit per IP | `8` |
| `ACCOUNT_MAX_STATE_BYTES` | Import/export envelope cap | `8388608` |

`OTP_HMAC_SECRET`, `OTP_TTL_MIN`, `OTP_RESEND_SEC`, and
`OTP_RATE_LIMIT_PER_15MIN` are accepted only as legacy fallbacks when the new
variables are empty. New deployments should set the `EMAIL_ACTION_*` names.

Frontend (`frontend/.env.local`, optional — template: `frontend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API origin prefix; empty = same-origin `/api` (dev proxy handles it) | _(empty)_ |

Production has two supported connection layouts; see
[`docs/DEPLOYMENT_MULTIUSER.md`](./docs/DEPLOYMENT_MULTIUSER.md#6-cookie-safe-production-topology):

- **Same-origin `/api` proxy (recommended):** keep `VITE_API_BASE_URL` empty
  and add a Vercel rewrite from `/api/*` to the Render service. The session
  cookie stays first-party.
- **Same-site custom domains:** serve the app at `app.example.com` and the API
  at `api.example.com`, then set `VITE_API_BASE_URL=https://api.example.com`
  (no trailing slash, no `/api` suffix) on Vercel **Production** and redeploy.

Do not point a `*.vercel.app` frontend directly at `*.onrender.com`. That is a
cross-site request, and the `SameSite=Lax` session cookie is not sent. The app
tolerates a trailing slash, and the status pill re-checks on tab focus after an
outage or cold start.

Order of operations: copy `backend/.env.example` → `backend/.env`, fill in
MongoDB/Google/Brevo credentials, generate unique `SESSION_SECRET` and
`EMAIL_ACTION_HMAC_SECRET`, restart the backend, then confirm the login screen
shows no setup warning (or `GET /api/health` reports the missing variable
names).

## Development commands

Run each from its own directory (`frontend/` or `backend/`):

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server (backend `:3001`, frontend `:5173`) |
| `npm test` | Run that app's test suite |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run lint` | ESLint, real failures exit non-zero (warnings do not) |
| `npm run build` | Production build (`frontend/dist`, `backend/dist`) |
| `npm run start` | _(backend)_ Serve the built API (`node dist/server.js`) |
| `npm run preview` | _(frontend)_ Preview the production build locally |

## Production deployment

- **Backend → Render** via `render.yaml`: service root `backend/`,
  build `npm ci && npm run build`, start `npm run start`.
  `render.yaml` requests Node `24.22.1`; `backend/.node-version` and
  `backend/package.json#engines` pin the same patched 24 LTS line.
  **Render Dashboard caveat:** a dashboard-level `NODE_VERSION` environment
  variable overrides the Blueprint value. Confirm it is either absent or set
  to `24.22.1` — an older pinned version silently defeats this repository
  setting.
- Set the secret variables (`MONGODB_URI`, `GOOGLE_CLIENT_SECRET`,
  `BREVO_API_KEY`, `YOUTUBE_API_KEY`) in Render, never in Git. The Blueprint
  generates `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET`; changing
  `SESSION_SECRET` signs out sessions, and changing
  `EMAIL_ACTION_HMAC_SECRET` invalidates pending email action links.
- Use a cookie-safe topology. Set `APP_ORIGIN` and `CORS_ORIGIN` to the public
  app origin. The current production layout is:
  - Frontend: `https://learn-quest-one.vercel.app`
  - Backend: `https://learnquest-hhiv.onrender.com`
  - Callback: `https://learn-quest-one.vercel.app/api/auth/google/callback`
  - `frontend/vercel.json` rewrites `/api/*` to the Render service, and
    `VITE_API_BASE_URL` stays empty so the session cookie is first-party.
  - Render sets `TRUST_PROXY_HOPS=2` for the exact browser → Vercel → Render →
    Express chain. Never raise it beyond the number of proxies actually
    present.
  Register the exact callback in Google Cloud. Same-site custom domains remain
  the only supported alternative; a direct `*.vercel.app` → `*.onrender.com`
  API origin is not supported with the `SameSite=Lax` cookie.
- **Frontend → Vercel** (or any static host): project root `frontend/`,
  build `npm run build`, output `dist`. Keep `frontend/vercel.json` at the
  project root so the rewrite is applied. Do not configure a direct
  `*.vercel.app` → `*.onrender.com` API origin with the current cookie policy.

## Data persistence and privacy

- In production, learning records (playlists, progress, sessions, goals,
  modules, checkpoints, revision data, settings, XP) are stored in MongoDB
  and scoped by the authenticated `userId`. The browser is not treated as the
  source of truth for an authenticated account, and a failed cloud read never
  falls back to an apparently empty local database.
- Passwords are hashed with Argon2id. Raw passwords, password hashes, raw
  email action tokens, and session tokens are never included in account
  exports.
- Sessions use `HttpOnly` cookies; production uses `Secure`,
  `SameSite=Lax`, and `__Host-` cookie names. Mutations require a CSRF token
  and an exact trusted origin.
- Legacy browser data is offered for explicit import only after sign-in.
  Existing cloud records win on identical IDs; the local source is retained
  on failure and can be retried safely. A claim marker prevents another
  account from inheriting the same local data.
- Export JSON backups from Reports or the account menu. Deleting the account
  removes account-owned MongoDB records and sessions; it cannot be undone.
- Small UI-only preferences and an interrupted-focus timer snapshot remain in
  `localStorage` on the device.

## Limitations

- Live MongoDB, Google, and Brevo integrations require real credentials and
  network access; the automated suites use in-memory fakes. The production
  proxy/session chain, Render Node `24.22.1` runtime, and live email delivery
  were not observable from this environment. See
  [`docs/audits/LEARNQUEST_POST_REPAIR_UX_EMAIL_PERSISTENCE_2026-10-27.md`](./docs/audits/LEARNQUEST_POST_REPAIR_UX_EMAIL_PERSISTENCE_2026-10-27.md)
  and the prior
  [`docs/audits/LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md`](./docs/audits/LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md)
  for the exact verification boundary and owner-side checks.
- Timed in-browser playback events, overnight soak runs, live quota metering,
  2000+-video stress, and live storage-quota exhaustion are verified by
  unit/integration tests and inspection — not by live runs here. See
  [`docs/audits/V7_FINAL_ACCEPTANCE.md`](./docs/audits/V7_FINAL_ACCEPTANCE.md).
- Playlists are capped at **1000 entries** per fetch (larger ones are rejected
  with a clear error, never silently truncated).
- Quota costs ≈ 5 units per 100-video import/refresh, ≈ 21 per 500-video
  one; navigation costs nothing. Your Google Cloud quota may differ from
  the 10,000/day default.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Setup/configuration screen | Fill the listed names in `backend/.env`, restart, retry |
| Google sign-in fails | Check the OAuth client, exact redirect URI, `GOOGLE_CLIENT_ID`/secret, and consent-screen test users |
| Recovery email not received | Check Brevo Transactional Email Logs for the recipient and status; verify sender/domain authentication (a verified Gmail sender can still fail DKIM/DMARC alignment), API key permissions, and spam; wait for the resend cooldown; request a new link (older links are invalidated). An unknown or ineligible account intentionally receives no message. |
| MongoDB auth/data errors | Check `MONGODB_URI`, Atlas network access, and database user permissions; no local fallback is used |
| API key missing | Follow Configuration; restart backend; Recheck in Settings |
| Invalid/restricted key | Allow YouTube Data API v3 + backend host in Google Cloud; restart |
| Quota exhausted | Wait for daily reset; use JSON import meanwhile |
| Playlist fetch fails | Re-paste URL/ID; check public visibility; try Refresh active |
| Unresolved videos | Expected for deleted/private/region-blocked items; totals stay labeled incomplete |
| Player won't embed (101/150) | Use Open on YouTube; log a self-reported History entry |
| Totals look wrong | Confirm range endpoints and unresolved flags; content duration ≠ study time |
| Port conflict (`EADDRINUSE`) | Stop the other process or change `PORT` in `backend/.env` |
| Frontend can't reach backend | Check the chosen topology in `docs/DEPLOYMENT_MULTIUSER.md`: same-origin `/api` proxy or same-site custom domains. For custom domains, verify `VITE_API_BASE_URL` (no trailing slash or `/api` suffix, then redeploy) and `CORS_ORIGIN`. A `*.vercel.app` → `*.onrender.com` direct API URL fails authentication because the Lax cookie is cross-site |
| Node version warning on Render | Remove/raise a dashboard `NODE_VERSION` override; the repo pins 24.22.1 |

## Documentation

- [HOW_TO_USE_LEARNQUEST.md](./HOW_TO_USE_LEARNQUEST.md) — complete user manual.
- [docs/DEPLOYMENT_MULTIUSER.md](./docs/DEPLOYMENT_MULTIUSER.md) — MongoDB, Google, Brevo, Render, and Vercel setup.
- [docs/audits/LEARNQUEST_POST_REPAIR_UX_EMAIL_PERSISTENCE_2026-10-27.md](./docs/audits/LEARNQUEST_POST_REPAIR_UX_EMAIL_PERSISTENCE_2026-10-27.md) — current onboarding UX, password recovery, Brevo diagnostics, and cloud-persistence report.
- [docs/audits/LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md](./docs/audits/LEARNQUEST_AUTH_SECURITY_REPAIR_2026-10-27.md) — prior auth, email-link, proxy, and verification report.
- [docs/audits/LEARNQUEST_MULTIUSER_PLATFORM_REPORT_2026-10-27.md](./docs/audits/LEARNQUEST_MULTIUSER_PLATFORM_REPORT_2026-10-27.md) — prior multi-user platform report (historical; superseded by the auth/security repair above).
- [docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md](./docs/audits/LEARNQUEST_IMPLEMENTATION_REPORT_2026-10-27.md) — prior remediation report and verification matrix.
- [docs/audits/V7_FINAL_ACCEPTANCE.md](./docs/audits/V7_FINAL_ACCEPTANCE.md) — historical feature acceptance matrix and real-browser evidence.
- [docs/audits/V6_FINAL_AUDIT.md](./docs/audits/V6_FINAL_AUDIT.md) — reliability/API-efficiency audit.
- [docs/audits/TIME_AND_ANALYTICS_AUDIT.md](./docs/audits/TIME_AND_ANALYTICS_AUDIT.md) — time-correctness matrix.
- [docs/audits/STORAGE_AND_SCALE_AUDIT.md](./docs/audits/STORAGE_AND_SCALE_AUDIT.md) — storage, memory, and scale measurements.
