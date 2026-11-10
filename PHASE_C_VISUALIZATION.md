# Phase C visualization engineering

## Inventory and integration

| Surface | Data and precision | Rendering and inspection |
| --- | --- | --- |
| Dashboard course curve | Ordered playlist occurrences and exact known subtotal in seconds | Shared playlist chart. Missing durations break the line and mark the subtotal incomplete. |
| Dashboard weekly focus | Seven calendar days of interval-attributed focused time | Shared short evidence chart with keyboard inspection and a full seven-row table. Weekly headline keeps its established rounding. |
| Library range duration and cumulative | Actual positions from the selected range, occurrence identity, nullable seconds and completion | Shared viewport. The cumulative subtotal resets at the selected range start. |
| Library whole-playlist distribution | All playlist positions, including unresolved entries | Same duration viewport and exact data table. |
| Library and Analytics composition | Completed and remaining lesson counts | Recharts donut with an exact textual equivalent and an explicit zero state. |
| Analytics duration and cumulative | Whole-playlist seconds and known subtotal | Same viewport. The previous sampled tables are now paginated over all occurrences. |
| Analytics session lengths | Existing count per duration bucket | Shared short evidence chart and complete table. |
| Efficiency trend | Existing 14-day throughput ratio. Missing denominator stays null. | Shared short evidence chart. Plotting uses the ratio before display rounding. |
| Focus planned vs actual and weekly calendar | Existing goal and interval-attributed time | Shared evidence chart for the comparison. Calendar retains its exact dated text alternative. |
| Dashboard, Analytics, Goals, Checkpoints, Modules and Player progress | Existing percentages and playback progress | Named progress bars. Calculations stay in their respective domains. |
| History and Arena | Existing evidence tables, status and competitive presentation | No new plot or scoring logic. Phase B.5 layouts remain in place. |

## Contracts

- `playlistSeries.ts` adapts ordered records using the existing occurrence key. Duplicate video IDs remain separate records. Inputs are copied and sorted by actual position. No storage writes occur.
- Durations and known cumulative subtotals stay in seconds. Axis labels select seconds, minutes or hours independently. Genuine zero has a dot, while unresolved values have an × and a text equivalent. Inspection distinguishes unavailable entries by their source reason. The cumulative line stops at unresolved or absent positions and does not smooth or interpolate.
- The viewport stores an index window into the selected range. Actual positions drive labels, jumps, inspection and tables. A new playlist snapshot or range resets that chart's viewport. Theme and responsive changes keep its valid window. Dragging, page movement, zoom and reset do not change the selected Library range or lesson records.
- The zero-based tick scale always contains the maximum. The visible-scale option keeps duration bars zero-based. A visible cumulative scale identifies its nonzero baseline when used.
- The plot uses Recharts. The plot region owns horizontal drag with native vertical touch scrolling. In focused detail, horizontal trackpad input and Shift+wheel pan the window. Ordinary vertical wheel scrolling remains with the page. Keyboard, touch and button controls provide independent ways to inspect and move.

## Large-playlist scalability

The CSS plot width determines the mark budget, with a 12 px overview slot target and a hard cap of 120 marks. Direct detail starts at a 23 px target. A wider detail window can still aggregate if it exceeds the measured budget. Groups use consecutive entry intervals with boundaries `floor(i × length / groups)`. The intervals are disjoint, cover the window exactly, and retain exact resolved minimum, maximum, subtotal and missing count. An outlier remains the maximum of its own group. Clicking a group opens its membership window, with further zoom or an exact-position jump available. Cumulative overview groups show known subtotal bounds and boundary subtotals without joining groups into a false curve. The accessible table mounts 25 rows per page.

### First comparable browser profile

Windows headless Chromium 157.0.8103.40, isolated synthetic IndexedDB fixtures, one observed run per size and implementation. Times below are wall-clock Playwright actions through two animation frames, in milliseconds. They include automation overhead and are neither FPS nor chart-only CPU time. The old renderer could still be animating at the measurement boundary. Node counts are SVG descendants scoped to the chart.

| Entries / viewport | Full-range paint, before → after | Detail nodes, before → after | Pan, before → after |
| --- | ---: | ---: | ---: |
| 1 / 390 px | 185 → 122 | 27 → 47 | — |
| 2 / 320 px | 129 → 82 | 34 → 51 | — |
| 8 / 1440 px | 220 → 150 | 74 → 90 | — |
| 139 / 1440 px | 383 → 295 | 503 → 263 | 636 → 161 |
| 500 / 1024 px | 783 → 273 | 1,769 → 191 | 1,049 → 156 |
| 1,000 / 1440 px | 3,098 → 353 | 4,519 → 263 | 705 → 345 |
| 2,000 / 390 px | 3,742 → 319 | 7,033 → 83 | 3,513 → 155 |
| 5,000 / 320 px | 11,054 → 459 | 17,536 → 71 | 6,042 → 256 |

The small-chart renderer has a few more SVG nodes for the explicit unknown and zero markers. Timing differences on small fixtures can be dominated by the harness. At 5,000 entries, the after profile counted 108 overview SVG descendants and 71 detail descendants. Production import remains limited to 1,000 entries. Raising the limit would require coordinated changes to the browser importer, backend ingestion and account validation, backup validation, module and position limits, and load testing for sync payloads, exports, and persisted document sizes.

The final profile, after the SVG axis alignment fix, also measured resource counters and separate zoom and resize actions.

| Entries / viewport | Overview / detail nodes | Inspect / zoom / resize (ms) | Renderer heap at end |
| --- | ---: | ---: | ---: |
| 139 / 1440 px | 425 / 241 | 61 / 134 / 180 | 12.6 MiB |
| 500 / 1024 px | 349 / 176 | 59 / 216 / 258 | 17.6 MiB |
| 1,000 / 1440 px | 491 / 241 | 129 / 263 / 261 | 17.9 MiB |
| 2,000 / 390 px | 131 / 79 | 57 / 247 / 160 | 15.1 MiB |
| 5,000 / 320 px | 105 / 68 | 367 / 738 / 216 | 18.2 MiB |

The final 5,000-entry run took 1,810 ms to enter detail, versus 350 ms in the first after-profile. This variability is why the timings are observations and the mark budget is the deterministic bound. Chromium reported 848 ms of renderer task time across the measured sequence at 2,000 entries and 1,135 ms at 5,000. Heap and task counters cover the renderer and include the rest of the application. They do not establish a leak test. A separate Node run of the bundled production aggregator used 120 groups, 100 warm-ups and 500 measured calls per size. Median aggregation time was 0.086 ms at 2,000 entries and 0.148 ms at 5,000, with p95 values of 0.393 and 0.630 ms.

## Files by responsibility

- Data, scale, SVG and interactions are under `frontend/src/components/charts`. The translated, full-width PanChart and separate Y-label strip were removed.
- Feature integrations are under `frontend/src/features`. Named progress bars use the shared primitive in `frontend/src/components/ui/ui.tsx`.
- Deterministic math tests are in `frontend/tests/playlist-charts.test.ts`. Browser geometry and interaction checks use `frontend/tests/browser/helpers/chart-checks.mjs`. The standalone benchmark is `frontend/tests/browser/chart-profile.browser.mjs`.
- Both Library visual references were reviewed before replacement. Test and profiling commands are documented in `TESTING.md`.

### Verification boundaries

The fixtures exercise browser geometry, wheel and emulated touch, keyboard inspection, and per-browser rendering. Physical devices, assistive technology, and Safari/Firefox require separate verification. Browser tests use synthetic data. Production routes, scoring, learning records, storage formats, authentication and import limits are unchanged.

## Acceptance results

| Check | Result |
| --- | --- |
| Frontend baseline | 485 passed across 54 files, including CHART-1. |
| Backend baseline | 257 passed. Three MongoDB rehearsal tests skipped. |
| Chromium exact visual baseline | 35 passed, including both Library references, CHART-2, and the application tour at 320, 390, 768, 1024, 1440 and 1920 px. |
| Final Chromium profile | 10 passed, including the 5,000-entry stress fixture, chart and dock coexistence, and playlist switching. |
| Typechecks and builds | Both apps passed. |
| Frontend lint | Zero errors and four pre-existing warnings. |
| Deferred known defects | ARENA-1, ARENA-2 and EXPORT-1 reproduced in their opt-in suite. |

The first browser review hit a Player focus assertion that expected exactly 2 px. The observed ring was 3 px. The updated check verifies a single solid ring at least 2 px wide with at least 2 px of offset, and the exact visual baseline passed on the follow-up run. The chart checks verify real SVG label-to-bar alignment, 25 and 55 range starts, endpoint inspection, missing and unavailable entries, touch and wheel panning, ordinary vertical scrolling, theme changes, and paginated table access.

The accessibility review used the [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) alongside manual capture review and the isolated browser checks.
