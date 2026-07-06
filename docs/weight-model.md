# Weight module — data model & spec

The second module. Same platform kernel as macros (two surfaces / one data, two-token auth, error
envelope, pagination, soft-delete, numeric contract). Lives in `src/lib/weight/`, its own tables,
its own API under `/api/weight/`, its own UI under `src/app/(app)/weight/`.

**Core principle (matches the platform ethos):** a single day's weight is **noise** — water, food,
glycogen swing it ±1–2 lb day to day. The **trend** (a rolling average) is the truth. Just as the
macro module is honest about *estimation* fuzziness, this one is honest about *daily* noise: the UI
leads with the smoothed trend, never a single day's number.

Entry comes from **both** surfaces (a weight is one number, no estimation needed): the web (type
today's weight) and the skill (Claude logs "weight 178 this morning"). Both write through the same
`schema.parse → repo` path.

---

## Table: `weight_entry`

Conventions as every table: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt`
(soft-delete; reads exclude deleted). Calendar dates are `date` in string mode (no timezone math).

- `measuredOn` (date, required) — the local calendar date of the weigh-in. **One weight per day:**
  a partial-unique index on `measuredOn WHERE deleted_at IS NULL`, upsert semantics (re-logging a day
  replaces it). A daily tracker records the day's weight; multiple same-day weigh-ins only add noise.
- `weight` (real, required) — body weight in **pounds**, stored as a plain number ("lb" is a display
  concern only, per the numeric contract). Positive.
- `note` (text, nullable) — optional context ("morning, fasted", "post-ride").
- Index on `measuredOn`.

That's the whole stored model. Everything else is **derived**, never stored (so it's always
consistent and reproducible).

---

## Derived stats (computed in `repo`, not stored)

- **7-day trailing average** per day = mean of the entries whose `measuredOn` falls in the trailing
  7 calendar days (gap-tolerant: average whatever days exist). This is the **trend line** and the
  headline number.
- **Current** = the latest entry's raw weight (shown, but secondary to the trend).
- **Trend rate** = (today's 7-day avg − the 7-day avg from 7 days ago), in **lb/week** — the
  meaningful signal (a raw day-over-day delta is noise).
- **Range** over the active window = min / max raw weight.
- **Series** for the chart = per-day raw points + the rolling-average line across a window
  (default last 90 days; selectable).

> Rolling method: simple 7-day trailing mean, chosen for legibility. An EWMA (Hacker's-Diet style,
> gap-robust) is a possible refinement — noted in the backlog, not v1.

---

## Surfaces

- **Web UI** (Clerk-gated): the trend chart (hero), stat cards, a **today's-weight entry** field
  (web entry is allowed here), and a recent-entries list (correct/delete inline via server actions).
- **Token API** (`/api/weight/**`): CRUD on entries + a summary/rollup endpoint that returns the
  derived stats + series. Same envelope/pagination/auth as macros.
- **Skill** (`manage-weight`, or a shared client method): "log my weight, 178 today" → one write.
  Returns the created entry.

## `get`-after-create, soft-delete, PATCH-default

Same as macros: create → 201 + Location + body; soft-delete default (agent barred from hard);
PATCH is the modify verb.

---

## UI contract — component inventory (for the design tool)

Reuses `AppShell`, all tokens, mono/tabular numbers. Nav gains a `weight` entry (LIVE). New pieces:

### `WeightTrend` — the hero (signature element)
A time-series chart over a window (default 90 days):
- **Raw daily points** — small, muted dots (the noise).
- **The rolling-average line** — the accent, the truth. This is what the eye should follow.
- A big **current 7-day-avg** readout in mono, with the **trend rate** ("−0.6 lb/wk", colored by
  direction) and the raw current weight as a smaller secondary number.
- Window selector (e.g. 30 / 90 / 365 / all).
The visual idea: the muted daily scatter vs. the clean accent trend line **is** the "day is noise,
trend is truth" principle. Spend the boldness here (mirrors the DayRollup hero).

### `WeightStat` cards
Small mono stat tiles: current 7-day avg, trend rate (lb/wk), latest raw, range (min–max) over window.

### `WeightEntryForm`
A single number input for **today's weight** (lb) + optional note → save. Prefilled if today already
logged (edits it). This is the web write path (unlike macros).

### `WeightList` / `WeightRow`
Recent days: date + raw weight (mono) + optional note, each correctable/deletable inline (like
EntryRow). Chronological, newest first.

---

## Mock data shape (for the design tool to render against)

A ~90-day series of daily weigh-ins with realistic noise around a gentle downward trend, plus a few
missed days (gaps), so the rolling average and trend read clearly:

```jsonc
{
  "summary": {
    "currentAvg": 178.4,        // latest 7-day trailing average (lb)
    "current": 177.6,           // latest raw entry
    "trendPerWeek": -0.6,       // lb/week (7-day avg vs a week ago)
    "range": { "min": 176.9, "max": 183.2 },
    "window": 90
  },
  "series": [                    // one point per day in the window (gaps allowed)
    { "date": "2026-04-07", "weight": 182.4, "avg": 182.7 },
    { "date": "2026-04-08", "weight": 181.1, "avg": 182.3 },
    { "date": "2026-04-09", "weight": null,  "avg": 182.1 },   // missed day: no raw, avg carries
    // …trending down to ~177–178…
  ],
  "entries": [                   // recent raw entries for the list
    { "id": "…", "measuredOn": "2026-07-05", "weight": 177.6, "note": "morning, fasted" }
  ]
}
```

Numbers render in `--font-mono` tabular. Dark-mode-first. The rolling-average line uses
`--color-accent`; daily dots are `--color-text-muted`; trend rate uses success/over colors by
direction (down = good here, but keep it calm — information, not judgment).
