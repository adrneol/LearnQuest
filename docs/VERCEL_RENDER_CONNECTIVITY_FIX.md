# VERCEL ↔ RENDER CONNECTIVITY FIX — Backend Unreachable (V8.3)

Date: 2026-10-13. Symptom on the deployed frontend: `Backend unreachable` /
`API offline — setup` with Vercel variables reportedly set.

> **Security first:** a screenshot exposed what appears to be a real YouTube
> API key. **Revoke or rotate that key in Google Cloud now**, put the
> replacement in the Render dashboard (`YOUTUBE_API_KEY`), and never commit,
> print, or paste keys anywhere else. This document contains no secret
> values. The YouTube key must stay server-side on Render — never move it to
> Vercel or the frontend bundle (verified clean: 0 `AIza` in
> `frontend/dist`; the single `YOUTUBE_API_KEY=…` string is Settings help
> text, not a value).

## 1. Verified root cause

**Two deployment-configuration gaps, no application bug.** The code traces
clean and reports the outage truthfully:

- **Primary: the production backend URL is not discoverable from the
  repository, and the deployed frontend has no working API base.** The only
  production hostname in the repo is the *frontend* origin
  (`https://learnquest.vercel.app`, in `render.yaml` as `CORS_ORIGIN`).
  The client builds `${VITE_API_BASE_URL}/api/health`; with the variable
  missing (or the build predating it — Vite embeds it at build time), the
  app calls same-origin `/api/health` on static Vercel hosting, which has
  no such route → fetch fails → `checkApiHealth` returns `{ok:false}` →
  pill reads `API offline`. Inspected `playlistApi.ts`, `App.tsx`,
  `Settings.tsx`; failure path tested (failed checks stay visibly failed).
- **Backend URL unconfirmed:** `https://learnquest-api.onrender.com`
  (conventional name from `render.yaml`, tested 6× over ~2 min to allow
  cold start) returns **404 every time** — Render routing answers but no
  service listens there. Either the service URL differs or no successful
  deploy exists there yet (V8.1/V8.2 backend startup issue may still be
  open). The health route itself needs no YouTube call and was proven
  locally (`{ok:true,hasKey:true}`).
- **Wrong app at the known frontend URL:** `https://learnquest.vercel.app/`
  serves a 644-byte Create-React-App shell (`<title>React App</title>`,
  `/static/js/main.*.js`) — definitively not this repo's Vite build
  (`/assets/index-*.js`, "LearnQuest — …" title). So the reported UI text
  comes either from a different deployment or from the real frontend hosted
  at an unknown URL.

Ruled out by inspection/test: CORS logic (exact-origin echo verified live;
unlisted origins get no header — correctly restrictive), route mounting
(`/api/health` + `/api/playlist` + `/api/cache` all served locally),
response-schema parsing, PORT handling (Render's `PORT` honored), and
preflight (plain GET + `Accept` header = simple request, none needed).

## 2. URLs (no secrets)

- Frontend (repo-known): `https://learnquest.vercel.app` — currently serves
  a non-LearnQuest CRA shell (measured 200, 644 B).
- Backend: **unknown from the repo** — owner must supply the real Render
  service URL (Dashboard → service → URL at top). `learnquest-api.onrender.com`
  was tested and is NOT it (consistent 404).

## 3. Required Vercel Production variables

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://YOUR-RENDER-SERVICE.onrender.com` (real URL from Render dashboard; **no trailing slash, no `/api` suffix**) | Must be set on **Production** (not only Preview/Development); changing it requires **redeploy** (Vite build-time embed) |

Same value must be reachable at `<value>/api/health` returning
`{ok:true,...}` before the frontend can show healthy.

## 4. Required Render backend variables

`YOUTUBE_API_KEY` (present=true/false only — value never displayed;
**rotate it after the screenshot exposure**), `CORS_ORIGIN` =
**exactly** the deployed Vercel origin (scheme included, e.g.
`https://your-frontend.vercel.app`, no trailing slash — `cors` compares
origins directly), `PORT` (or Render's provided port — code honors it),
`CACHE_TTL_SEC`, `CACHE_MAX_ENTRIES`, `RATE_LIMIT_PER_MIN`. Do not set
`VITE_API_BASE_URL` as a substitute for `CORS_ORIGIN`.

## 5. Dashboard actions still required (owner)

1. Rotate the exposed YouTube key; store the replacement in Render.
2. Confirm the Render service is deployed from `main` (≥ `0850079`) with
   Root `backend`, Build `npm ci && npm run build`, Start `npm run start`;
   copy the real service URL.
3. Set `CORS_ORIGIN` to the exact Vercel frontend origin.
4. In Vercel **Production**, set `VITE_API_BASE_URL` to the Render URL
   (format per §3) and **redeploy**; allow ~1 min for free-tier cold start,
   then confirm the pill reads `● API ready` (Recheck retries on demand;
   the pill now also auto-recovers on tab focus).

## 6. Code changes and tests (this pass)

- `frontend/src/services/api/playlistApi.ts`: exported `getApiBase()` /
  `apiUrl()` — strips trailing slashes (a `...onrender.com/` value can no
  longer yield `//api/...` 404s); static `import.meta.env` access so Vite
  inlines the value at build. Both endpoints use it. No route changes.
- `frontend/src/app/App.tsx`: while offline, re-run the cheap health check
  on window focus/visibility (cold-start wake and outage recovery without
  reload); silent once healthy — zero extra traffic when connected.
- `frontend/.env.example`: documents the production shape with a placeholder
  hostname (no real URL invented).
- `frontend/tests/api-client.test.tsx` (new, 6 tests): base contract
  (empty/trailing-slash), failure stays failed, offline→focus→recovery.
- Suites: frontend **174/174**, backend **18/18**; `tsc` clean both;
  production builds succeed; real-Chromium E2E **25/25** re-run with the
  changes (workflows, 0px overflow ×6 widths, zero unexpected console
  errors); bundle secret scan clean; CORS echo/block verified live
  against the local backend.

## 7. Remaining limitations

- Live Vercel↔Render handshake NOT verified (real URLs unknown here) —
  §5 must be done by the owner; then `.../api/health` in a browser is the
  one-command proof.
- Free-tier cold starts (~up to a minute) still read as "API offline" until
  the first successful check; the pill now recovers via Recheck or tab
  focus instead of requiring reload.
- A `VITE_API_BASE_URL` ending in `/api` is still a misconfiguration (it
  would build `/api/api/...`); the documented contract forbids the suffix
  rather than guessing intent.

## Verdict

`DASHBOARD CONFIGURATION REQUIRED`
