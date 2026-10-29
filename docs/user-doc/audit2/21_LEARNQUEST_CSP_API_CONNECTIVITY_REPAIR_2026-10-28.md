# 21 — LearnQuest CSP/API Connectivity Repair

- **Date:** 2026-10-29
- **Repository:** `E:\progressGameTracker`
- **Branch / base revision:** `main` / `67bc5ac`
- **Scope:** Browser API origin selection, same-origin proxy routing, CSP compatibility, regression tests, and local/production verification.
- **Production deployment performed:** **No.** No commit, push, deployment, credential change, production data operation, reset, clean, stash, or branch switch was performed.

---

## 1. Summary

The application already had the correct proxy and security-header architecture:

- Vercel rewrites `/api/:path*` to the corresponding Render `/api/:path*` path.
- Vite proxies `/api` to `http://localhost:3001` during local development.
- Vercel serves one restrictive CSP with `connect-src 'self'`.
- The HTML does not add a second CSP meta policy.

The mismatch was in the shared frontend transport. `frontend/src/services/api/http.ts` read the build-time `VITE_API_BASE_URL` and prepended that origin to every `/api` request. A production build with the Render origin in that variable therefore bypassed Vercel's same-origin proxy and was blocked by the active same-origin CSP. The browser report in the supplied prompt is consistent with this client path. The Vercel project environment setting itself was not available for inspection, so its deployed value is not independently asserted here.

The client now always emits relative `/api` URLs. It ignores build-time API origins, and it accepts both resource paths (`/account/data`) and already-prefixed paths (`/api/account/data`) without producing `/api/api`. No Vercel rewrite or CSP change was needed. The Render hostname remains in `frontend/vercel.json` only as the server-side rewrite destination.

---

## 2. Baseline and investigation

At the start, `git status --short` showed only the user-supplied, untracked connectivity-fix prompt. There were no pre-existing tracked diffs. No `.env` values were read or printed. `frontend/.env.example` documented the optional origin override, while the shared API client consumed `import.meta.env.VITE_API_BASE_URL` at build time.

The request audit found the two browser fetch sites:

- `frontend/src/services/api/http.ts` handles auth, session restoration, profile/settings, account data, learning data, import/export, deletion, and other account operations. All calls use `apiUrl()` and preserve `credentials: 'include'`; mutating calls add `X-CSRF-Token` when the session API has supplied a token.
- `frontend/src/services/api/playlistApi.ts` uses `apiUrl()` for public playlist and health reads.

There are no other direct frontend API origins or hardcoded Render API URLs in `frontend/src`.

---

## 3. Changes

| File | Change |
|---|---|
| `frontend/src/services/api/http.ts` | Removed the build-time origin override; the API base is always same-origin. Normalized paths to avoid duplicate `/api` prefixes. Credential and CSRF handling is unchanged. |
| `frontend/.env.example` | Removed the unsupported API-origin override instructions and documented the Vite and Vercel proxy paths. |
| `frontend/tests/api-client.test.tsx` | Added checks for same-origin URLs despite an injected build-time origin, `/api` joining, Vercel and Vite proxy configuration, single same-origin CSP delivery, no HTML meta CSP, credentialed session requests, CSRF headers, and rejected HTTP failures. |
| `docs/user-doc/audit2/README.md` | Added this report to the existing archive index. |
| `docs/user-doc/audit2/21_LEARNQUEST_CSP_API_CONNECTIVITY_REPAIR_2026-10-28.md` | Added this report. |

The existing `frontend/tests/cloud-persistence.test.tsx` already verifies that failed cloud writes remain in an error state, preserve the previous server data, and do not claim the change was saved. That regression passed in the full frontend run.

---

## 4. Routing and security behavior

The browser now requests relative URLs such as `/api/auth/session`, `/api/account/data`, `/api/playlist`, and `/api/health`.

- **Production:** `frontend/vercel.json` maps `/api/:path*` to `https://learnquest-hhiv.onrender.com/api/:path*`. The wildcard preserves the entire endpoint, including auth callbacks and account/learning routes. It does not rewrite to the SPA index.
- **Local development:** `frontend/vite.config.ts` proxies `/api` to `http://localhost:3001`; Vite keeps the request path intact.
- **CSP:** `connect-src 'self'` remains unchanged. The Vercel configuration contains one CSP response header, and `frontend/index.html` contains no CSP meta policy. Same-origin requests are compatible with the policy without adding trusted origins or weakening directives.
- **Sessions and CSRF:** The shared account transport continues to use `credentials: 'include'` and sends `X-CSRF-Token` on mutations when present. Session tokens remain in HttpOnly cookies and are not moved into local storage.

The exact Vercel rewrite and local Vite proxy were already correct, so neither was changed.

---

## 5. Verification

The available environment used Node `v24.11.0` and npm `11.6.1`. The repository declares Node `>=24.22.1 <25`, so the results below are local verification under the available Node 24 runtime, not a replacement for a pinned Node 24.22.1 run.

| Check | Result |
|---|---|
| Focused frontend API/CSP tests after final test edits | **PASS**, 2 files / 9 tests |
| Full frontend suite | **PASS**, 42 files / 352 tests |
| Frontend typecheck | **PASS** |
| Frontend lint | **PASS**, 0 errors and 4 existing React hook dependency warnings |
| Frontend production build | **PASS**, 2,253 modules transformed |
| Full backend suite | **PASS**, 25 files / 201 tests |
| Backend typecheck | **PASS** |
| Backend lint | **PASS**, 0 errors and 86 existing `no-explicit-any` warnings |
| Backend production build | **PASS** |
| `git diff --check` | **PASS**; only Git LF/CRLF notices |

The backend suite initially failed inside the restricted sandbox because its tests bind local ephemeral loopback ports (`EACCES 127.0.0.1`). The same suite was then run with the approved local-network test execution and passed all 201 tests. It did not contact production.

After the frontend production build, all 18 JavaScript assets were scanned: **0** contained `learnquest-hhiv.onrender.com` and **0** contained `VITE_API_BASE_URL`. The Render origin is present in the Vercel rewrite configuration as intended.

Read-only production checks through Vercel:

- `/api/auth/config` returned `authEnabled=true` and `setupRequired=false`.
- `/api/health` could not be verified: the first request timed out, and a retry failed with an HTTP request exception from this environment.
- No interactive browser session was used, so the actual deployed response headers, browser CSP enforcement, cookies, and OAuth flow are not claimed as verified.

---

## 6. Remaining production verification

After the owner deploys the reviewed changes, verify in a browser on the Vercel site:

1. `/api/health` and `/api/auth/config` respond through Vercel; confirm `setupRequired=false`.
2. The document response has exactly one CSP header with `connect-src 'self'`, and no other policy blocks the request.
3. Session restoration and a non-destructive authenticated account-data read succeed through same-origin `/api` requests.
4. Password sign-in, Google sign-in initiation and callback, cookies, and CSRF-protected mutations work through the proxy.
5. A failed account write shows an error and never reports a successful cloud save.

No deployment or owner-side production setting was changed in this task.

---

## 7. Final Git status

Expected changed/new paths at report completion:

```text
 M docs/user-doc/audit2/README.md
 M frontend/.env.example
 M frontend/src/services/api/http.ts
 M frontend/tests/api-client.test.tsx
?? LEARNQUEST_CSP_API_CONNECTIVITY_FIX_PROMPT_2026-10-28.txt
?? docs/user-doc/audit2/21_LEARNQUEST_CSP_API_CONNECTIVITY_REPAIR_2026-10-28.md
```

The untracked prompt is the user-provided reference file and has been preserved. No commit, push, or deployment was performed.
