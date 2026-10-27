# LearnQuest Multi-User Deployment Guide

Date: 2026-10-27
Applies to: backend `0.3.0`, frontend `0.2.0`

This guide covers the external services required by the authenticated
multi-user platform. It documents configuration only; it does **not** claim
that live Google, Brevo, MongoDB, Render, or Vercel verification was performed
from the development environment. No secret values belong in this file.

## 1. What must exist

| Service | Used for | Required in production |
|---|---|---|
| MongoDB | Accounts, sessions, email action tokens, per-user learning collections | Yes |
| Google OAuth/OIDC | Only registration path; stable provider subject | Yes |
| Brevo | Single-use password-reset and email-verification links | Yes |
| YouTube Data API v3 | Live playlist metadata imports | Optional (JSON import works without it) |

If MongoDB, Google, Brevo, `SESSION_SECRET`, or
`EMAIL_ACTION_HMAC_SECRET` is missing, production startup fails closed. In
development the API starts in a clearly identified setup-required state;
account endpoints do not fall back to browser-only storage.

## 2. Generate local secrets

From `backend/`, generate two independent values and paste them into the
ignored `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use the output once for `SESSION_SECRET` and generate a second value for
`EMAIL_ACTION_HMAC_SECRET`. Never reuse them across environments. Rotating
`SESSION_SECRET` signs out sessions; rotating `EMAIL_ACTION_HMAC_SECRET`
invalidates pending email action links. Existing deployments that already have
`OTP_HMAC_SECRET` may keep it as a legacy fallback while setting the new name;
new deployments should use only `EMAIL_ACTION_HMAC_SECRET`.

## 3. MongoDB

1. Create a database (MongoDB Atlas free tier is sufficient for development).
2. Create a database user with read/write access to the chosen database only.
3. Add the backend host's egress IPs to Atlas network access. Render's egress
   addresses are not static on all plans; use a deliberate allow-list, not a
   permanent `0.0.0.0/0` rule, whenever your plan permits.
4. Set:
   - `MONGODB_URI=mongodb+srv://...` (secret; never commit or print it)
   - `MONGODB_DB_NAME=learnquest`
5. The API creates its indexes and TTL collections on first connection:
   `lq_accounts`, `lq_sessions`, `lq_action_tokens`, `lq_oauth_states`,
   `lq_deletions`, `lq_migrations`, `lq_state_versions`, and the `lq_data_*`
   user collections. Legacy `lq_challenges` and `lq_reset_grants` documents
   are intentionally left untouched for a non-destructive rollout; new
   password-reset and email-verification links use only `lq_action_tokens`.
6. Confirm the backend log says `MongoDB connected` without printing the URI.
   If it says configured-but-unreachable, accounts stay unavailable; there is
   no local fallback.

## 4. Google OAuth / OIDC

1. In Google Cloud Console, configure the OAuth consent screen. Add test users
   while the app is in testing mode.
2. Create an **OAuth 2.0 Client ID → Web application**.
3. Add an authorized redirect URI exactly matching the public callback the
   browser uses:
   - Local: `http://localhost:3001/api/auth/google/callback`
   - Production, same-origin `/api` proxy (current LearnQuest deployment):
     `https://learn-quest-one.vercel.app/api/auth/google/callback`
   - Production, same-site custom domains:
     `https://api.YOUR-DOMAIN/api/auth/google/callback`
   Do not register the private Render hostname if the browser is expected to
   use a different public origin. See section 6 for the cookie topology.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret), and
   `GOOGLE_REDIRECT_URI`. `GOOGLE_REDIRECT_URI` must end with
   `/api/auth/google/callback` and must use HTTPS in production.
5. Registration is Google-only: the verified Google email becomes the initial
   account email. The user then chooses a username, display name, and password.
6. Sign-in and registration intents are distinct. **Sign in with Google** never
   creates an account: an unknown Google identity is redirected back with
   `google_account_not_found`. **Create an account** creates a pending account
   only after the Google identity is verified; an existing completed account
   is redirected to sign in instead of being silently signed in through the
   registration route.
7. Server-side verification checks the ID token issuer, audience, nonce,
   expiry, and verified email, and uses the stable Google `sub` as identity.
   OAuth state is single-use with PKCE. Short-lived Google onboarding sessions
   are bound to the verified subject.

## 5. Brevo email

1. Create a Brevo account and an API key with transactional-email permission.
2. Verify the sender address or authenticate the sending domain in Brevo.
3. Set:
   - `BREVO_API_KEY` (secret)
   - `BREVO_SENDER_EMAIL` (must be verified in Brevo)
   - `BREVO_SENDER_NAME=LearnQuest`
4. The API sends professional HTML and plain-text email containing a
   single-use action link:
   - **Password reset:** opens the app's reset screen. The opaque token is
     stored only as an HMAC digest, expires after 30 minutes by default, is
     bound to the account and purpose, and is consumed atomically by an
     explicit `POST /api/auth/password/reset`.
   - **Email change:** sent to the new address. The old address remains active
     until the link is confirmed with an explicit
     `POST /api/account/email/confirm`; success revokes every session and
     notifies the previous address.
5. Requesting a newer link invalidates outstanding links for the same account
   and purpose. A 60-second resend cooldown, an 8-per-15-minute IP rate limit,
   and a generic response for unknown accounts limit abuse and enumeration.
   Mail scanners that merely open a link cannot consume the token because the
   browser exchange is a POST.
6. If Brevo is not configured, recovery and email verification are disabled
   rather than faked.

## 6. Cookie-safe production topology

Production uses the `__Host-lq_session` cookie with `Secure`, `HttpOnly`,
`SameSite=Lax`, and `Path=/`. `SameSite=Lax` means the browser sends the
session cookie only when the request is **same-site** with the page that set
it. A frontend on `*.vercel.app` calling an API on `*.onrender.com` is
cross-site, so the browser omits the cookie on fetch/API requests even though
CORS is configured correctly. Sign-in may appear to succeed once (the OAuth
redirect response sets a cookie) and then every authenticated request returns
`401`. That topology is not supported.

Choose one of these two supported layouts before configuring Render or Vercel.

### Option A — same-origin `/api` proxy (recommended)

Vercel serves the SPA and proxies `/api/*` to the Render service. The browser
only sees the frontend origin, so the session cookie is first-party.

1. Keep `VITE_API_BASE_URL` empty; the client uses relative `/api` URLs.
2. Keep `frontend/vercel.json` in the Vercel project root. The current file
   rewrites `/api/*` to the real Render service:

   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://learnquest-hhiv.onrender.com/api/:path*"
       }
     ]
   }
   ```

   Vercel does not expand environment variables in `vercel.json` rewrite
   destinations. If the Render service hostname changes, update this file and
   redeploy; do not leave a stale destination.
3. Render for the current deployment:
   - `APP_ORIGIN=https://learn-quest-one.vercel.app`
   - `CORS_ORIGIN=https://learn-quest-one.vercel.app`
   - `GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback`
   - `API_ORIGIN=https://learnquest-hhiv.onrender.com` (direct service
     origin, used as a config value; the browser reaches it through the proxy)
4. Register the `GOOGLE_REDIRECT_URI` above in Google Cloud.
5. Verify that `https://learn-quest-one.vercel.app/api/health` reaches Render
   and that the `Set-Cookie` response has no `Domain` attribute.
6. The Vercel proxy adds an edge hop. Set `TRUST_PROXY_HOPS=2` for the exact
   browser → Vercel edge → Render edge → Express chain. If rate limiting or
   audit hashes show the same client IP for every user, inspect the actual
   `X-Forwarded-For` chain instead of raising the value blindly. Never trust
   more hops than are present.

### Option B — same-site custom domains

Use two subdomains under the **same registrable domain**, for example
`app.example.com` on Vercel and `api.example.com` on Render. Cross-origin CORS
still applies, but the requests are same-site, so the Lax cookie is sent.

1. Vercel Production: `VITE_API_BASE_URL=https://api.example.com` (no trailing
   slash, no `/api` suffix), then redeploy.
2. Render:
   - `APP_ORIGIN=https://app.example.com`
   - `CORS_ORIGIN=https://app.example.com`
   - `GOOGLE_REDIRECT_URI=https://api.example.com/api/auth/google/callback`
   - `API_ORIGIN=https://api.example.com`
3. Register the API callback in Google Cloud.

Do **not** use `SameSite=None` as a workaround for a cross-site deployment.
It weakens the CSRF boundary and is blocked by third-party-cookie policies in
several browsers; the two layouts above keep the cookie first-party.

## 7. Backend on Render

`render.yaml` is the source of truth for the Blueprint:

```yaml
rootDir: backend
buildCommand: npm ci && npm run build
startCommand: npm run start
```

Environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.22.1` |
| `APP_ORIGIN` | `https://learn-quest-one.vercel.app` for the current deployment; otherwise the public frontend origin |
| `CORS_ORIGIN` | Same exact public frontend origin (comma-separated for additional trusted origins) |
| `API_ORIGIN` | `https://learnquest-hhiv.onrender.com` for the current proxy deployment; otherwise the public API origin |
| `GOOGLE_REDIRECT_URI` | `https://learn-quest-one.vercel.app/api/auth/google/callback` for the current proxy deployment; otherwise the public callback ending in `/api/auth/google/callback` |
| `TRUST_PROXY_HOPS` | `2` for Vercel `/api` proxy → Render → Express; `1` for Render alone; `0` only when Express is directly exposed |
| `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `YOUTUBE_API_KEY` | Set in the dashboard, never in Git |
| `SESSION_SECRET`, `EMAIL_ACTION_HMAC_SECRET` | Blueprint-generated; keep stable after first deploy |
| `EMAIL_ACTION_TTL_MIN`, `EMAIL_ACTION_RESEND_SEC`, `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` | `30`, `60`, `8` in the Blueprint; tune deliberately |
| `AUTH_RATE_LIMIT_PER_MIN` | `20` in the Blueprint |

### Node version override warning

`render.yaml` requests Node `24.22.1`, `backend/.node-version` pins the same
version, and `backend/package.json#engines` requires `>=24.22.1 <25`. A
**dashboard-level `NODE_VERSION` environment variable overrides the
Blueprint**. Confirm it is absent or also `24.22.1`; an old dashboard pin
silently defeats the repository setting and can redeploy an unpatched runtime.
The repository validation for this change ran on local Node `24.11.0`, so the
actual Render runtime must be confirmed in the service dashboard/logs after
deploy; local tests cannot prove the remote version.

### Cookies and CORS

Production uses `__Host-lq_session` with `Secure`, `HttpOnly`, `SameSite=Lax`,
and `Path=/`. That cookie only works in the two topologies in section 6. CORS
is credentialed only for the exact configured origins; wildcards are rejected
at startup. Browser mutations require `X-CSRF-Token` from the authenticated
session. `APP_ORIGIN` must use HTTPS in production.

## 8. Frontend on Vercel

1. Project root: `frontend/`.
2. Build command: `npm run build`; output: `dist`.
3. Choose the API connection:
   - **Same-origin proxy (recommended):** leave `VITE_API_BASE_URL` empty and
     keep `frontend/vercel.json` at the project root with the `/api` rewrite
     from section 6, Option A.
   - **Same-site custom domains:** set `VITE_API_BASE_URL` to the API
     subdomain origin (no trailing slash, no `/api` suffix) on the
     **Production** environment, then redeploy. Vite embeds the value at build
     time.
4. Do not set `VITE_API_BASE_URL` to a `*.onrender.com` host while the frontend
   is on a `*.vercel.app` host; that is the cross-site topology that loses the
   session cookie.
5. Confirm `https://learn-quest-one.vercel.app/api/health` (current proxy) or
   `https://api.YOUR-DOMAIN/api/health` (custom domains) returns healthy, then
   sign in with Google in a normal browser profile and confirm Network shows
   the `__Host-lq_session` cookie on an authenticated `/api/account/data`
   request.

## 9. Post-deploy checks

- `GET /api/health` returns `ok`, version, and only boolean configuration
  status — no secret values.
- The login screen shows no setup warning.
- The browser treats the session cookie as first-party: `GET /api/account/data`
  succeeds after reload, not only immediately after the OAuth redirect.
- Google registration reaches onboarding, and completing it rotates the
  session cookie.
- Google **sign-in** with an unregistered identity returns
  `google_account_not_found` and does not create an account; Google
  **registration** for an existing account asks the person to sign in.
- A password sign-in works after registration. A wrong password stays on the
  sign-in screen with `Invalid username/email or password.` and does not show
  an expired-session error.
- Password recovery sends a Brevo link. Opening it does not change anything;
  pressing **Set new password** consumes the token once. A reused or expired
  link is rejected, and a newer request invalidates the older link.
- Email-change verification sends a link to the new address. Confirming it
  changes the email, signs out all sessions, and notifies the old address.
- Two accounts cannot read or mutate each other's data.
- Archiving keeps records; restoring does not recreate XP.
- Permanent deletion requires the exact displayed title and reports success
  only after all deletion steps complete.
- Account export contains learning data but no password hashes, raw action
  tokens, or session tokens.

## 10. Operational notes

- Back up MongoDB according to your provider's policy. The app also offers
  per-account JSON export.
- Deleting an account removes its MongoDB records and sessions; this cannot be
  undone through LearnQuest.
- Keep dependencies patched. Run `npm audit` in both packages and review the
  results in context; automated audit output is not a substitute for a real
  deployment review.
- Do not commit `backend/.env`, real connection strings, OAuth secrets, API
  keys, or generated session/email-action secrets.
