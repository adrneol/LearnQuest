# HOW TO USE LEARNQUEST — Complete User Manual

LearnQuest turns public YouTube playlists into measurable learning journeys:
exact duration math, verified watch tracking, focus sessions, modules,
checkpoints, goals, efficiency analytics, revision scheduling, and an
optional fictional Arena. Learning data belongs to your **authenticated
account** and is stored with that account, not only in one browser. Google is
the only registration path; password sign-in and single-use email-link recovery
are available after registration.

> Start with [A](#a-getting-started), then follow the journey in order.
> Technical verification lives in [`docs/user-doc/MIGRATION_RUNBOOK.md`](./docs/user-doc/MIGRATION_RUNBOOK.md).

## A. Getting started

### Prerequisites
- **Node.js 24.22.1+ (24 LTS)** and **npm 9+** (`node --version`,
  `npm --version`). `backend/.node-version` pins the patched version.
- **MongoDB**, a **Google OAuth web client**, and a **Brevo** API key with a
  verified sender for accounts, sign-in, password-reset links, and email
  verification. Full setup:
  [README Configuration](./README.md#configuration) and
  [Production deployment](./README.md#production-deployment).
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

Open **http://localhost:5173**. With account services configured, you see the
sign-in screen. If required credentials are missing, the app shows a
fail-closed setup screen listing the missing variable names; it never offers a
fake local login.

### Configure account services
1. Copy `backend/.env.example` to `backend/.env`.
2. Fill in `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `BREVO_API_KEY`, and `BREVO_SENDER_EMAIL`.
3. Generate two independent secrets and set `SESSION_SECRET` and
   `EMAIL_ACTION_HMAC_SECRET`:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
4. Keep `APP_ORIGIN=http://localhost:5173`,
   `CORS_ORIGIN=http://localhost:5173`, and
   `GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback`.
5. Register that exact redirect URI in Google Cloud and verify the Brevo
   sender. Restart the backend after any `.env` change.
6. Open the app, choose **Continue with Google**, then complete onboarding by
   choosing a unique username, display name, and password (12+ characters).

### Configure the YouTube API key
1. At Google Cloud Console, create (or pick) a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **Credentials** → Create Credentials → **API key**.
4. Restrict it: *API restrictions* → YouTube Data API v3 only;
   *Application restrictions* → your backend host.
5. Set `YOUTUBE_API_KEY` in `backend/.env` and restart the backend.
6. Confirm: **Settings → Backend connection** reads
   **"● Connected — API key configured"**, or
   `http://localhost:3001/api/health` shows `"hasKey":true`.

Never put any key in a `VITE_` variable, the frontend, chat, or Git.
`backend/.env` is git-ignored; only `.env.example` files are committed.
If a key is ever exposed in a screenshot or message, revoke/rotate it in
Google Cloud immediately and update the replacement in Render.

### Sign in, recovery, and account security
- **Google** is the only registration path. Your verified Google email is the
  initial account email; you never type an arbitrary address at signup.
- **Sign in with Google** only signs in. **Create an account → Continue with
  Google** creates a new account. An unknown Google identity arriving through
  the sign-in button is told to create an account, not silently registered.
- Afterwards you can sign in with your username or email and password.
  Passwords are stored only as a one-way hash.
- **Forgot password?** Enter your username or email. If an account matches,
  LearnQuest sends a single-use link; the response does not reveal whether the
  account exists. The link expires after about 30 minutes (configurable) and
  is invalidated when a newer link is requested. The link opens a reset screen
  in the app; the token is exchanged only when you press **Set new password**,
  and the token is removed from the address bar immediately. Resetting signs
  out all existing sessions.
- The **account menu at the top-right of the main header** opens Profile,
  Account settings, Security & sessions, export, appearance, and sign-out.
- **Security & sessions** lists active devices, lets you sign out other
  devices or all devices, change your password, and verify a new email address
  with a single-use link sent to that new address. The old email stays active
  until verification. Successful verification signs out all sessions and
  notifies the previous address.
- **Account settings** stores learning preferences (timezone, default session
  length, break, minimum viable session) in your account, and supports
  permanent account deletion. Deletion requires your current password (or a
  fresh Google reauthentication if the account is Google-only), a recent
  reauthentication window, and the exact phrase `DELETE MY ACCOUNT`. Export
  first; deletion cannot be undone through LearnQuest.

### Account export and full backup

The Account page offers two downloads with different purposes:

- **Account export (organized .zip)** — `LearnQuest-Account-Export/` with
  `README.md`, `manifest.json`, `account/profile.json`, one JSON file per
  learning domain (`learning-data/*.json`), and CSV reports
  (`reports/videos.csv`, `reports/sessions.csv`,
  `reports/checkpoints.csv`). Best for archiving and inspection. Contains no
  passwords, no session cookies, no tokens and no API keys.
- **Full backup (restore-compatible Backup JSON)** — the versioned v3 envelope
  validated atomically by LearnQuest before restore. Use this one for moving or
  restoring an account; a pre-restore backup is downloaded before confirmation.

### Your first visit: a valid empty account
A brand-new account does **not** need a playlist, note, focus session, or
progress record before it can open LearnQuest. After onboarding and a
successful cloud read, you land on the normal dashboard with a welcome
empty-state card and an **Add your first playlist** action. Empty playlists,
progress, notes, sessions, goals, and XP are real defaults, not fake records.
If the cloud read genuinely fails, you see a retry/error screen instead; the
app never turns a failed read into an apparently empty account and never
overwrites cloud data with defaults.

If you started Google registration but have not finished choosing a username,
display name, and password, signing in again resumes **onboarding**. A pending
registration is not shown as a completed dashboard.

### Import a playlist
1. Copy a YouTube playlist URL (contains `?list=PL…`) or just the `PL…` ID.
2. **Library → Add playlist** (the button at the top of the page) → paste → **Add playlist**.
   First run: the onboarding card does the same thing. You can also import a
   JSON snapshot from the same add panel; adding is the canonical workflow —
   every other screen links to it.
3. The header then shows e.g. `Active playlist: … · N=139 · api`.
4. **Reports → Refresh active** re-checks YouTube for changes (it always revalidates;
   plain Add reuses a valid cache entry). If videos were added, removed, or
   moved, a banner summarizes the change and affected ranges/checkpoints are
   flagged **needsReview** — original boundaries are preserved for you to
   confirm, never silently rewritten.
5. Records left unmatched by a refresh stay in **Reports → Playlist changes
   need review**, discoverable from Library and Dashboard via the
   "Review playlist changes" count. Nothing is reassigned for you.

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
Use the **Active playlist** dropdown in the main header. Switching
only changes the view — every playlist's progress, modules, and history are
kept separately and never mixed.

### Navigate the workspace

Open the compass dock to see destinations for Learn, Insights, or Manage.
Select a mark, drag around the dial, or use the arrow keys to switch sections
immediately. Use **All pages** to search across sections. Escape returns to
the dial or collapses the dock.

Drag the collapsed dock to either screen edge and release it at your preferred
height. **Dock position** inside the dial offers edge buttons, a keyboard
adjustable position slider, and a reset. The browser remembers your placement.

## B. Studying and tracking

### Recording progress
- **Dashboard → Resume lesson** — the primary action now opens the in-app
  Player at the next unfinished lesson (tracked playback, verified evidence).
  An explicitly labeled **Open on YouTube (untracked)** link remains as a
  secondary action; external watching never produces verified evidence. When
  the playlist is complete, the CTA offers review from lesson #1 instead.
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
- **Player learning record** — toggle **Open record** in the Player aside for
  a compact live summary (confidence, notes, review flag) and expand the
  editor for that exact playlist occurrence: confidence (1–5), revision date,
  notes, key concepts, open questions, and code/exercise/example evidence. It
  autosaves after a short pause and flushes before you switch videos or leave
  the tab; saving never marks the video complete or verified. This persistent
  record is separate from the pause-note above, which belongs to the current
  playback session.
- **History tab** lists every session with verified vs self-reported labels,
  per-video segment details, and a self-reported entry form for older history.
  Every statistic, the session list, and per-video detail obey the selected
  range; an empty range says so explicitly instead of presenting fake zeroes.

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
- If the page reloads or the browser sleeps mid-session, the timer is
  recovered **paused at its last saved tick**; time while the page was closed
  is never counted. Resume to continue, or finish to record what was actually
  observed. Hiding the tab also pauses automatically.

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

### Checkpoints and saved ranges
A checkpoint is a milestone defined by one inclusive video range.
**Checkpoints tab:** type one range (`1-8`, `1–8`, `1 – 8`, or a single
position such as `103`). The display name is generated automatically
(**Videos 1–8** or **Video 103**) and a live preview shows exactly what will
be created. A custom name is optional and replaces only the generated label.
Reversed, fractional, negative, malformed, and out-of-bounds ranges are
rejected without clamping; fix the range or choose one inside `1–N`.
Creating a checkpoint tracks progress and recognizes completion with the
established milestone/XP behavior. Editing an auto-generated label updates it
to the new range; a custom name is preserved. After a refresh that shrinks
`N`, affected items show **needsReview** until you edit or delete them.
**Saved ranges** are separate Library duration calculations: they appear here
for renaming/deletion, but they are not checkpoints, do not track completion,
and do not award milestone XP.

**Create a checkpoint from a saved range** — Library's range explorer has a
**Create checkpoint** button next to *Save range*; the Checkpoints page also
offers a *Checkpoint* action per saved range. Both open the New checkpoint
form prefilled (range, suggested label) — nothing is created until you confirm
with **Add checkpoint**.

### Playlist changes, review flags, archive, and permanent delete
Refreshing metadata never erases progress. If the playlist shrinks or moves,
saved ranges/checkpoints keep their original boundaries and are flagged
until you confirm them.

**Dashboard → Your playlists → Manage / Remove** offers two distinct choices:
- **Remove from dashboard (keep my learning data)** archives the playlist.
  Progress, notes, review history, Focus sessions, playback evidence,
  checkpoints, saved ranges, modules, scoped goals, achievements, and XP are
  preserved. It disappears from active totals and the active-playlist selector;
  **Archived playlists → Restore** brings it back without duplicate records or
  recreated XP.
- **Permanently delete playlist and all its learning data** requires typing
  the exact displayed title (including a custom title). It removes only
  account-owned records reliably attributable to that playlist. Other
  playlists, account-wide settings, day goals, and unattributable XP are kept.
  The public YouTube playlist itself is never modified. Deletion cannot be
  undone through LearnQuest; export a backup first if unsure.
The dialog shows the counts that will be affected before you confirm.

## D. Revisions

Lessons enter the **Revision** queue when flagged **needs revision**
(Player, Library table, or the position box on the Revision screen), rated
confidence 1–2, given a revision date, or left with open questions.
- **Sticky toolbar:** the find field, jump button, and filters stay below the
  app header while you scroll a long queue.
- **Find and jump:** type a lesson position (`50`, `050`) or part of a title,
  then press **Enter** or **Jump**. The matching card scrolls into view below
  the sticky header, highlights briefly, and receives focus. A jump that would
  be hidden by the current filter explains why and clears that filter.
- **Scope:** **Revision queue** shows only current review signals. **All
  lessons** browses every playlist entry — including reviewed lessons and
  entries with no record — and adds a **Reviewed** filter. Search always
  covers the whole playlist, so a lesson that left the queue stays findable
  with its notes intact.
- **Filters:** all / low confidence / open exercises / questions / overdue,
  with a visible filtered count and inline errors for missing lessons. An
  absent `exerciseDone` value is not treated as an unfinished exercise.
- **Overdue** means the revision date is a past calendar day in your display
  timezone (today is not overdue; malformed dates are never treated as due).
- Each card holds confidence (1–5), revision date, notes, key concepts,
  questions, and evidence checkboxes (code reproduced, exercise done, built
  example).
- **Mark revised** clears the current flag and revision date, appends a dated
  review, and awards one XP reward per lesson per day — repeated clicks never
  double-award or duplicate history. Notes, concepts, questions, confidence,
  and completion evidence are preserved.
- A lesson can legitimately show both **Reviewed on …** (history) and **Needs
  revision** (current work); the UI explains this instead of hiding either
  state. Notes and key concepts alone never keep a lesson in the queue.
- An empty queue ("Queue clear") means nothing currently needs review — not
  a broken feature. Only your actions create entries; nothing is pre-filled.

## E. Goals, achievements, and Arena

### Goals
**Goals tab** now presents two cooperating views of one discipline without
merging their data:
- **Today's focus goal** — the calendar-day commitment set on the **Focus
  tab** (minutes per day, minimum viable minutes). Goals shows your progress
  against it; Focus keeps its editor and both read the same record — it can
  never drift between pages.
- **Flexible goals** — metric (videos, unique content, focus time, playback
  time, checkpoint), target, scope (playlist or all), optional checkpoint,
  **Due today** (checked) or open-ended (unchecked). A goal becomes achieved
  only when its condition holds — never because time elapsed.
  Past-due unmet goals read **missed** without deleting anything; goals can be
  paused, resumed, or deleted.

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
- **What ranks (and nothing else):** Arena v3 score = 75% playlist coverage +
  25% consistency (qualifying days ÷ window days). A day qualifies with 5
  minutes of new verified coverage or a completed lesson, plus 10 minutes of
  focus or observed playback. Scores describe a private fictional comparison —
  no real users, no network, no real leaderboard.
- **Setup:** create a simulation from the Arena tab: a name, mode (Practice
  or Fixed challenge), difficulty (Relaxed / Balanced / Challenging — changes
  rival traits only), opponents (1–2000), days (1–90), and seed (the same seed
  reproduces the same cohort). Playlist basis and timezone are frozen when the
  simulation is created; every duration must be resolved first.
- **Qualifying days:** a day qualifies with ≥5 minutes of new verified
  coverage or a completed lesson, plus ≥10 minutes of focus or observed
  playback (the greater of the two). Estimated focus and unsaved focus drafts
  never qualify; rewatches never re-add coverage.
- **Rivals:** a seed-generated fictional cohort with cadence, pace, and
  endurance tied to difficulty. No statistical claim about real learners.
- **Scoring:** 75% playlist coverage + 25% consistency (qualifying days ÷
  window days), full precision. Identical scores share a rank (1, 2, 2, 4) and
  the next place stays open. A learner is provisional until at least 3
  qualifying days and 7 observed calendar days.
- **Practice** compares the same rolling window of closed local days for you
  and the cohort; pause freezes the displayed result and resume catches up.
  **Fixed challenge** starts at local midnight with frozen dates; only closed
  days count, even when finalized early.
- **Completion** saves a replay artifact — same seed, same rivals, saved
  evidence; replay never reads current learning state. If replay ever differs,
  the recorded result is kept and the conflicting leaderboard is suppressed.
- **Archive** moves a completed result to simulation history (bounded to 20
  runs, 90 saved rank checkpoints per run). **Delete simulation** removes only
  that simulation's records and never touches playlists, progress, sessions or
  XP. Reset practice seals and archives the current result and starts a fresh
  run with the same seed and configuration.

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
- **Exports** — two formats with different purposes (both from the Account page):
  (1) **Account export (.zip)** — organized, readable folder; excluded from restore;
  (2) **Full backup (Backup JSON)** (restore-compatible) — versioned; restored through **Restore backup**;
  Videos/Sessions/Checkpoints CSVs with playlist/position identity. Restore validates before
  touching data and reports row-level problems.

## G. Timezone and dynamic time

- **Settings → Display timezone** — full IANA timezone database (grouped by
  region; includes `Asia/Kolkata`, `Asia/Calcutta`, `America/New_York`,
  `Europe/London`, `Australia/Sydney`, `Pacific/Auckland`, `Etc/GMT` zones and
  aliases). Searchable by city, region, IANA identifier, offset and alias.
  Live UTC offsets update for DST; the current device zone remains selectable.
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
  this environment — verified by unit/integration tests and source inspection.

## H. Backup, restore, and data safety

- Your account is the primary copy in the cloud. **Download:** Reports →
  **Backup JSON** (everything, schema v3), or the account menu → **Export
  account data**. Account exports never include passwords, email action
  tokens, or sign-in tokens. Keep an offline copy before major cleanups.
- **Restore:** Reports → **Restore backup** validates the complete file first;
  v3 restores v2/v1 backups too. You are offered a fresh pre-restore JSON
  download before anything is replaced. The restore is all-or-nothing, and
  **Import snapshot JSON** (in Library's add panel) handles single-playlist
  metadata separately. Malformed files are rejected with row-level messages;
  restores never half-apply.
- **CSV exports** carry stable playlist/entry identity and current values;
  text beginning with formula characters is escaped for spreadsheets.
- **Clear cached metadata (keep progress)** — in **Settings → Data &
  privacy** — drops playlist snapshots only (re-add to refetch). **Clear ALL
  data** — same place, two-step confirm — deletes all learning data **and
  resets preferences** in your account (or locally in test mode) while
  keeping the account, profile, and security settings — export a backup
  first. Pending debounced writes are drained before the clear, so old
  state cannot reappear.
- **Archive** keeps every playlist record and only hides it from active lists
  and totals. **Permanent delete** removes that playlist's progress, sessions,
  playback segments, saved ranges, checkpoints, modules, revision-queue
  entries, scoped goals, and reliably attributable XP; other playlists are
  untouched.
- If a save ever fails (e.g. browser storage full), the app shows one
  actionable backup notice instead of failing silently; your in-memory
  session data stays available until you back it up. A failed database **read**
  shows a retry screen and never initializes defaults over existing data.
  Concurrent tabs are last-writer-wins — prefer one tab for recording.
- The only `localStorage` values are device-local UI preferences
  (`lq-nav-collapsed`), the interrupted-focus recovery snapshot
  (`lq-focus-timer-v1`), the one-time storage notice, and the legacy-import
  claim marker; they never contain learning records for cloud accounts.
- Legacy browser data is offered for import only after sign-in. Existing cloud
  records win on identical IDs; the local source is retained on failure and can
  be retried. A different account never inherits it.
- Practical habit: export a backup weekly (or before playlist refreshes and
  major cleanups) and keep two recent copies. **Delete my account** removes
  the account, every account-owned learning record, sessions, sign-in links,
  migration/version metadata, and the temporary deletion job. The server
  verifies zero remaining records before returning success. If cleanup is
  interrupted, it reports that deletion is incomplete and resumes safely on a
  later request or server restart; it never claims the account is gone while
  records remain. Provider-managed backups and email-provider logs follow
  their own retention policies and are not erased by the LearnQuest cascade.
  See [Data persistence and privacy](./README.md#data-persistence-and-privacy)
  and the [migration/rollback runbooks](./docs/user-doc/MIGRATION_RUNBOOK.md)
  for the owner-side backup/retention checklist.

## I. Troubleshooting and FAQs

| Problem | What to do |
|---|---|
| Setup/configuration screen | Add the listed names to `backend/.env`, restart, and retry. Accounts fail closed; there is no fake local login |
| Google sign-in fails | Check the OAuth web client, exact redirect URI, consent-screen test user, and `GOOGLE_CLIENT_ID`/secret |
| Recovery or verification email missing | Check the email provider's transactional email log for the recipient and status; verify sender/domain authentication (a verified Gmail sender can still fail DKIM/DMARC alignment), API key permissions, and spam; wait for the resend cooldown; request a new link (older links stop working). An unknown or ineligible account intentionally receives no message. See [Configuration](./README.md#configuration) |
| Account storage errors | Check the connection string, database user, and network allow-list. No local fallback is used |
| “Your account data is unavailable” or “incomplete learning data” | The client rejects incomplete account-data responses. If onboarding is unfinished, finish it; otherwise press Retry. Confirm the deployed frontend/backend are from the same release. A genuine read failure is shown as an error, never as an empty account |
| New account sends me back to onboarding | The Google registration is still pending (no completed username/password). Finish the onboarding form; no learning data is loaded or overwritten before then |
| Can't delete my account | Enter the current password (Google-only accounts need a fresh Google sign-in), reauthenticate recently, and type `DELETE MY ACCOUNT` exactly. An interrupted cleanup is reported as incomplete, not success |
| Cloud save conflict | Another session changed the account. Use the conflict banner to reload before editing again |
| Import fails / invalid playlist | Re-paste a `youtube.com/playlist?list=ID` link or raw ID; check public visibility |
| API key missing/invalid/restricted | Re-check key + restrictions in Google Cloud; restart backend; Recheck in Settings |
| Quota exhausted | Wait for the daily reset; use JSON import meanwhile (~5 units per 100-video import, ~21 per 500) |
| Backend slow to start / unreachable | Wait for cold start (Render free spins down when idle — after the 2026-11-10 changes the app detects `503`/timeout via `/api/ready`, shows a "server starting…" state, auto-retries with backoff, and resumes bootstrap automatically; the status pill re-checks on tab focus). If it still fails, check `PORT`, `CORS_ORIGIN`, and both dev servers. Production must use the same-origin Vercel `/api` rewrite (`VITE_API_BASE_URL` is ignored; same-site custom domains are not supported without code changes). A direct `*.vercel.app` → `*.onrender.com` API URL is cross-site and the `SameSite=Lax` session cookie is not sent; see [Production deployment](./README.md#production-deployment) |
| Refresh fails | Retry Refresh active — failures never poison the cache or delete progress |
| Unresolved videos | Expected for deleted/private/region-blocked items; totals stay incomplete-labeled |
| Focus session lost to reload/sleep | Reopen Focus: a snapshot is recovered **paused**. Time while the page was closed is never counted; resume or finish what was actually observed, or record a History self-reported entry |
| Day-boundary numbers look off | Re-check the display timezone and its live UTC offset; cross-midnight sessions split across both days |
| Revision/goal status unexpected | Compare its date against today's date in the selected timezone; check filters (e.g. overdue vs all) |
| Changes missing after reload | Check the cloud-save status; retry a failed save or reload a conflict. Then check the account/API connection and restore the latest backup if needed |
| Invalid import file | Re-export from Reports; restores validate before applying anything |
| Playlist disappeared | Check **Dashboard → Your playlists → Archived playlists**; archive is recoverable, permanent delete is not |
