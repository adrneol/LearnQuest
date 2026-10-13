# HOW TO USE LEARNQUEST — Complete User Manual

LearnQuest turns public YouTube playlists into measurable learning journeys:
exact duration math, verified watch tracking, focus sessions, modules,
checkpoints, goals, efficiency analytics, revision scheduling, and an
optional fictional Arena. Everything you learn is stored **locally in your
browser** — there is no account and no cloud sync.

> Start with [A](#a-getting-started), then follow the journey in order.
> Technical verification lives in [`docs/audits/`](./docs/audits/).

## A. Getting started

### Prerequisites
- **Node.js 20+** and **npm 9+** (`node --version`, `npm --version`).
- For live playlist imports, a **YouTube Data API v3 key** (read-only, no
  billing). Without one, JSON snapshot import still works fully offline.

### Install and launch
Each app installs on its own — there is no root install step:

```powershell
cd frontend
npm install
cd ..\backend
npm install
```

Start both servers (two terminals):

```powershell
# Terminal A — backend API on http://localhost:3001
cd backend
npm run dev

# Terminal B — app on http://localhost:5173
cd frontend
npm run dev
```

Open **http://localhost:5173**. A successful launch shows the sidebar
(Dashboard, Library, Player, …) and an onboarding card.

### Configure the API key
1. At Google Cloud Console, create (or pick) a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **Credentials** → Create Credentials → **API key**.
4. Restrict it: *API restrictions* → YouTube Data API v3 only;
   *Application restrictions* → your backend host.
5. Copy `backend/.env.example` to `backend/.env` and set
   `YOUTUBE_API_KEY=PASTE_YOUR_KEY_HERE` (keep `PORT=3001`,
   `CORS_ORIGIN=http://localhost:5173`).
6. Restart the backend.
7. Confirm: **Settings → Backend connection** reads
   **"● Connected — API key configured"**, or
   `http://localhost:3001/api/health` shows `"hasKey":true`.

Never put the key in a `VITE_` variable, the frontend, chat, or Git.
`backend/.env` is git-ignored; only `.env.example` files are committed.
If a key is ever exposed in a screenshot or message, revoke/rotate it in
Google Cloud immediately and update the replacement in Render.

### Import a playlist
1. Copy a YouTube playlist URL (contains `?list=PL…`) or just the `PL…` ID.
2. **Reports → Playlists** → paste into **"New playlist URL or ID"** → **Add**.
   First run: the onboarding card does the same.
3. The header then shows e.g. `Active playlist: … · N=139 · api`.
4. **Refresh active** re-checks YouTube for changes (it always revalidates;
   plain Add reuses a valid cache entry). If videos were added, removed, or
   moved, a banner summarizes the change and affected ranges/checkpoints are
   flagged **needsReview** — original boundaries are preserved for you to
   confirm, never silently rewritten.

### If import fails or videos are unavailable
- **Key missing/invalid/restricted/quota** — the error message names it;
  follow the API-key steps above, or wait for the daily quota reset and use
  JSON import meanwhile.
- **Deleted/private/region-blocked videos** appear as `unresolved`; totals
  are always labeled **incomplete**, never silently dropped.
- **Player won't embed (101/150)** — use Open on YouTube and log a
  self-reported History entry (that watch can't be verified here).
- Playlists are capped at **1000 entries**; larger ones are rejected with a
  clear message.

### Select and switch playlists
Use the **Active playlist** dropdown (sidebar, or mobile header). Switching
only changes the view — every playlist's progress, modules, and history are
kept separately and never mixed.

## B. Studying and tracking

### Recording progress
- **Library table** — the circle button toggles **manual** completion
  (for videos you genuinely watched outside the app; always labeled manual).
- **Player tab** — pick a position (number input, Prev/Next, or your Queue),
  press Play in the embedded player. Position is sampled ~2×/s. Timeline
  intervals observed while playing count as **verified** coverage; paused,
  buffering, and seeked-over spans never count. Rewatches add to playback
  totals but unique coverage counts each second once. At ≥ threshold unique
  coverage (default 90%, adjustable 50–100% in Settings) the video flips to
  **✓ verified**. Refreshing mid-playback ends verification honestly — no
  background time is ever credited.
- **History tab** lists every session with verified vs self-reported labels,
  per-video segment details, and a self-reported entry form for older history.

### Duration, repeats, and unique content
A 20-minute video plus notes, pauses, and practice is more than 20 minutes
of studying. LearnQuest keeps four separate quantities: unique timeline
seconds (interval union), total playback content (incl. repeats), active
wall seconds, and focused study seconds. Rewatching never inflates unique
progress; seeking never credits skipped spans.

### Focus timer
**Focus tab → Start / Pause / Resume / Finish & record / Reset.**
- Only *active* seconds are recorded; finishing never auto-completes videos.
- Sessions under 10 s are discarded with a notice.
- **Session note** and **manual correction** (minutes, e.g. you forgot to
  start/stop) are applied on finish.
- Set a daily target plus a **minimum-viable** fallback (10 focused minutes
  still counts); **Set goal** saves it.
- If the page reloads or the browser sleeps mid-session, the running timer
  is lost — finished history is never rewritten. Record what you actually
  studied instead; interrupted time is never invented.

## C. Organizing learning

### Library range explorer
Set **Start/End** (clamped to `1–N`) or use presets (Full/First/Middle/Final).
The summary shows the exact `H:MM:SS` sum of those videos' real durations,
resolved/unresolved counts, a session estimate, and done counts. Two chart
views share one pipeline: **Video duration** (bars = minutes per video) and
**Cumulative duration** (line = running total) — never mixed. Every entry is
plotted; long-range tick labels thin out but always include the first and
last positions. **Save** stores the range for one-click totals. Row
checkboxes sum any hand-picked selection (labeled as a selection, not a range).

### Modules
A module is a chapter **you** define (e.g. "JavaScript Fundamentals").
**Modules tab:** name it, assign positions with `1-8, 10` syntax (validated
against `1–N`), then rename, reassign, reorder (up/down), or delete. Cards
show video/duration progress. LearnQuest never auto-assigns topics.

### Checkpoints and ranges
A checkpoint is a milestone defined by an inclusive video range.
**Checkpoints tab:** label it, pick start/end, press **Add** — progress
bars, remaining work, and completion (with celebration + XP) appear
automatically. After a playlist refresh that shrinks `N`, affected items
show **needsReview**: edit or delete them explicitly. Saved Library ranges
live here too for renaming/deletion.

### Playlist changes and review flags
Refreshing metadata never erases progress. If the playlist shrinks or moves,
saved ranges/checkpoints keep their original boundaries and are flagged
until you confirm them.

## D. Revisions

Lessons enter the **Revision** queue when flagged **needs revision**
(Player, Library table, or the position box on the Revision screen), rated
confidence 1–2, given a revision date, or left with open questions.
- **Filters:** all / low confidence / open exercises / questions / overdue.
- **Overdue** means the revision date is a past calendar day in your display
  timezone (today is not overdue; malformed dates are never treated as due).
- Each card holds confidence (1–5), revision date, notes, key concepts,
  questions, and evidence checkboxes (code reproduced, exercise done, built
  example).
- **Mark revised** clears the flag, records the review, and awards one XP
  reward per lesson per day — repeated clicks never double-award.
- An empty queue ("Queue clear") means nothing currently needs review — not
  a broken feature. Only your actions create entries; nothing is pre-filled.

## E. Goals, achievements, and Arena

### Goals
**Goals tab → Create goal:** metric (videos, unique content, focus time,
playback time, checkpoint), target, scope (playlist or all), optional
checkpoint, **Due today** (checked) or open-ended (unchecked). A goal becomes
achieved only when its condition holds — never because time elapsed.
Past-due unmet goals read **missed** without deleting anything; goals can be
paused, resumed, or deleted. **Focus tab** holds the simpler daily target.

### Streaks, XP, achievements
- **Streak** = consecutive local study days (cross-midnight sessions count
  on both days); missed days cost only the count.
- **XP:** video 10 · exercise 5 · code 5 · built example 8 · revision 4 ·
  checkpoint 50 · 30 min focus 15 · study day 20 · achievement 25 · goal 30.
  Re-clicks never double-award (ledger dedup keys). The Dashboard shows total
  XP and achievement badges.

### Arena (optional, off by default)
Everything here is a **fictional local simulation** — no real users, no
network, no real leaderboard.
- **What ranks (and nothing else): average daily content efficiency.**
  Each eligible day's efficiency (unique ÷ focused × 100) counts once; the
  score is the mean over eligible days. Hours, videos, XP, and tier appear as
  context only and never affect rank.
- **Setup:** enable competition, then cohort size 10–2000 (including you),
  **max rival study per day** 1–12 h (default 6 h — fictional ceiling only;
  your real sessions are never capped), seed, window days, and tier
  distribution (must sum to 100).
- **Rivals** own coherent daily histories (active days, focused minutes
  within habits and the cap, date-varying efficiency inside tier bands,
  content derived from those two and capped by remaining playlist content).
  Tier bands (Ultra 100–110% … Below Average 20–39.9%) are design
  assumptions, separate from distribution. Daily results vary within
  ceiling−deviation … ceiling (Ultra 15 pts … Below Average 4 pts).
- **Eligible days:** windows ≥ 3 days need ≥ 3 eligible days; shorter windows
  need one per day. Below that you see
  **"Provisional — complete N more eligible study days"** with your recorded
  dailies and a next action — never a bottom rank, never a fabricated score.
- **Rank X of N** (1 is best; ties share: 1, 2, 2, 4). "Ranked above Y%" =
  share ranked strictly below you. Gap lines read in percentage points to
  the rival directly above you.
- **Leaderboard** shows average daily efficiency front and center with exact
  window dates, eligible-day counts, 25/50/100 rows per page, Top/Near-me
  views, alias search, and a My-rank jump. Same seed + settings + window
  dates reproduces the same cohort; the rolling window slides as days pass.
- **Reset sim** clears only simulated snapshots. Real history, goals, and
  achievements are untouched. The Efficiency page's aggregate ratio and the
  Arena's daily mean intentionally differ — same records, different question.

## F. Dashboard, analytics, history, and reports

- **Dashboard** — playlist header (resolved/unresolved, complete vs
  incomplete total), videos/content/remaining/count stats, cumulative curve,
  today's goal + streak + 7-day focus trend, next milestone, achievements/XP,
  recent completions.
- **Efficiency** — `uniqueContent ÷ focusedStudy × 100` (`n/a` on zero
  focused time, never NaN). **Overall is the aggregate ratio over the
  selection, never the mean of daily percentages** (a 5-minute day must not
  weigh like a 3-hour day). The Evidence filter separates verified from
  self-reported; >100% is normal above 1× speed and is not "better".
- **Analytics** — cumulative curve, duration distribution, done-vs-remaining
  (honest 0% state), verified-vs-manual, session-length histogram, module
  workload, and cautious auto-insights with sample-size caveats.
- **History** — today/yesterday/week/month/all/custom ranges, per-playlist
  filter, per-video drill-down, cross-midnight splitting at your timezone's
  boundaries.
- **Library/Reports tables** — search, filter, numeric duration sort
  (unresolved last), title sort, pagination (Library 25/page; changing sort
  returns to page 1). Sorting never mutates stored order; positions stay
  canonical.
- **Exports** — Backup JSON (everything, versioned), Videos/Sessions/
  Checkpoints CSVs with playlist/position identity. Restore validates before
  touching data and reports row-level problems.

## G. Timezone and dynamic time

- **Settings → Display timezone** (searchable picker with live UTC offsets).
  It changes grouping and display only — stored UTC events are never
  rewritten, and reports recompute instantly without refetching.
- Day grouping, daily summaries, revision overdue, streaks, weekly windows,
  and Arena windows all follow the selected timezone with DST-safe calendar
  arithmetic (23-hour and 25-hour days handled; the current partial day is
  included).
- Open tabs refresh after midnight, sleep/wake, tab-visibility return, and
  timezone changes. System-clock jumps are treated cautiously: intervals
  that end before they start attribute honestly to the start day without
  inventing time.
- Long-horizon behaviors (overnight soak, live clock-change runs) are
  implemented but were verified by unit/integration tests and inspection in
  this environment — see `docs/audits/V7_FINAL_ACCEPTANCE.md`.

## H. Backup, restore, and data safety

- **Download:** Reports → **Backup JSON** (everything, versioned v2).
  Store the file yourself — there is no cloud copy.
- **Restore:** Reports → **Restore backup** (validates first; v2 restores v1
  backups too) or **Import snapshot JSON** (single playlist metadata).
  Malformed files are rejected with row-level messages; restores never
  half-apply.
- **CSV exports** carry playlist/position identity and current values.
- **Clear cached metadata (keep progress)** drops playlist snapshots only
  (re-add to refetch). **Clear ALL data** (two-step confirm) deletes
  everything locally — export a backup first.
- If a save ever fails (e.g. browser storage full), the app shows one
  actionable backup notice instead of failing silently; your in-memory
  session data stays available until you back it up. Concurrent tabs are
  last-writer-wins — prefer one tab for recording.
- Practical habit: export a backup weekly (or before playlist refreshes and
  major cleanups) and keep two recent copies.

## I. Troubleshooting and FAQs

| Problem | What to do |
|---|---|
| Import fails / invalid playlist | Re-paste a `youtube.com/playlist?list=ID` link or raw ID; check public visibility |
| API key missing/invalid/restricted | Re-check key + restrictions in Google Cloud; restart backend; Recheck in Settings |
| Quota exhausted | Wait for the daily reset; use JSON import meanwhile (~5 units per 100-video import, ~21 per 500) |
| Backend slow to start / unreachable | Wait for cold start (Render free spins down when idle — the status pill re-checks on tab focus, or press Recheck in Settings); check `PORT`/`CORS_ORIGIN` and both dev servers. Production: `VITE_API_BASE_URL` must be the exact Render origin on the Vercel **Production** env (no trailing slash, no `/api` suffix) followed by a redeploy; `CORS_ORIGIN` on Render must exactly match the Vercel origin |
| Refresh fails | Retry Refresh active — failures never poison the cache or delete progress |
| Unresolved videos | Expected for deleted/private/region-blocked items; totals stay incomplete-labeled |
| Focus session lost to reload/sleep | By design only finished sessions persist; record a History self-reported entry for the real study |
| Day-boundary numbers look off | Re-check the display timezone and its live UTC offset; cross-midnight sessions split across both days |
| Revision/goal status unexpected | Compare its date against today's date in the selected timezone; check filters (e.g. overdue vs all) |
| Changes missing after reload | Don't use private/incognito windows; check disk space; restore the latest backup |
| Invalid import file | Re-export from Reports; restores validate before applying anything |
