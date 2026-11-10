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
a fixed date, UTC, and blocked API/external requests. The baseline checks
Library on desktop/dark and phone/light. It waits for charts and fonts, advances
the browser clock through chart animation, then compares captures from two
independent contexts for stability.

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

## Known defects

```powershell
npm --prefix frontend run test:regressions
npm --prefix frontend run test:browser:regressions
```

These opt-in commands assert the desired behavior and currently exit nonzero.
Assertion failures show unresolved defects; setup errors and timeouts are test
infrastructure failures, not evidence of a defect. Move each corrected case
into the ordinary baseline when its fix lands.

| Cases | Expected behavior |
| --- | --- |
| CHART-1, CHART-2 | Highest tick covers the data; a range starting at 25 reports playlist position 25. |
| ARENA-1, ARENA-2 | Completing a lesson preserves earlier qualifying evidence; a fixed run's dates agree with its displayed period. |
| NAV-1, NAV-2 | Skip to main keeps the current route and moves focus; resizing an open drawer releases the desktop. |
| A11Y-1, A11Y-2 | Icon buttons expose their supplied name; normal help text meets 4.5:1 contrast. |
| EXPORT-1 | Manifest file names agree with the archive contents. |

The existing authentication browser scripts remain separate. These fixtures
exercise the local learning workspace; they do not establish production
cookie, OAuth, playback, or database behavior.
