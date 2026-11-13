# LearnQuest regression baseline

Use Node 24 (at least 24.22.1) and the locked npm dependencies in each app.
From the repository root:

```powershell
npm --prefix frontend test
npm --prefix backend test
npm --prefix frontend run typecheck
npm --prefix backend run typecheck
```

Both `test` scripts run Vitest with UTC and a clean child-process environment.
They do not load local Vite or backend dotenv files. Backend HTTP tests require
loopback sockets for Supertest; they use synthetic credentials and memory
stores. MongoDB rehearsal suites remain skipped in this baseline even when a
shell has rehearsal credentials. Run those suites separately only against an
explicitly authorized, disposable local MongoDB deployment.

Append a file filter after `--` for a focused Vitest run. The ordinary app
development and build scripts retain their configuration.

## Browser and visual checks

```powershell
# Optional if the Playwright-managed Chromium executable is available.
$env:LQ_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm --prefix frontend run test:browser:baseline
```

The harness builds the app in memory and serves it on a temporary loopback
port. Each test opens a fresh browser context with synthetic IndexedDB records,
a fixed date, and UTC. The fixture blocks external requests and intercepts
account requests with synthetic replies for the signed-in cases. The baseline checks
Library on desktop/dark and phone/light. It waits for charts and fonts, advances
the browser clock through chart animation, then compares captures from two
independent contexts for stability.

The browser baseline also checks the skip link, navigation focus and resize
cleanup, contrast in both themes, and keyboard theme switching. It visits all 15
destinations at 1440px and 320px, plus Dashboard, Library, Player, Analytics,
Focus, Settings, and Account at 1920px, 1024px, 768px, and 390px. Separate fixtures
exercise Arena practice and signed-in Account security on desktop and mobile.
Review mode captures the route tour under `test-results/visual/phase-b5-cohesion`.

The dial checks cover angular snapping, immediate section selection, search,
route history, reduced motion, focus return, and touch dragging, cancellation,
reload, and landscape resizing. Dock placement is a browser-local edge and
normalized vertical position. The scroll-isolation check exercises the list
with wheel, touch, and keyboard input, including both boundaries. It verifies
that the document still scrolls outside the open navigation and after dismissal.

The interaction checks cover the Player's calendar and notes, Revision toolbar
alignment and Enter submission, theme changes through Account and Settings,
and playlist and account confirmation flows. The theme bootstrap runs under
the deployment CSP resource directives on loopback. The deletion fixture
returns a simulated failure and keeps the confirmation available for retry
or cancellation.

On constrained hosts, run the Vitest and browser commands in sequence. The
cold browser build and jsdom worker startup compete for CPU.

Set `LQ_VISUAL_MODE=verify` to compare screenshots with the reference images.
References are scoped to OS, architecture, and exact browser version. Use the
same fonts and rendering environment; a reference from another platform is
not interchangeable. If a comparison fails, the actual image is saved under
`frontend/test-results/visual`. Set `LQ_VISUAL_MODE=update` only when deliberately
capturing or accepting a visual change. Review the images before committing
them. The default `smoke` mode checks repeatability without reading or writing
references.

Set `LQ_VISUAL_MODE=review` to write candidates and representative route captures
to `frontend/test-results/visual` without replacing any references. The Phase B.5
route and interaction captures are in `frontend/test-results/visual/phase-b5`.
The Library references record the new editorial layout and collapsed dock.

## Known defects

```powershell
npm --prefix frontend run test:regressions
npm --prefix frontend run test:browser:regressions
```

The Vitest regression command is green. EXPORT-1 (account-export manifest named
`learning-data/challenge-enabled.json`, which the archive never contained; fixed to
`learning-data/challenge-settings.json` in Phase E preparation on 2026-11-13) is
resolved; the browser regression command is a focused runner for the now-passing
CHART-2 case, also exercised by the ordinary browser baseline.

Phase B moved NAV-1, NAV-2, and A11Y-2 to the browser baseline and A11Y-1 to
the frontend Vitest baseline. No known-defect cases remain deferred.

Phase D moved ARENA-1 and ARENA-2 into `frontend/tests/arena-regressions.test.ts`.
The fixed-run, replay, lifecycle, storage, and cohort checks are in
`frontend/tests/arena-runs.test.ts`.

Phase E added focused capture fixtures under `frontend/tests/browser/phase-e.browser.mjs`:

```powershell
cd frontend
$env:LQ_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test tests/browser/phase-e.browser.mjs
```


```powershell
cd frontend
$env:LQ_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test tests/browser/arena.browser.mjs
```

The isolated Arena browser suite writes captures to
`frontend/test-results/visual/phase-d`. It exercises synthetic accounts and
local storage only.

## Playlist chart profiling

```powershell
cd frontend
$env:LQ_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test tests/browser/chart-profile.browser.mjs
```

The profile uses synthetic IndexedDB fixtures from 1 to 5,000 entries and logs
observed action-to-paint times, chart SVG descendants, renderer task time and
heap size. The measured action includes Playwright overhead and two paint
frames. Renderer resource figures include the page, so they are not isolated
component measurements. The 2,000- and 5,000-entry fixtures exercise the
visualization subsystem without changing production import limits.

## Precision chart inspection

```powershell
cd frontend
$env:LQ_BROWSER_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test tests/browser/chart-polish.browser.mjs
```

The isolated Chromium suite exercises synchronized tooltip and strip content,
pinning, focus priority, dataset changes, touch, the compass, and table
navigation from 1 to 5,000 synthetic entries at six widths. It writes reviewed
captures to `frontend/test-results/visual/phase-c1`. The hover performance
check records pointer-action time and asserts that hover causes zero mutations
inside the chart SVG.

The existing authentication browser scripts remain separate. These fixtures
exercise the local learning workspace; they do not establish production
cookie, OAuth, playback, or database behavior.

## Phase F reliability coverage

```powershell
npm --prefix frontend test -- --maxWorkers=2 --reporter=default --silent=true tests/cloud-recovery.test.ts tests/cloud-persistence.test.tsx tests/readiness.test.ts tests/auth-events.test.tsx tests/cross-tab-auth.test.tsx tests/goals-integration.test.tsx
npm --prefix backend test -- --maxWorkers=2 --reporter=default --silent=true tests/session-reliability.test.ts tests/origin-config.test.ts tests/auth-events.test.ts
```

These use synthetic accounts and memory/IndexedDB fixtures only. Backend
HTTP tests need permission to open loopback ports; no production credentials,
database, or deployed service is contacted.

The Goals/Focus integration file is pinned to a fixed UTC-noon reference; do
not rely on host wall-clock date logic anywhere in this file. The recovery
freeze-unfreeze lifecycle is exercised end-to-end in cloud-persistence.
