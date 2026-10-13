# HOW TO USE LEARNQUEST — Complete User Manual

LearnQuest turns YouTube playlists into measurable learning journeys: exact video-duration math, an embedded lesson player with verified watch tracking, goals, focus planning, efficiency analytics, and an optional fictional arena. Everything is stored **locally in your browser** — there is no cloud account and no cross-device sync.

> New here? Read [A](#a-what-learnquest-does), then [C](#c-initial-setup), [E](#e-add-a-playlist), [F](#f-understand-the-duration-explorer), then the [feature journey](#q-complete-feature-journey).

---

## A. What LearnQuest does

- **Playlist duration analysis** — paste any public YouTube playlist URL; LearnQuest fetches every entry's real duration and totals them with integer-second arithmetic. Never averages.
- **Exact custom ranges** — pick any start/end positions (e.g. videos 1–84 of 139); the total is the sum of those videos' actual durations, shown with a per-video chart.
- **Playback tracking** — the embedded Player records which timeline segments you actually watched (verified) versus what you ticked off by hand (manual).
- **Completion tracking** — per-video done state, verified and manual kept visibly distinct.
- **Learning goals** — video-count, unique-content, focus-time, playback-time, and checkpoint goals; achieved only by real activity.
- **Modules and checkpoints** — your own chapters and milestones over any playlist positions.
- **Focus sessions** — a study timer with pause/resume, notes, and manual correction; daily targets with a minimum-viable fallback.
- **Efficiency** — documented ratios (unique content ÷ focused study), never a mystery score.
- **Timezone analytics** — UTC event storage with any display timezone; cross-midnight sessions split correctly.
- **Competition/Arena** — optional, clearly fictional simulated rivals for motivation. Never real people.
- **Revision** — confidence ratings, notes, questions, and a review queue.
- **Reports, export, import** — JSON backups, CSV exports, validated restore.

## B. Project structure

```
progressGameTracker/
├── frontend/                 # Everything you see and click
│   ├── src/app/              # App shell, sidebar/drawer nav, central store
│   ├── src/components/       # Reusable UI: cards, buttons, dropdowns,
│   │                         # timezone picker, charts, dialogs, toasts
│   ├── src/features/         # One folder per screen: dashboard, playlists,
│   │                         # player, analytics, modules, goals, checkpoints,
│   │                         # focus, efficiency, competition, revision,
│   │                         # history, reports, settings
│   ├── src/domain/           # THE calculation engine (durations, ranges,
│   │                         # progress, playback, efficiency, goals,
│   │                         # competition, time). Every screen uses this —
│   │                         # no screen computes its own totals.
│   ├── src/services/         # Backend client, IndexedDB persistence,
│   │                         # CSV/import validation, notifications
│   ├── src/types/            # Shared data shapes
│   ├── tests/                # Automated test suites
│   ├── index.html  package.json  tsconfig.json  .env.example
│   └── public/favicon.svg
├── backend/                  # YouTube access + credential protection
│   ├── src/config|routes|controllers|services|middleware|schemas|cache|types|utils/
│   ├── tests/  package.json  tsconfig.json  .env  .env.example
├── package.json              # `npm run dev|test|typecheck|build`
├── package-lock.json  .gitignore  render.yaml
├── README.md                 # Overview + setup (start there for install)
└── HOW_TO_USE_LEARNQUEST.md  # This manual
```

Key idea: the **backend only fetches and normalizes playlist metadata** (it never sees your study history). The **frontend owns all learning data**, persisted in IndexedDB under the database name `learnquest-db`.

## C. Initial setup

Requirements: **Node.js 20+** and **npm 9+**. Check with:

```powershell
node --version
npm --version
```

From the repository root (`E:\progressGameTracker`):

```powershell
npm install
```

Copy the backend config and start both servers (two options):

```powershell
# Option 1 — both at once:
npm run dev

# Option 2 — two terminals:
npm run dev:backend    # API on http://localhost:3001
npm run dev:frontend   # App on http://localhost:5173
```

Then:

1. Open **http://localhost:5173** — you should see the LearnQuest sidebar (Dashboard, Library, Player, …) and an onboarding card.
2. Health check: open **http://localhost:3001/api/health** — expect `{"ok":true,"hasKey":false,…}` until you add an API key (see D). `hasKey:true` means the backend loaded a key.
3. A successful launch = sidebar renders, no console errors, and the header/sidebar status pill reads `○ API offline`, `● API key missing`, or `● API ready` depending on backend state.

Useful commands (repo root):

```powershell
npm test        # all automated tests, both workspaces
npm run typecheck
npm run build   # production builds for frontend + backend
```

## D. YouTube API setup

Live playlist fetching needs a **YouTube Data API v3 key** (read-only; no billing required).

1. At [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → Credentials** → Create Credentials → **API key**.
4. Restrict the key: *API restrictions* → YouTube Data API v3 only; *Application restrictions* → the IP/host of your backend.
5. Open `backend/.env` in a text editor and set:
   ```
   YOUTUBE_API_KEY=PASTE_YOUR_KEY_HERE
   ```
   Keep the other lines (`PORT=3001`, `CORS_ORIGIN=http://localhost:5173`, …) as they are.
6. Restart the backend (`npm run dev:backend`).
7. Confirm: reload the app → **Settings → Backend connection** should read **“● Connected — API key configured”**, or `curl http://localhost:3001/api/health` shows `"hasKey":true`.

Troubleshooting:

- **“Server is missing YOUTUBE_API_KEY”** — the backend started without the variable. Check the spelling in `backend/.env` and restart the backend (environment files load at startup).
- **Invalid/restricted key** — the error names it plainly. Re-check the restriction (API + host) in Google Cloud.
- **Quota exhausted** — the message says so and suggests CSV/JSON import. Quotas reset daily; personal use (~7 units per ~140-video playlist) rarely hits the 10,000/day default.
- **Never** put the key in any `VITE_` variable, any file under `frontend/`, chat messages, or Git. `backend/.env` is git-ignored; only `backend/.env.example` (placeholders) is committed.

## E. Add a playlist

1. On YouTube, open a playlist and copy its URL (it contains `?list=PL…`), or copy just the `PL…` ID.
2. In LearnQuest: **Reports → Playlists** → paste into **“New playlist URL or ID”** → **Add**. (First run: the onboarding card on any screen does the same.)
3. Wait for retrieval (pagination + batching happens server-side). The header line then shows e.g. `Active playlist: … · N=139 · api · fetched …`.
4. **Resolved vs unresolved:** the dashboard header counts both. Deleted/private/region-blocked videos appear as `unresolved` in tables and charts — their totals are always labelled **INCOMPLETE**, never silently dropped.
5. **Refresh metadata:** Reports → **Refresh active**. If videos were added/removed/moved, a banner summarizes the change and any saved range/checkpoint that no longer fits is flagged **needsReview** — original boundaries are preserved for you to confirm, never silently rewritten.
6. Works for any length (1, 27, 139, 500…) — boundaries always adapt to the active playlist's actual `N`. Nothing is hardcoded to any course.

## F. Understand the duration explorer

Open **Library**. The **Range explorer** card is the heart of LearnQuest.

Step-by-step (example with N=139, videos 1–84):

1. **Start** `1`, **End** `84` (inputs clamp to `1–N` of the active playlist).
2. Or tap a preset: **Full playlist (1–N)**, **First videos**, **Middle segment**, **Final videos**.
3. Read the summary block:
   - `Videos 1–84 · 84 entries` — count is always `end − start + 1` for a valid contiguous range.
   - The big `H:MM:SS` figure — the **sum of those 84 videos' actual durations**, e.g. `12:04:33`.
   - `resolved / unresolved` counts; `≈N sessions of M min`; `X/84 done`.
   - An amber **Incomplete** line appears if any entry in range lacks metadata, with its positions.
4. The chart has two views (segmented control, same data both sides): **Video duration** (bars = minutes per video) and **Cumulative duration** (line = running total). Each view uses only its own axis units; every entry is plotted while printed labels thin out on long ranges; hover any point for exact position, title, durations, and completion.
5. **Session length** (10/15/25/45/60 min) changes only the *session estimate*. Content duration never moves.
6. **Content duration ≠ study time.** A 20-minute video plus notes, pauses, and practice is more than 20 minutes of studying. Focused study time is tracked separately (see J).
7. **Save** stores the range for one-click totals in Checkpoints/Dashboard. Row checkboxes additionally sum any hand-picked (possibly non-contiguous) selection, labelled as a selection — not a range.
8. Switching playlists or refreshing metadata re-bases all boundaries to the new `N`; out-of-range inputs show a validation message instead of guessing.
9. **Sorting keeps its promises:** playlist order, longest/shortest first (numeric seconds — never formatted strings), title A–Z/Z–A. Unresolved videos sort last (never as zero-length), ties break by position, stored order is never mutated. Search + filter + sort compose (filter, then sort, then paginate); changing sort returns you to page 1.

## G. Track videos and playback

**Player tab:**

1. Pick a position (number input, Prev/Next, or the learning **Queue** you build with **Queue** buttons).
2. **Play/Pause** in the embedded YouTube player. Position is sampled ~2×/s (the documented precision limit).
3. What counts as **verified**: timeline intervals observed while state = playing, at the reported playback rate. **Paused, buffering, and skipped (seeked-over) spans never count.** Rewatches add to playback totals but unique coverage counts each second once.
4. When the video ends, LearnQuest records a verified session (active time, content, unique gain, pauses, your pause-note) and, at **≥ threshold unique coverage** (default 90%, adjustable 50–100% in Settings), marks the video **✓ verified**.
5. **Mark complete (manual)** is always available and always labelled manual — use it for videos you genuinely watched outside the app. Manual and verified stay visually distinct everywhere (tables, Analytics, History).
6. If embedding is blocked (error 101/150), an amber box explains it and links **Open on YouTube** — that external watch cannot be verified here.
7. Refreshing mid-playback ends verification honestly: no background time is ever credited.

**History tab** shows every focus and playback session (verified vs self-reported labelled), per-video segment lists, and a **Self-reported entry** form for pre-tracking history — always stored as `manual`, never as verified.

## H. Create daily goals

**Goals tab → Create goal:**

- **Metric** dropdown: *Videos completed*, *Unique content covered*, *Focused study time*, *Active playback time*, *Checkpoint reached*.
- **Target** (videos, or minutes for time-based metrics), **Scope** (one playlist or all), optional **checkpoint** picker, and **Due today** checkbox (unchecked = open-ended).
- Progress bars show current/target/remaining. A goal becomes **achieved only when its condition holds** (e.g. 5 videos genuinely completed today) — never because a timer elapsed. Duplicate events can't double-award (ledger dedup keys); past-due unmet goals read **missed** without deleting anything; goals can be paused/resumed/deleted.
- Achievements (first video/session/checkpoint, 5 days, 10 focused hours, halfway, course complete, …) appear on the Dashboard with total XP. Scoring: video 10 · exercise 5 · code 5 · built example 8 · revision 4 · checkpoint 50 · 30 min focus 15 · study day 20 · achievement 25 · goal 30.

## I. Modules and checkpoints

- **Modules tab:** name a chapter, assign positions with `1-8, 10` syntax (validated against `1–N`), then rename, reassign, reorder (up/down arrows), or delete. Modules show video/duration progress. LearnQuest never auto-assigns topics — YouTube order is not a syllabus.
- **Checks tab:** create checkpoints as any valid range with your own label; progress, remaining work, and celebrations are computed live. After a playlist refresh that shrinks `N`, affected items show **needsReview** — edit or delete them explicitly.
- Saved ranges (from Library → Save) live here too for renaming/deletion.

## J. Focus timer and planning

**Focus tab:**

- **Timer:** Start/Pause/Finish, Reset; **session note**; **manual correction** (minutes) if you forgot to start/stop. Only *active* seconds are recorded; finishing never auto-completes videos. Sessions under 10 s are discarded with a notice.
- **Today's plan:** target focus minutes, minimum-viable minutes (for hard days — 10 focused minutes still counts), session length; **Set goal** saves it.
- **Planned vs actual** bars, **session history** (deletable), and a **weekly review** built only from recorded data. Missed days get a calm nudge toward a smaller target — never guilt or point loss.

## K. Learning efficiency

**Efficiency tab.** Exact implemented formulas:

- `contentEfficiency% = uniqueContentSeconds ÷ focusedStudySeconds × 100`
- `playbackUtilization% = activePlaybackWallSeconds ÷ eligibleFocusedStudySeconds × 100` (capped at 100; impossible inputs rejected, not clipped silently)
- **Overall = aggregate totals ratio, never the mean of daily percentages** (a 5-minute day must not weigh like a 3-hour day).
- Zero focused time → **`n/a`**, never `NaN`, infinity, or a fake score. >100% is normal above 1× speed and is *not* “better”; heavy practice days score lower and that is fine. Real measurements are never clamped to 110% (that ceiling bounds only fictional Ultra rivals).
- Daily focus comes from the same interval attribution as every other screen (cross-midnight sessions split; timezone changes recompute from UTC), so daily figures always agree with History.
- The **Evidence** filter separates verified playback from self-reported history; the overall figure always uses the aggregate ratio over the current selection. Worked examples live in the Efficiency screen's “What exactly am I looking at?” box.
- Supporting evidence (exercises, code reproduced, revisions, confidence) is shown separately in Analytics — never folded into one mystery “mastery %”.

## L. Timezones and daily analysis

- All events are stored as **UTC instants**. **Settings → Display timezone** (custom searchable picker: city, region, or alias like `kolkata`/`ist`, with live `UTC±HH:MM` offsets) only changes aggregation and display.
- Cross-midnight sessions are **split at local-day boundaries** — each day gets its own elapsed share (one shared interval attribution used by History, Dashboard, Efficiency, Focus, streaks, and Arena). Verified example: `2026-10-12T18:00Z → 19:00Z` attributes 30 min to Oct 12 and 30 min to Oct 13 in `Asia/Kolkata`, one day in `America/New_York`. Same UTC total under every timezone. Fall-back 25-hour days (e.g. New York Nov 1) total 90,000s; spring-forward 23-hour days 82,800s.
- Calendar windows (Arena, weekly reviews, Efficiency trend) use **calendar-day arithmetic in the selected timezone**, never fixed 24h chains — DST transitions keep exactly one entry per date. The current partial day is included.
- Open tabs refresh after midnight, device sleep, tab-visibility return, and timezone changes (lightweight day-tick + focus/visibility listeners); stored UTC history is never rewritten.
- History offers today/yesterday/week/month/all/custom ranges plus per-playlist filtering; changing timezone recomputes instantly without refetching.
- Streaks count distinct active days in the selected timezone (split sessions count both days); missed days cost nothing but the streak count.

## M. Arena and simulated competitors

**Arena tab (optional, off by default).** Everything here is a **fictional local simulation** — no real users, no network, no real ranking.

**What Arena ranks (and nothing else): average daily content efficiency.** Each eligible study day's efficiency (unique content ÷ focused study × 100) counts once; the score is the mean over eligible days in the window. Total hours, total videos, XP, and tier never affect rank — they appear as context only.

- **Enable competition**, choose **cohort size 10–2000** (including you), **max rival study per day** (1–12 h, default 6 h — fictional ceiling only; your real sessions are never capped), **seed**, **window days**, and **tier distribution** (percentages summing to 100).
- Each rival owns a **coherent daily history**: active/inactive days, focused minutes (within habits and the daily cap), that day's efficiency varying by date inside its tier band, unique content derived from those two (capped by remaining playlist content — a finished rival simply stops), plus practice minutes. Aggregates always agree with the day records.
- Tier **efficiency bands** — Ultra 100–110%, High 85–99.9%, Good 70–84.9%, Normal 55–69.9%, Average 40–54.9%, Below Average 20–39.9% — are design assumptions, distinct from **tier distribution** (how many rivals per tier). Daily results vary by date within `[ceiling − deviation, ceiling]` (Ultra 15 pts … Below Average 4 pts).
- Rivals have **gamer-style aliases** (e.g. NeonRonin, QuantumRaider) generated from themed word pools — unique per cohort, stable across reloads for a given seed, and unaffected by tier/distribution changes. Expanding the cohort appends new rivals without renaming existing ones.
- **Eligible days:** windows ≥ 3 days need ≥ 3 eligible active days; shorter windows need one per day. Below that you see **Provisional — complete N more eligible study days**, your recorded dailies, and a next action — never a bottom rank, never a fabricated score.
- **Rank X of N** (rank 1 is best; ties share a rank: 1, 2, 2, 4). **“Ranked above Y%”** = share of the cohort ranked *strictly below you* (rank 1 ≈ 100%, last place = 0%). The gap line (e.g. `2.4 percentage points behind NeonRonin`) is the true difference to the rival directly above you — never a duration mislabelled as a gap.
- **Leaderboard:** average daily efficiency front and center with eligible-day counts, exact window dates (e.g. `Oct 5 – Oct 18, 2026`) plus period labels (`· last 14 days`), 25/50/100 rows per page (default 50), Top/​Near-me views, alias search, **My rank** jump, prev/next with page counts. Secondary totals carry explicit period/unit labels and are context only.
- **Seed:** the number that starts the deterministic generator. Same seed + settings + window dates = same rivals and ranks across reloads (each rival day is seeded by its calendar date, so refreshing today reproduces today). The window shows exact dates (e.g. `Oct 5 – Oct 18, 2026`) and refreshes at local midnight and on tab focus; when the rolling window advances to new calendar dates the simulation slides with it (ranks may move without new study — the window itself changed). **Generate new fictional cohort** picks a fresh seed; bigger cohorts append rivals; changing the window re-simulates the period. **Reset sim** clears only simulated snapshots. None of this touches real records, and the seed measures nothing about you.
- **Why Arena and Efficiency differ:** the Efficiency page shows the **aggregate ratio** (total unique ÷ total focused); Arena shows the **mean of daily percentages** (equal weight per day). Same records, different questions — both correct, and the screens say so.

## N. Testing completion without corrupting real progress

- Verify math on a **short test playlist or a 1–3 video range** (totals are hand-checkable).
- Only mark videos complete (manual) that you **actually watched**; use embedded playback for verified tests.
- Create a **test checkpoint/goal**, watch it achieve, then delete it — ledger dedup prevents residue rewards.
- Experiment freely in **Arena** — it cannot touch real data.
- Developers: `npm test` runs deterministic fixtures for all math; no live key needed.
- There is **no Demo Mode** in this build — and no fake sample data anywhere. Do not invent watch history to make charts look lively; empty states are the honest starting point.

## O. History, analytics, exports, and backups

- **Analytics:** cumulative curve (resolved entries, first/last markers), duration distribution, done-vs-remaining, verified-vs-manual, session-length histogram, module workload, and cautious auto-insights with sample-size caveats.
- **Reports → Exports:** **Backup JSON** (everything, versioned — v2 restores v1), **Videos CSV**, **Sessions CSV**, **Checkpoints CSV**. Restore/import validates before touching stored data and reports row-level problems.
- **Playlists card:** compact searchable table (name, N, done count, refresh date, status dot; archived hidden unless toggled) with a per-row **⋯ menu**: rename (local label), archive/unarchive, remove (confirmed, per-playlist only). Refresh stays next to Add. The list scrolls internally past a few entries instead of stretching the page.
- **Danger zone:** *Clear cached metadata (keep progress)* vs *Clear ALL data* (two-step confirm). Export a backup first.
- Storage is **this browser only** (`learnquest-db`, IndexedDB v2, single key-value store). Measured sizes: a 1000-video playlist ≈ 124 KB, a year of daily focus sessions ≈ 62 KB, 1000 playback segments ≈ 216 KB — personal histories stay well under a few MB. No account, no sync, no backend database: the backend keeps only a bounded ephemeral metadata cache (TTL + 50-playlist LRU), which is spin-down safe. Copy the JSON backup to your own storage.
- **Large playlists (verified to N=1000 by test):** sums, search/filter, numeric sort (unresolved last), 25-per-page tables, full-range charts with first+last tick labels, modules/checkpoints, and CSV export all operate on the full collection. The backend accepts up to 1000 entries per playlist.
- **Known limitations (see `TIME_AND_ANALYTICS_AUDIT.md` / `STORAGE_AND_SCALE_AUDIT.md`):** overnight open-tab refresh and system-clock changes are implemented but lack live browser tests here; storage-quota exhaustion and 2000+-entry stress are documented but not executed; multi-tab concurrent editing is last-writer-wins.

## P. Troubleshooting

| Symptom | Fix (least destructive first) |
|---|---|
| API key missing | Follow D; restart backend; Recheck in Settings |
| Invalid/restricted key | Loosen Google Cloud restriction to the API + backend host; restart |
| Quota exhausted | Wait for daily reset; use JSON import meanwhile |
| Playlist fetch fails | Re-paste URL/ID; check public visibility; try Refresh; check backend logs (no key printed) |
| Unresolved videos | Expected for deleted/private/region-blocked items; totals stay INCOMPLETE-labelled |
| Player won't embed (101/150) | Use Open on YouTube; log a self-reported History entry |
| Totals look wrong | Confirm range endpoints, unresolved flags, and that you're reading content duration (not study time); check Analytics verified-vs-manual split |
| Invalid range | Keep `1 ≤ start ≤ end ≤ N`; presets always produce valid ranges |
| Timezone looks off | Re-pick in Settings; check the live UTC offset shown; legacy names auto-resolve |
| Data not persisting | Don't use private/incognito windows; check disk space; export backup |
| Invalid import file | Re-export from Reports; validate JSON; restore never half-applies |
| Port conflict (`EADDRINUSE`) | `node dist/server.js` twice, or a stuck process: stop other node processes / change `PORT` in `backend/.env` |
| Frontend can't reach backend | Check `VITE_API_BASE_URL` (empty = same-origin via dev proxy), `CORS_ORIGIN`, and that both `npm run dev` processes run |

## Q. Complete feature journey

1. **Start:** `npm install`, `npm run dev`, open http://localhost:5173.
2. **Import:** Reports → paste a playlist URL → Add. Note `N`, resolved/unresolved counts.
3. **Verify total:** Dashboard “Complete playlist” card; compare against YouTube's own total if shown.
4. **Custom range:** Library → Start 1, End 8 (or a preset) → read exact `H:MM:SS`, per-video chart, session estimate.
5. **Learn:** Player → position 1 → Play to the end → watch it flip to ✓ verified (or Mark complete manual).
6. **Track:** History shows the verified session with unique gain.
7. **Goal:** Goals → 3 videos today → finish two more lessons → achievement toast.
8. **Checkpoint:** Checks → “First 8” → complete range → celebration + XP.
9. **Review:** Efficiency (your ratio, aggregate overall) + History week view.
10. **Arena:** enable → note the fixed efficiency basis and your provisional status → study 3 eligible days → watch rank establish → Snapshot → disable.
11. **Backup:** Reports → Backup JSON → store the file somewhere safe.
