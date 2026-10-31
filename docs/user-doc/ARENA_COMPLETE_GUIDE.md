# LearnQuest Study Arena — Complete Guide

**Status:** current implementation as of 2026-11-01  
**Model:** `arena-v2`  
**Scope:** the Arena screen in LearnQuest (`#/arena`) and the scoring/simulation code it uses.  
**Companion evidence:** `frontend/tests/arena.test.ts`, `frontend/tests/store-integrity.test.tsx`, `frontend/tests/responsive-layout.test.tsx`, and Report 24.

> **Read this first:** Arena is a **fictional practice simulation**. It is not a real-person leaderboard, a comprehension test, a retention score, an official season, or a server-verified competition. All opponents are generated on your device from a seed. Your score is computed in the browser from your own LearnQuest records.

## Status labels used in this guide

| Label | Meaning |
|---|---|
| **Implemented and tested** | Present in the current code and covered by automated tests. |
| **Implemented, not browser-verified** | Present in the code and covered by jsdom/unit tests, but no real-browser or screenshot verification was performed in this phase. |
| **Proposed, not implemented** | Described in earlier audit/report discussion but not present in the current product. |
| **Known limitation** | Present behavior with a real accuracy, fairness, or verification limit. |

---

## 1. What Arena is — and what it is not

### It is

- An **optional fictional competition simulator**.
- A way to compare your own sustainable playlist completion against synthetic rivals.
- A **75% progress + 25% consistency** score (`arena-v2`).
- Deterministic: the same seed, settings, window dates and playlist basis produce the same synthetic rivals and rival scores.
- Separate from your real learning records: Arena never changes progress, sessions, XP, goals, achievements, notes, or playlists.

### It is not

- A leaderboard of real LearnQuest users.
- A public or global ranking.
- A measure of intelligence, understanding, retention, attention, productivity, or employability.
- A verification that you actually watched, understood, or completed a video. Manual completion is accepted as progress but is labelled self-reported.
- A server-authoritative score. The server stores account data, but the Arena calculation runs in the browser.
- An official season with prizes, entry fees, anti-cheat review, or a global cohort.
- A replacement for Focus, Progress, Efficiency, Analytics, or Revision.

**Implemented and tested:** the simulator, v2 formula, qualifying-day rule, deterministic rivals, private fixed runs, rank snapshots.  
**Not implemented:** real-person leaderboards, global seasons, server-side score validation, prizes, public profiles, automatic season rollover.

---

## 2. Where Arena lives

Arena is the **Arena** tab in the main navigation (swords icon). It uses the currently active playlist in practice mode, or the playlist captured by a fixed run.

The screen has four regions:

1. **Arena header** — fictional-simulation notice, model version, enable/disable, pause/resume, reset.
2. **Simulation settings** — practice/fixed mode, start/end fixed run, opponents, window, intensity, seed, advanced distribution and daily cap.
3. **Your score** — rank, percentile, score breakdown, provisional/calibrating state, rank snapshot.
4. **Leaderboard and explanation** — search, top/near view, page size, row details, pagination, “How ranking works”, evidence counts.

If no playlist is active, Arena shows “No active playlist”. If the active playlist has any unresolved duration, Arena shows “Arena unavailable” instead of inventing a denominator.

**Implemented, not browser-verified:** the section map above is based on source inspection and jsdom-rendered structure. No real-browser screenshots were captured in Phase 24 because no approved Playwright/browser installation exists.

---

## 3. Model version and why it exists

`ARENA_MODEL_VERSION = 'arena-v2'`.

Versioning exists so a score can be interpreted later:

- The formula, weights, qualifying thresholds and rival-generation assumptions belong to a named model.
- A fixed run stores `modelVersion` and the exact `weights` it started with.
- UI labels and rank snapshots include the model version.
- A future model must not silently rescore an old run. A new model should introduce a new version and a migration/exhibition policy.

**Current reality:** only `arena-v2` is implemented. `normalizeChallenge` forces saved configurations to `arena-v2`. Older saved tier-efficiency bands remain in the source only as simulation-design context; they are **not** used for v2 ranking. There is no separate v1 scorer or automatic legacy-score conversion.

---

## 4. The score formula

For a playlist with a fully resolved duration:

```text
P = min(U / L, 1)
C = min(Q / W, 1)
Arena = 100 × (0.75 × P + 0.25 × C)
```

| Symbol | Meaning | Unit / range |
|---|---|---|
| `U` | Unique covered/completed playlist content in the current window | seconds, `0 ≤ U ≤ L` |
| `L` | Total resolved duration of the playlist basis | seconds, `L > 0` required |
| `P` | Progress ratio | `0..1` (clamped) |
| `Q` | Qualifying days in the window | integer days |
| `W` | Window length | integer days, `1..90` |
| `C` | Consistency ratio | `0..1` (clamped) |
| `Arena` | Score | `0..100` |

- `P` is `null` when `L` is unavailable (any unresolved duration, zero entries, or non-positive total).
- `C` is `null` when `W = 0`, which is not a valid saved setting.
- If either component is `null`, the score is `null` and the row is shown as **Unavailable**.
- If both components exist, the score is always bounded 0–100.
- Weights are exactly **0.75** and **0.25**. They are a product policy choice, not a scientific constant. Phase 24 did **not** change them.

### Score component cards

The “My Arena score” card shows:

- `P` as a percentage and its contribution in points (`P × 0.75 × 100`).
- `C` as a percentage and its contribution in points (`C × 0.25 × 100`).
- The combined score and `U of L content`, plus `Q/W qualifying days`.

**Implemented and tested:** `arenaComponents`, `arenaScore`, clamping, `null` propagation, weight values.

---

## 5. Playlist duration denominator (`L`)

### Rule

The denominator is the **sum of every playlist entry's resolved duration**.

- Every entry must have a finite, positive-or-zero duration.
- The total must be greater than zero.
- If even one entry has `durationSec: null`, the whole Arena score is unavailable. No average, median, fallback, or partial denominator is substituted.
- Duplicate video occurrences are distinct playlist occurrences. Each occurrence contributes its own duration and has its own progress identity.
- Stable identity is `entryId` when present; otherwise the position/video fallback is used. Reordering a playlist does not merge two occurrences.
- The progress/segment logic is keyed by the same entry identity used by Progress and Efficiency.

### Why unresolved durations block Arena

A denominator that silently ignores an unresolved video would inflate progress. A denominator that substitutes an average would create a score that looks precise but is not tied to the actual playlist. Arena therefore fails closed and labels the playlist unavailable.

### Empty / zero behavior

| State | Arena result |
|---|---|
| No playlist | “No active playlist”; no board. |
| Playlist with zero entries | `L = 0`; unavailable. |
| All entries resolved and total > 0 | Arena available. |
| One or more unresolved entries | Unavailable; resolved count is shown. |
| Negative or non-finite duration | Treated as unresolved; unavailable. |
| Imported playlist with missing metadata | Unavailable until durations are resolved. |

**Implemented and tested:** duplicate occurrences, unresolved durations, zero-duration cases, imported/unresolved behavior.

---

## 6. What counts toward progress (`U`)

Arena uses the **same stable playlist occurrences** as Progress. There are two contribution paths:

### 6.1 Completed entries

An entry that is complete and not orphaned credits its **full duration once**.

- `source: 'verified'` — verified completion. Counted in `verifiedCompleted` evidence.
- `source: 'manual'` or another non-verified source — manual/self-reported completion. Counted in `manualCompleted` evidence and labelled as self-reported.
- A completion is counted once per occurrence, even if the user watches it again.
- `completedAt` is used for the day on which the completion is attributed for the qualifying-day rule.

### 6.2 Incomplete entries with verified playback coverage

For an entry without a completion record, only **verified playback timeline coverage** counts.

- Coverage intervals are merged; overlapping and repeated playback do not add unique seconds.
- Coverage is capped at the entry duration.
- Seeking never credits skipped timeline spans.
- Buffering does not count.
- Partial coverage contributes only the unique covered seconds.

### 6.3 Playlist cap

The sum across entries is capped at `L`. `U > L` cannot produce `P > 1`.

### 6.4 Rewatches, duplicate videos, and cross-day coverage

- Rewatching already-covered material adds **no new unique content**.
- A duplicate video occurrence is separate content because it is a separate playlist occurrence.
- Playback that crosses local midnight is split at midnight. The next day can receive only the new unique coverage, never a repeated credit.
- Completing a video manually or through verified coverage is not a comprehension claim.

**Implemented and tested:** manual vs verified labels, duplicate occurrence identity, overlap merging, rewatch deduplication, cross-midnight splitting, per-entry cap.

---

## 7. Qualifying days (`Q`)

A day qualifies only when **both** conditions hold:

```text
(contentGainSec ≥ 300 OR a video was completed that day)
AND
max(focusSec, activePlaybackSec) ≥ 600
```

| Condition | Rule |
|---|---|
| New content | At least **300 seconds** (5 minutes) of new unique content on that local calendar day |
| Or completed video | At least one playlist video completion attributed to that day |
| Activity floor | At least **600 seconds** (10 minutes) of Focus active time **or** verified active playback wall time |
| Timer only | Does not qualify |
| Rewatch only | Does not qualify unless it is also a completion day |
| Content only, no activity | Does not qualify |
| Activity only, no content/completion | Does not qualify |

### Qualifying examples

| Day evidence | Qualifies? | Why |
|---|---|---|
| 300s new content + 600s Focus | **Yes** | Both floors met. |
| 299s new content + 3,600s Focus | **No** | Content below 5 minutes and no completion. |
| 0s new content + a completed video + 600s active playback | **Yes** | Completion substitutes for the content floor. |
| 1,000s new content + 599s Focus | **No** | Activity below 10 minutes. |
| 60s new content + 60s Focus | **No** | One-minute exploit blocked. |
| 20 minutes of timer time, no content, no completion | **No** | Timer-only day. |
| 10 minutes of verified playback with no new timeline coverage and no completion | **No** | Playback alone is not new content. |
| 300s new content + 600s verified active playback, zero Focus | **Yes** | Active playback satisfies the activity floor. |

`Q` is the count of distinct calendar dates that qualify. Duplicate day entries do not inflate the count; the user's window has one entry per date.

**Implemented and tested:** the one-minute exploit, timer-only days, threshold boundaries, completion substitution, active-playback substitution.

---

## 8. Window, timezone, and provisional eligibility

### Window

- `W` is the configured window in days.
- Practice mode builds the window ending **today** in the user's display timezone, inclusive, for `W` calendar days.
- Fixed mode stores the exact `windowDates` at start and does not slide.
- The window is calculated with calendar arithmetic, not `W × 86,400,000` milliseconds, so daylight-saving transitions do not shift the date list.

### Timezone

- Day attribution uses the user's LearnQuest display timezone.
- Focus sessions with real active intervals are attributed by active wall time; pauses are excluded.
- Playback segments are split at local midnight.
- Changing the display timezone can move a session/segment to a different local day. That is intentional for a user-facing calendar view, but it means the same recorded activity can produce a different qualifying-day count under a different timezone.
- Fixed runs store date keys, so changing the timezone after start affects local attribution for evidence but does not slide the frozen window dates. This is a known edge case; see limitations.

### Provisional rules

A user or rival is **provisional** when either:

- `Q < requiredQualifyingDays(W)`, or
- observed calendar days `< requiredObservedDays(W)`.

Where:

```text
requiredQualifyingDays(W) = min(3, W)
requiredObservedDays(W)    = min(7, W)
```

| Window `W` | Required qualifying days | Required observed days |
|---:|---:|---:|
| 1 | 1 | 1 |
| 2 | 2 | 2 |
| 3 | 3 | 3 |
| 7 | 3 | 7 |
| 14 | 3 | 7 |
| 30 | 3 | 7 |
| 90 | 3 | 7 |

- **Practice mode:** observed days equals the full window, so provisional status is normally driven by `Q < 3`.
- **Fixed mode:** observed days counts frozen window dates already reached in the user's timezone. A fixed run starts provisional even if the user has years of learning history, until 7 window dates have been observed and 3 qualifying days exist.
- **Synthetic rivals:** generated with `observedDays = W`, so their provisional status is driven by qualifying days.
- Provisional rows receive **no rank** and are **excluded from the percentile denominator**. They are placed after all scored rows, never treated as last place.

**Implemented and tested:** requirement scaling for short windows, practice/fixed eligibility, provisional exclusion, timezone-aware day slicing.

---

## 9. Synthetic competitors

### Cohort size

`cohortSize` includes you.

- Rivals generated = `cohortSize - 1`.
- Minimum 10 → 9 rivals.
- Default 100 → 99 rivals.
- Maximum 2000 → 1999 rivals.

Rivals are generated locally; no network request produces them.

### Determinism and identity

- A deterministic PRNG (`mulberry32`) and FNV-1a string hash drive all selections.
- The same seed, model version, rival index, date key and field produce the same draw.
- Aliases are generated in a stable order; expanding the cohort appends rivals without renaming existing ones.
- Rival IDs are `sim-<seed>-<index>`.
- Changing the tier distribution does not rename existing identities; it can change their tier/trajectory because tier is drawn on a separate field.

### Tier profiles

Tier labels are fictional design profiles, not population statistics.

| Tier | Target progress | Target consistency | Activity factor |
|---|---|---|---|
| Ultra | 98–100% | 85–95% | 0.90 |
| High | 90–98% | 70–85% | 0.80 |
| Good | 75–90% | 55–72% | 0.65 |
| Normal | 55–75% | 40–58% | 0.50 |
| Average | 35–55% | 25–40% | 0.38 |
| Below Average | 15–35% | 15–25% | 0.25 |

### Trajectory generation

1. Draw a tier from `tierDist`.
2. Draw target progress and consistency from that tier's ranges.
3. Convert target progress to target content seconds (`targetProgress × L`).
4. Convert target consistency to target days, then cap by how many 300-second content days the target content can support.
5. Rank candidate window dates using a deterministic activity draw, weekend penalty (`×0.72`), Monday penalty (`×0.92`), and an 8% rest-day chance (`×0.25`).
6. Select the top `targetDays` dates, then restore chronological order.
7. Allocate content monotonically: a 300-second base per selected day plus a weighted share of remaining target content.
8. Assign focus time at least 600 seconds, derived from the legacy tier efficiency band, capped by `dailyCapHours`.
9. Cap actual content gain by `focus × efficiency`; a day that cannot meet the rule stops the trajectory.
10. Mark `completedVideo` only when the gain is at least the larger of the playlist average video duration and 300 seconds, with a deterministic probability below 0.35.
11. Score the rival with the **same** `arenaComponents` function as the user.

### What is scored vs display-only

| Field | Scored? | Notes |
|---|---|---|
| `uniqueContentSec` | Yes | Drives `P`; capped by `L`. |
| `qualifyingDays` | Yes | Drives `C`. |
| `tier` | No | Display/design context only. |
| `focusSec` | No | Display/context. |
| `efficiency` | No | Display/context. |
| `activeDays` | No | Display/context. |
| `verifiedCount` | No | Display/context. |
| `practiceMin` | No | Display/context. |
| Session history | Indirectly | Aggregates derive from it, but rank uses only `U` and `Q`. |
| `dailyCapHours` | No direct user score | Caps simulated rival study time; never caps the user. |

**Implemented and tested:** deterministic replay, cohort expansion stability, alias uniqueness, tier-distribution independence for names, coherent trajectories, same-formula scoring, 2,000-rival/90-day performance budget.

---

## 10. Ranking, ties, and percentile

### Ordering

1. **Scored rows** (value not `null`) come first.
2. Scored rows sort by score descending.
3. Ties break by progress descending, then consistency descending, then stable ID.
4. **Provisional rows** come after all scored rows, sorted by stable ID.

### Competition rank

Rank is computed as:

```text
rank = 1 + number of scored rows with a strictly higher score
```

Therefore equal scores share a rank and gaps appear:

```text
Scores: 80, 70, 70, 60
Ranks:  1,  2,  2,  4
```

Tie-break fields determine display order, **not** rank.

### Percentile

```text
percentile = (scored rivals with score strictly below yours / all scored rivals) × 100
```

- The user is excluded from the denominator.
- Provisional rivals and the provisional user are excluded.
- If there are no scored rivals or the user is provisional, percentile is `null`.
- This is a percentile **within the fictional scored cohort**, not a population percentile.

### “of N scored”

The UI’s “of N scored” uses `boardScoredCount`, which includes the user plus all scored rivals. A rank of `#1 of 100` means 100 scored rows, not 100 real people.

### Gap to next

The gap is shown in **percentage points**, calculated against the nearest scored rival above the user. It is `null` when the user is leading, provisional, or has no score.

### Rank history

- “Snapshot my rank” is manual.
- It stores `at`, `rank`, `of`, and `metric` (`arena-v2`).
- Up to **100** entries are retained per account; the UI shows the last six.
- Rank history is part of cloud account data (`rankHistory`) and can sync. It is not an automatic audit log and does not store the full board.
- Reset sim clears rank history.

**Implemented and tested:** competition ranks, tie ordering, percentile strictness, provisional exclusion, “unavailable” rows, gap text, 100-entry cap, snapshot storage.

---

## 11. Every current Arena setting

### 11.1 Header controls

| Control | Default | Allowed | Effect | Scored? | Persistence |
|---|---|---|---|---|---|
| Enable competition / Enabled | Off | On/off | Shows or hides the Arena simulation body | No | `challengeEnabled` account data |
| Pause sim / Resume | Not paused | Toggle | Stops generating rivals while paused; your score card can still render | No | Component state only; resets on reload |
| Reset sim | — | Confirmation required | Clears rank history and resets challenge settings to defaults | No | `challenge` + `rankHistory` |

**Pause is not a fairness control.** It only removes simulated rivals from the current render. It does not freeze your learning data or create an official pause.

### 11.2 Simulation settings

| Control | Default | Allowed | Effect | Scored? | Fixed-run behavior |
|---|---|---|---|---|---|
| Opponents + you | 100 | Integer 10–2,000 | Number of rivals and board size | Only through rank denominator | Locked |
| Window | 14 days | Integer 1–90 | `W`, date list, consistency denominator, rival trajectory length | Yes | Locked with frozen dates |
| Intensity | Standard | Relaxed / Standard / Competitive | Replaces tier distribution preset | Rival mix only | Locked |
| New cohort | Seed `20261013` | Random integer 0–999,999,999 | New rival names/tiers/trajectories | Rival side only | Locked |
| Max rival study/day | 6 hours | Number 1–12 | Caps simulated rival focus per day | Rival side only | Locked |
| Tier percentages | 2 / 8 / 20 / 30 / 25 / 15 | Each 0–100; sum must equal 100 | Fictional cohort mix | Rival side only | Locked |
| Start private fixed run | — | Valid config + resolved playlist | Captures settings and playlist basis | Freezes the run | — |
| End fixed run | — | Confirmation | Returns to editable practice; fixed config is discarded | No | Ends lock |

#### Intensity presets

| Preset | Ultra | High | Good | Normal | Average | Below Average |
|---|---:|---:|---:|---:|---:|---:|
| Relaxed | 0 | 4 | 14 | 32 | 32 | 18 |
| Standard | 2 | 8 | 20 | 30 | 25 | 15 |
| Competitive | 5 | 15 | 25 | 30 | 17 | 8 |

Intensity is not stored separately. The UI derives the selected preset by comparing the current tier distribution to these exact vectors; any custom distribution displays as “Standard” in the dropdown.

#### Validation

- Cohort size must be an integer from 10 to 2,000.
- Window must be an integer from 1 to 90.
- Tier percentages must each be 0–100 and sum to 100 (within 0.001).
- Seed must be an integer.
- Daily cap must be 1–12 hours.
- Mode must be `practice` or `fixed`.
- A fixed snapshot must contain a string `seasonId` and a `windowDates` array.
- Invalid values produce visible error text and block fixed-run start.

**Implemented and tested:** defaults, ranges, validation, lock behavior, preset mapping.

### 11.3 Leaderboard controls (view-only)

| Control | Default | Effect |
|---|---|---|
| Search rival alias | Empty | Filters rows by alias substring |
| Top ranked / Near me | Top ranked | `Near me` centers the page around your row |
| Page size | 50 | 25, 50, or 100 rows per page |
| My rank | — | Clears search, switches to Near me, and jumps to your page |
| Prev / Next | — | Pagination |

These controls never change the score.

---

## 12. Practice mode vs a private fixed run

### Practice mode (default)

- Fully editable.
- The window slides to end today.
- Changing opponents, window, seed, intensity, tier mix or daily cap changes the **practice simulation**.
- Changing settings does **not** change the user's real progress, sessions, XP, goals or achievements.
- The score recalculates from current playlist/evidence and current practice settings.
- There is no “official” practice season and no persistence of a historical board.

### Private fixed run

Starting a fixed run captures:

- `seasonId` (generated locally)
- `modelVersion` (`arena-v2`)
- seed
- cohort size
- tier distribution
- window days and exact window date keys
- daily cap
- start/end timestamps
- playlist ID and snapshot version
- playlist duration
- entry count and average video duration (used only for rival simulation)
- exact weights `{ progress: 0.75, consistency: 0.25 }`

While fixed:

- The store refuses `setChallenge` edits, not just the UI inputs.
- The playlist basis and window dates remain frozen.
- The score uses the frozen playlist, even if the user switches the active playlist.
- If the frozen playlist is unavailable, Arena reports that the run cannot be reconstructed rather than substituting another playlist.
- Ending the run requires confirmation and returns to practice with the captured settings still usable as practice defaults.
- The fixed run is **not archived**; only manual rank snapshots remain. Starting a new fixed run replaces the old one.

**Implemented and tested:** immutable snapshot values, locked store action, explicit end action, frozen playlist binding, replay determinism, old fixed runs not silently rescored.

**Not implemented:** a global official season, server-side season enrollment, cross-user cohorts, fixed-run history/archive, automatic season transitions.

---

## 13. Reset, new season, playlist changes, seed changes and replay

### Reset sim

- Confirmation required.
- Clears `rankHistory`.
- Resets `challenge` to `DEFAULT_CHALLENGE`.
- Does **not** delete or alter progress, playlists, sessions, XP, goals, checkpoints, modules, notes or achievements.
- If a fixed run is active, reset abandons it (the fixed snapshot is cleared as part of the default config).

### New season

There is **no implemented global new-season operation**. A “new season” in the current product can only mean:

- reset the practice simulation, or
- end the current fixed run and start another private fixed run.

Neither creates a global season, a shared cohort, or a public historical record.

### Playlist changes

| Situation | Behavior |
|---|---|
| Practice: switch active playlist | Arena switches to the new playlist and recalculates. This is expected. |
| Practice: edit durations | Denominator and progress change. |
| Practice: add/remove entries | Denominator and identities change. |
| Fixed: switch active playlist | Fixed score remains tied to the captured playlist. |
| Fixed: edit the captured playlist | Duration is frozen; evidence is read from the current records for that playlist. This is a known tension: the denominator is frozen but later learning evidence can still count. |
| Fixed: delete/archive the captured playlist | If it disappears from local playlists, Arena shows unavailable; no substitute. |
| Fixed: playlist snapshot version changes | The frozen `playlistSnapshotVersion` is retained, but the app does not reconstruct the old entry list from version history. |

### Seed changes

- New cohort changes rival names/tiers/trajectories.
- It does not change your progress, qualifying days, `P`, `C` or score.
- In fixed mode the seed is locked.

### Replay determinism

Given the same seed, tier distribution, cohort size, window, daily cap, anchor dates and playlist basis, rival generation is identical. The user's score is **not** a function of the seed; it changes when the user's learning evidence changes.

A fixed run “replays” its frozen configuration, but it reads the user's **live** progress/segments. New learning during the run is intended to change the user's score. It is not a frozen historical score unless the underlying records are unchanged.

---

## 14. Empty, incomplete, imported, zero-duration and new-user states

| State | What Arena shows |
|---|---|
| Competition disabled | Header plus an optional-enable message; no board. |
| No active playlist | “No active playlist” empty state. |
| Playlist unresolved | “Arena unavailable” with resolved/total count. No score, no board. |
| Playlist with zero entries | Unavailable denominator. |
| New user, resolved playlist, no evidence | A 0% score but **provisional** (0 qualifying days, 0 observed in fixed mode); no rank. |
| New user with manual completions | Progress counts, manual evidence is labelled; still provisional until 3 qualifying days and 7 observed days (fixed). |
| Imported playlist with durations | Arena can run after the snapshot exists. |
| Imported playlist with null durations | Unavailable until resolved. |
| No scored rivals | Percentile `null`; user may still have a score. |
| All rivals provisional | User may be `#1 of 1 scored`; percentile may be `null`. |
| Fixed playlist missing | Unavailable; no other playlist substituted. |
| Zero-duration video entries | Treated as unresolved; whole Arena unavailable. |

---

## 15. Anti-manipulation protections and known limitations

### Protections that exist

- **One-minute exploit blocked:** fewer than 300 seconds of new content does not qualify unless a video was completed that day.
- **Timer-only days blocked:** 10 minutes of activity is required in addition to content/completion.
- **Content-only days blocked:** new content without the activity floor does not qualify.
- **Rewatch dedup:** repeated/overlapping coverage adds no unique content.
- **Playlist cap:** `U` cannot exceed `L`.
- **No XP/hours/streak/tier inputs:** these cannot directly inflate Arena.
- **No average substitution:** unresolved durations disable the score instead of guessing.
- **Fixed settings lock:** the store, not only the UI, refuses edits during a fixed run.
- **Frozen playlist binding:** switching active playlists cannot silently change a fixed run.
- **Stable identity:** duplicate video occurrences remain distinct.
- **Timezone-aware day attribution:** cross-midnight activity is split rather than double-counted.
- **Manual evidence label:** manual completion is never presented as verified playback.

### Known limitations

- **Client-authored scoring.** The score is calculated in the browser from account data. A determined user can alter stored records; there is no server signature or independent verification.
- **No comprehension proof.** Completion and playback coverage prove recorded activity, not understanding or retention.
- **No real-person comparison.** Rivals are synthetic profiles, not a representative sample.
- **Percentile is cohort-local.** It is not a population percentile and changes when cohort settings change.
- **Practice settings can change the simulation.** That is intentional, but it means practice ranks are not comparable across configurations.
- **Fixed run is private.** It is not a global season and has no server enrollment, matchmaking, anti-cheat review, or prize.
- **Fixed run does not freeze user evidence.** The denominator/config are frozen, but new progress/segments still count.
- **No fixed-run archive.** Ending a run discards its configuration except for manual rank snapshots.
- **Timezone changes after a fixed run start** can move evidence between local dates while the frozen window date keys stay fixed.
- **Old fixed snapshots** without `playlistEntryCount`/`playlistAvgVideoSec` fall back to the captured playlist if it still exists, otherwise the run is unavailable. They are never silently rebased to a different playlist.
- **No real-browser verification.** Phase 24 did not install Playwright or browser binaries. Layout, touch behavior, screenshots, screen-reader behavior, and real-device performance are not claimed as verified.
- **No server-side recalculation.** The server stores the data but does not recompute or certify Arena scores.

---

## 16. Worked examples

All examples assume a fully resolved playlist.

### Example 1 — consistent learner

```text
L = 36,000s (10 hours)
U = 18,000s
W = 14
Q = 7

P = 18,000 / 36,000 = 0.500
C = 7 / 14 = 0.500
Score = 100 × (0.75×0.5 + 0.25×0.5)
      = 37.5 + 12.5
      = 50.0
```

Not provisional: `Q=7 ≥ 3`, observed `14 ≥ 7`. Ranked.

### Example 2 — burst learner (provisional)

```text
L = 36,000s
U = 36,000s (100% progress)
W = 14
Q = 2

P = 1.000
C = 2 / 14 = 0.142857
Score = 75 + 3.571 = 78.6
```

The score exists in the breakdown, but the row is **provisional** because `Q < 3`. It gets no rank and is excluded from percentile. The UI shows “calibrating”, not last place.

### Example 3 — one-minute exploit

A learner records 60 seconds of new content and 60 seconds of Focus on each of 14 days.

```text
Content floor: 60 < 300 → no day qualifies (unless a video completed that day)
Activity floor: 60 < 600 → no day qualifies anyway
Q = 0
P might be 840 / 36,000 = 0.0233
C = 0
Score = 100 × (0.75×0.0233 + 0.25×0)
      = 1.75
```

Provisional; no rank. The exploit does not produce a competitive score.

### Example 4 — completed playlist

```text
L = 36,000s
U = 36,000s
W = 14
Q = 14

P = 1.0
C = 1.0
Score = 75 + 25 = 100.0
```

Ranked (assuming observed days ≥ 7 in fixed mode).

### Example 5 — unresolved duration

```text
L = null (one entry has no duration)
U = 18,000s
Q = 14
W = 14

P = null
Score = null
Display = "Unavailable"
```

No rank, no percentile, no fallback denominator.

### Example 6 — tie

Three scored rivals and the user:

```text
Rival A: 50.0
Rival B: 50.0
User:    50.0
Rival C: 10.0
```

Ranks: A=1, B=1, User=1, C=4. The user’s percentile is `1/3 × 100 = 33.3%` because only C is strictly below; A and B are ties, not “below”. “of N scored” is 4.

### Example 7 — manual completion

```text
L = 1,200s
U = 600s (one manual completion; no verified segments)
W = 14
Q = 1 (one day with a 900s Focus session and the completion)

P = 0.5
C = 1/14 = 0.0714
Score = 37.5 + 1.786 = 39.3
```

Provisional (`Q < 3`). The completion contributes, but the UI labels it manual/self-reported.

### Example 8 — duplicate playlist occurrences

```text
Entry 1: video X, 600s, entryId e1
Entry 2: video X, 600s, entryId e2
L = 1,200s
```

Completing entry 1 credits 600s. Entry 2 remains separate and contributes only its own evidence. Watching video X twice does not merge the two occurrences or double-credit one occurrence.

---

## 17. UI section-by-section map

### Header card

- Fictional-simulation banner with cohort count and seed.
- “Study Arena” title and model version.
- Enable/Enabled toggle.
- Pause sim / Resume.
- Reset sim (confirmation).
- 75/25 explanation.

### Simulation settings card

- Practice simulation / Private fixed run title.
- Start/end date and locked/client-computed status for fixed runs.
- Start private fixed run or End fixed run.
- Formula/window/timezone summary.
- Opponents + you.
- Window days.
- Intensity dropdown.
- New cohort button (or locked seed).
- Advanced settings: max rival study/day and six tier percentage fields.
- Validation messages.
- Fixed-run freeze explanation.

### My Arena score card

- Window label and timezone.
- Unavailable, calibrating, or ranked state.
- Rank, “of N scored”, score percentage, qualifying days.
- Percentile and gap/leading text.
- Score breakdown cards for P, C, and total.
- Tie/percentile/manual-evidence note.
- Snapshot my rank.
- Recent rank snapshots (`#rank/of → ...`).

### Leaderboard card

- Title, window, paused marker.
- Exact anchor date range and timezone.
- Search rival alias.
- Top ranked / Near me.
- Page size.
- My rank.
- Rows: rank, avatar/initials, alias, tier, qualifying/observed days, P/C context, score/“Calibrating”.
- Prev/Next pagination and counts.
- Fictional/calibration footnote.

### Explanation card

- Collapsible “How ranking works”.
- P, C, score, provisional, and anti-exploit text.
- Evidence counts: verified completed, manual/self-reported completed, content-only days excluded by the activity floor.

**Implemented, not browser-verified:** this map and the component tests. No screenshots were taken because the repository has no approved browser-testing setup and Phase 24 did not authorize installing Playwright/browser binaries.

---

## 18. Developer reference

### Source files

| File | Responsibility |
|---|---|
| `frontend/src/domain/competition/competition.ts` | Constants, formula, validation, fixed snapshots, rival generation, ranking, user evidence. |
| `frontend/src/domain/competition/aliases.ts` | Deterministic alias generation and initials. |
| `frontend/src/features/competition/Competition.tsx` | Arena screen, settings, score card, leaderboard, fixed-run binding. |
| `frontend/src/app/store.tsx` | `challenge`, `challengeEnabled`, `rankHistory` state; fixed-run lock/end action; cloud persistence. |
| `frontend/src/domain/time/time.ts` | Calendar windows, timezone day attribution, playback splitting, Focus attribution. |
| `frontend/src/domain/progress/identity.ts` | Stable entry progress index. |
| `frontend/src/domain/playback/playback.ts` | Interval merge and verified coverage helpers. |

### Model constants

| Constant | Value |
|---|---|
| `ARENA_MODEL_VERSION` | `'arena-v2'` |
| `ARENA_WEIGHTS` | `{ progress: 0.75, consistency: 0.25 }` |
| `ARENA_MIN_QUALIFYING_DAYS` | `3` |
| `ARENA_MIN_OBSERVED_DAYS` | `7` |
| `ARENA_QUALIFY_CONTENT_SEC` | `300` |
| `ARENA_QUALIFY_ACTIVITY_SEC` | `600` |
| Default seed | `20261013` |
| Default cohort | `100` (99 rivals) |
| Default window | `14` days |
| Default daily cap | `6` hours |
| Practice window | Ends today in display timezone, inclusive |
| Fixed window | Exact `windowDates` stored at start |
| Rank history cap | `100` |

### Persistence

Arena uses three logical domains in the account contract:

- `challenge` — `ChallengeConfig`, including optional fixed snapshot.
- `challengeEnabled` — boolean.
- `rankHistory` — manual rank snapshots.

These are part of the 20-domain account data set and follow the same local/cloud persistence path as other account data. Arena computation itself is client-side.

### Version and migration rules

- `normalizeChallenge` merges saved values over defaults, forces `modelVersion` to `arena-v2`, and resets to defaults if validation fails.
- Unknown mode values become `practice`.
- Fixed snapshots are preserved as objects; a future schema change must add explicit normalization and a migration path.
- No automatic rescoring of historical fixed runs exists.
- Legacy tier-efficiency bands (`TIER_BANDS`) remain in the module for simulation context; they are not v2 ranking inputs.
- Old fixed snapshots without `playlistEntryCount`/`playlistAvgVideoSec` use the captured playlist when available; if it is unavailable, the run is unavailable rather than rebased.

### Tests

| Test file | Coverage |
|---|---|
| `frontend/tests/arena.test.ts` | Formula, clamping, unavailable denominators, qualifying-day boundaries, one-minute exploit, tie ranks, percentile, provisional rules, deterministic rivals, cohort stability, fixed snapshots, manual/verified evidence, duplicate occurrences, cross-midnight coverage, performance budget. |
| `frontend/tests/store-integrity.test.tsx` | Fixed-run store lock, explicit end action, rank-history cap. |
| `frontend/tests/responsive-layout.test.tsx` | Library/Player structural overflow regressions; not an Arena browser test. |

### What is not covered by automated tests

- Real-browser layout at 320–1920 px.
- Touch-target measurement on real devices.
- Screen-reader behavior and axe scans.
- Real two-device Arena sync.
- A live global cohort/season (none exists).
- Server certification of a score.

---

## 19. FAQ

**Is Arena a real leaderboard?**  
No. Every opponent is synthetic and generated from a seed. There is no real-person leaderboard.

**Does Arena affect my XP, progress or achievements?**  
No. It reads your records. It does not write learning data.

**Why is my score “calibrating”?**  
You need at least 3 qualifying days and, in a fixed run, 7 observed calendar days. Calibrating rows are not ranked and are not shown as last place.

**Why can’t I see a score?**  
The playlist likely has at least one unresolved video duration, zero entries, or a non-positive total. Arena refuses to substitute an average.

**Why did my rank change when I changed the seed?**  
The seed changes the synthetic rivals. It does not change your progress or qualifying days, but the cohort you are compared against changes.

**Does manual completion count?**  
Yes, as progress, but it is labelled manual/self-reported. It is not verified playback evidence.

**Can I change settings during a fixed run?**  
No. The store refuses changes; you can end the run with confirmation and return to practice.

**Does pausing the simulation freeze my score?**  
No. Pause only removes simulated rivals from the current render. Your records and score inputs continue to reflect your account data.

**Is the percentile my real percentile?**  
No. It is the percentage of **scored synthetic rivals** strictly below you in the current cohort. It is not a population percentile.

**Can I use Arena to prove I understood a course?**  
No. It measures recorded completion/coverage and consistency, not comprehension or retention.

**What happens if I switch playlists during a fixed run?**  
The fixed run stays bound to its captured playlist. If that playlist is unavailable, Arena reports the run as unavailable instead of using another playlist.

**What happens when I reset the simulation?**  
Rank history and Arena settings reset. Your learning records are untouched.

**Is there an official season?**  
No. A fixed run is a private, client-computed snapshot. It is not a global official season.

**Why is the “Intensity” dropdown showing Standard for my custom tier mix?**  
Intensity is derived from exact preset vectors. A custom mix does not match a preset, so the dropdown falls back to Standard while the custom percentages remain in effect.

---

## 20. Implementation status matrix

| Capability | Status |
|---|---|
| Fictional opponent generation | **Implemented and tested** |
| 75/25 v2 score | **Implemented and tested** |
| Qualifying-day rule and anti-exploit floors | **Implemented and tested** |
| Playlist denominator fail-closed on unresolved duration | **Implemented and tested** |
| Duplicate occurrence identity | **Implemented and tested** |
| Manual vs verified evidence labels | **Implemented and tested** |
| Deterministic seed/replay | **Implemented and tested** |
| Competition ranks and ties | **Implemented and tested** |
| Percentile excluding provisional rows | **Implemented and tested** |
| Private fixed run snapshot | **Implemented and tested** |
| Store-level fixed-run lock | **Implemented and tested** |
| Explicit end-fixed action | **Implemented and tested** |
| Frozen playlist binding for fixed runs | **Implemented and tested** |
| Rank snapshots (100 cap) | **Implemented and tested** |
| Responsive Arena visual audit | **Not browser-verified** |
| Real-person leaderboard | **Proposed, not implemented** |
| Global official season | **Proposed, not implemented** |
| Server-side score certification | **Proposed, not implemented** |
| Fixed-run archive/history | **Proposed, not implemented** |
| Automatic season rollover | **Proposed, not implemented** |
| Cross-user matchmaking | **Proposed, not implemented** |
| Browser screenshots | **Not captured** |
| Live Google/Brevo/production verification | **Not performed in this phase** |

---

## 21. Plain-language summary

Arena is a practice game. It asks one main question: **how much of this playlist have you sustainably covered?** Seventy-five percent of the score is how much unique playlist content you have completed or verified; twenty-five percent is how many days you met a minimum activity-and-content rule. It does not reward raw hours, XP, streaks, or tier. It does not know whether you understood the material.

Your opponents are invented from a seed. You can change the practice settings to explore different fictional cohorts. A fixed run freezes those settings and the playlist basis so the run is replayable, but it is still private and computed in your browser, not a global official season.

If the playlist has missing durations, Arena refuses to guess. If you have not met the calibration minimums, it shows “calibrating” instead of pretending you are last. If you manually mark videos complete, that counts as progress but is labelled self-reported. Those are the main rules.
