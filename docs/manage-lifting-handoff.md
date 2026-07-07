# Handoff Brief: `manage-lifting` module (justmy.website)

**Audience:** Claude Code. **Author:** Claude (chat), with Curtis.
**Status:** spec for implementation. Follows the existing justmy platform conventions
(Next.js / Neon Postgres / Drizzle, API-first, Clerk auth, Python skill client over the
token API — same shape as `manage-macros` / `manage-recipes`).

**Related docs (three-agent split):**
- **`manage-lifting-contract.md`** — the shared read-API contract. **This brief's backend OWNS
  and implements it.** The §7 endpoints below must match the contract's response shapes exactly;
  if a shape needs to change, change it in the contract first.
- **`manage-lifting-design-brief.md`** — Claude Design's read-only UI, which *consumes* the
  contract. Design does not invent response shapes; the backend does not invent screens.

---

## 1. Purpose & scope

Import-only mirror of Curtis's Hevy strength-training history so Claude (chat) can
**reason about and discuss training**, not log it. Hevy remains the sole source of truth.

**In scope**
- Curtis uploads a Hevy CSV export periodically (via skill or the web UI).
- Backend parses, dedupes against existing rows, and stores it.
- A skill surfaces **computed views** (progression, session summaries, stall/PR
  detection, muscle-group volume) — not raw set dumps — for Claude to reason over.

**Explicitly out of scope**
- No write path into training (no manual set entry, no editing sets in-platform).
- No delete/edit of individual sets as a feature. Re-import is the only mutation path.
- **Rides/Strava are a separate module** (`manage-rides`), API-sync not CSV, designed later.
  Do not build for cardio/GPS/telemetry here. The `distance_miles` column exists in the
  CSV but is unused by lifting data (0 rows) — ignore it beyond storing it verbatim.

---

## 2. The CSV (mapped against a real export, 2026-07)

Hevy free-tier export. Header row, CRLF line endings, all fields quoted. One row **per set**.
Confirmed columns, in order:

| CSV column | Type in file | Notes |
|---|---|---|
| `title` | string | Session/workout name, e.g. `Session A`. **Drifts** — see §5. |
| `start_time` | string | `"6 Jul 2026, 19:14"` — day-month-year, 24h, local. Session-level (same for every set in a workout). **Primary time key.** |
| `end_time` | string | Same format. Session-level. Duration = end − start. |
| `description` | string | Session description. Usually empty. |
| `exercise_title` | string | e.g. `Bench Press (Dumbbell)`. Equipment is baked into the name in parens. |
| `superset_id` | string | Always empty in Curtis's data. Store, don't rely on it. |
| `exercise_notes` | string | Per-exercise note. Usually empty. |
| `set_index` | int | 0-based, resets per exercise within a workout. Part of the dedupe key. |
| `set_type` | string | Only ever `normal` in this data (Curtis doesn't log warmups). Handle `warmup`/`failure`/`drop`/`dropset` defensively anyway — see §6. |
| `weight_lbs` | number-or-empty | Already in **pounds** (`_lbs`). Empty for bodyweight/timed sets. |
| `reps` | int-or-empty | Empty for timed sets. |
| `distance_miles` | number-or-empty | Unused by lifting (0 rows). Store verbatim, ignore in metrics. |
| `duration_seconds` | int-or-empty | Set for timed holds (e.g. Side Plank). |
| `rpe` | number-or-empty | Always empty in Curtis's data. Store if present. |

**Three set shapes appear** (confirmed by profiling all 177 rows):
- **weighted**: `weight_lbs` + `reps` (compound/accessory lifts) — 102 rows
- **bodyweight-reps**: `reps` only (Dead Bug, Bird Dog, Glute Bridge) — 65 rows
- **timed**: `duration_seconds` only (Side Plank) — 10 rows

Classify each set into a `kind` enum on ingest: `weighted | bodyweight | timed`.
(`distance` reserved for future but never produced by lifting exports.)

### Date parsing
`start_time` / `end_time` are `"%-d %b %Y, %H:%M"` (e.g. `6 Jul 2026, 19:14`). No seconds,
no timezone — treat as **America/Chicago** local (Curtis is Pflugerville, TX) and store as
`timestamptz`. Minute resolution is fine; two workouts never start the same minute.

---

## 3. Data model (three tables — do NOT flatten)

Session → Exercise instance → Set. Flattening into one wide table makes the core
"how's my Hip Thrust trending" query painful; that query is the whole point.

```
workout
  id              uuid pk
  user_id         text            -- Clerk id; every table carries it, RLS as elsewhere
  title           text            -- as-imported ("Session A - Updated")
  title_norm      text            -- normalized (§5), for grouping A/B/C across renames
  description     text null
  started_at      timestamptz     -- from start_time
  ended_at        timestamptz null
  duration_s      int null        -- convenience: ended_at - started_at
  natural_key     text unique     -- see §4; dedupe anchor at session level
  created_at      timestamptz default now()

exercise_instance
  id              uuid pk
  user_id         text
  workout_id      uuid fk -> workout(id) on delete cascade
  exercise_title  text            -- as-imported, "Bench Press (Dumbbell)"
  exercise_norm   text            -- normalized name (§5) for cross-session grouping
  equipment       text null       -- parsed from parens: "Dumbbell", "Cable", "Machine", null
  notes           text null
  position        int             -- order within workout (first-seen order of set rows)
  unique (workout_id, exercise_title)

lift_set
  id              uuid pk
  user_id         text
  exercise_instance_id uuid fk -> exercise_instance(id) on delete cascade
  set_index       int
  kind            text            -- 'weighted' | 'bodyweight' | 'timed'
  set_type        text            -- 'normal' | 'warmup' | 'failure' | 'drop' ...
  weight_lbs      numeric null
  reps            int null
  duration_s      int null
  distance_miles  numeric null    -- stored verbatim, unused
  rpe             numeric null
  natural_key     text unique     -- see §4
  volume_lbs      numeric null    -- generated/derived: weight_lbs * reps when kind='weighted', else null
```

Index `exercise_instance(user_id, exercise_norm)` and `lift_set(exercise_instance_id)` —
those carry the progression queries.

---

## 4. Dedupe (the critical part)

Hevy exports the **entire history every time**, not a delta. Every upload is ~mostly rows
you already have. Dedupe must be an **idempotent upsert**, and must let an *edited* set in
Hevy update the stored row rather than insert a duplicate.

**Set-level natural key** (the unique constraint that makes re-import safe):
```
sha256( started_at_iso + "|" + exercise_title + "|" + set_index )
```
Note what's **in** the key: session start time, exercise, set index — the identity of the
set. Note what's **out**: `weight_lbs`, `reps`, `duration_s`, `set_type`. Those are the
*mutable payload*. So `ON CONFLICT (natural_key) DO UPDATE` the payload columns → if Curtis
fixes a weight in Hevy and re-exports, the re-import corrects the stored row instead of
duplicating it. **Do not** put weight/reps in the key (would turn every correction into a
dup) and **do not** dedupe on the whole row.

**Session natural key:** `sha256(started_at_iso + "|" + title_norm)`. Upsert workout and
exercise_instance the same way so re-import is fully idempotent at every tier.

Ingest is one transaction per upload: parse → group rows into workouts/exercises/sets →
upsert all three tiers → report counts (`inserted`, `updated`, `unchanged`). Return that
summary to the caller so Curtis/Claude see "12 new sets, 0 changed" after an upload.

---

## 5. Name normalization (title & exercise drift)

Real data already shows drift: `Session A` became `Session A - Updated` on 2026-07-06.
Session titles will keep mutating as Curtis edits his routines. Exercise names are stabler
but casing/spacing can wobble.

- `title_norm`: lowercase, trim, collapse whitespace, **strip trailing ` - updated` / `(updated)`
  and similar edit suffixes**, so all "Session A" variants group together for cadence/frequency
  analysis. Keep raw `title` for display. Don't over-engineer — a small suffix-strip + a
  manual alias map is enough; flag to Curtis if a new session name appears that doesn't map.
- `exercise_norm`: lowercase, trim, collapse whitespace. Parse trailing `(Equipment)` into the
  `equipment` column but **keep it in the normalized name too** — "Bench Press (Dumbbell)" and a
  future "Bench Press (Barbell)" are different exercises for progression and must not merge.

---

## 6. Set-type filtering rule (decide once, in the backend)

Curtis's current export is all `normal`, but the module must define the rule so Claude never
guesses which sets counted:

- **"Top set" / e1RM / PR logic:** consider `set_type IN ('normal','failure')` only. Exclude
  `warmup` and `drop`/`dropset`.
- **Total volume:** include `normal` and `failure` and `drop`; exclude `warmup`.
- Anything unrecognized → treat as `normal` and surface a one-line warning in the ingest summary.

Implement as a single predicate helper used by every metric, not re-decided per query.

---

## 7. Derived metrics (what the skill returns — the actual product)

CSV already works for raw reasoning; the backend earns its place by returning **answers, not
data**. Each endpoint is a question Curtis actually asks. Raw set access is an escape hatch,
not the main path.

### e1RM (estimated 1-rep max) — Curtis doesn't need to know the formula; own it.
Use **Epley**: `e1RM = weight * (1 + reps/30)`. But it's only meaningful on **heavy, low-rep,
`kind='weighted'`** work. Curtis trains back-aware, higher-rep — do not grind AMRAP singles.

Rule the backend applies:
- Compute e1RM only for `kind='weighted'` sets with `reps <= 12`. Above 12 reps, e1RM error
  balloons; report `null` e1RM and fall back to **top-set weight×reps** as the progression signal.
- For **bodyweight** exercises, the progression signal is **reps at bodyweight** (and total reps).
- For **timed** exercises (Side Plank), the signal is **duration held** (max and total).
- Never present e1RM as precise — it's a trend proxy. One-decimal, and always alongside the
  actual top set it came from.

### Endpoints (skill commands), in priority order

**These back both the skill and the read UI. Their HTTP response shapes are fixed by
`manage-lifting-contract.md` — implement to that contract exactly.** The skill commands below
are the CLI face of the same endpoints.
1. **`exercise-history <exercise>`** — the core one. Per-session time series for one exercise:
   date, top set (weight×reps *or* reps *or* duration by kind), e1RM (if applicable), session
   volume. This is Curtis's six-week audit, on demand, for any lift.
2. **`stalls`** — backend-computed status per exercise: best-ever signal, best in last 30d,
   sessions since last PR, trend flag `progressing | flat | regressing` over last N sessions.
   Directly serves the thing Curtis actually does with the data (found the lower-body plateau
   / equipment ceiling this way). First-class, not derived on the fly.
3. **`recent-workouts [n]`** — session-level rollups: date, title (raw + norm), total volume,
   set count, duration, exercise list. No set detail. Lets Claude see cadence / whether A/B/C
   are being hit ~3×/week without ingesting every set.
4. **`muscle-volume [--weeks N]`** — weekly volume bucketed by movement pattern / muscle group.
   Surfaces the upper-vs-lower imbalance automatically. **Requires an exercise→muscle map**
   (Hevy's per-exercise muscle tag is NOT in the free CSV export — see §8 open question).
   **Unmapped-exercise handling (required):** every other endpoint is zero-touch when Curtis
   adds a lift, but this one depends on the static map, so a new lift must be *loud, not silent*.
   Ingest flags any `exercise_norm` not present in the map (one line in the ingest summary:
   `unmapped exercises: <names>`). `muscle-volume` must report unmapped lifts in an explicit
   **`unmapped` bucket** with their volume — never silently drop them, which would understate a
   real muscle group with no signal to Curtis. Resolution is a one-line addition to the map; until
   then the volume is visible, just parked. Do **not** guess a muscle from the exercise name.
5. **`raw <exercise|workout>`** *(escape hatch)* — set-level rows when a computed view isn't enough.
   If Claude reaches for this routinely, the module is missing an endpoint — treat that as a signal.

Every metric respects §6 filtering. `e1RM` fields are `null`, not fabricated, when not applicable.

---

## 8. Settled decisions (were open; now locked)

1. **Muscle-group map for `muscle-volume`** — ship a static `exercise_norm → {primary_muscle,
   movement_pattern}` map in the repo (not the DB), seeded with Curtis's current 18 exercises below.
   New/unmapped exercises are handled by the unmapped-bucket + ingest-flag behavior in §7 endpoint 4
   (loud on import, parked in `unmapped`, resolved by adding one map line). **Six buckets.** Legs are
   deliberately **one glutes/hips bucket, not split into quads** — the program is posterior-chain /
   back-aware, so the coarse "is lower-body volume keeping up" read is the point; per-exercise trend
   covers finer views. Split later (one line) only if quad-specific work grows enough to warrant it.

   | Bucket | Exercises (`exercise_norm`) |
   |---|---|
   | `glutes/hips` | Hip Thrust, Glute Bridge, Deadlift (Dumbbell), Reverse Lunge (Dumbbell), Lateral Lunge, Single Leg Press (Machine) |
   | `back` | Lat Pulldown (Cable), Dumbbell Row, Seated Cable Row - Bar Grip |
   | `chest` | Bench Press (Dumbbell), Floor Press (Dumbbell) |
   | `shoulders` | Shoulder Press (Dumbbell) |
   | `arms` | Bicep Curl (Dumbbell), Triceps Pushdown |
   | `core` | Dead Bug, Bird Dog, Side Plank, Cable Core Pallof Press |

   `muscle_group` in the `/exercises` and `/muscle-volume` responses is the bucket key; the
   `unmapped` bucket key is literal `"unmapped"` and always renders last.

2. **`stalls` trend window `N` = 5 sessions**, session-based (not calendar-based). Session-based
   because per-exercise training frequency is what defines a plateau; a week-based window would
   false-flag a stall after a missed week. 5 sessions (~5 weeks at ~1×/wk/exercise) is long enough
   to separate a real plateau from session-to-session noise. Surfaced in the response as
   `trend_window_sessions: 5`.

3. **PR definitions by kind:**
   - **weighted** → PR = new best `e1rm`; where e1RM is null (reps > 12), PR = new best top-set weight.
   - **bodyweight** → PR = most reps in a single working set (not most total reps in a session —
     that rewards volume, not strength progression).
   - **timed** → PR = longest single hold (`duration_s`).
   `is_pr` on an `exercise-history` point is true when that session set a new best by the above rule.

---

## 9. Build split (CC/CD handoff, per platform convention)

- **CD (this brief → data + API):** migration for the three tables + indexes; the ingest
  transaction (parse → normalize → classify kind → upsert with the §4 keys → counts summary);
  the derived-metric queries in §7 behind the token API; the CSV upload path on the web UI.
  **The read endpoints and the import endpoint must match `manage-lifting-contract.md` exactly** —
  that contract is what Claude Design's UI consumes, so it is a hard interface, not a suggestion.
  Serve the read endpoints as normal authed JSON routes (Clerk session) for the UI *and* via the
  token API for the skill; same query layer behind both.
- **CC (skill client):** `manage-lifting` Python skill, stdlib-only, token embedded, mirroring
  the `manage-recipes` shape — commands = the §7 endpoints plus an `import <csv>` that POSTs a
  file and relays the insert/update/unchanged counts. Read-after-write isn't relevant (no
  macro-style single writes) but the import command **must echo the ingest summary** so Curtis
  sees what landed.
- Skill description must state it needs code execution with egress to `justmy.website`.

## 10. Acceptance checks
- Re-importing the **same** CSV twice → second import reports `0 inserted, 0 updated`.
- Editing one set's weight in Hevy and re-exporting → `0 inserted, 1 updated`, no dup.
- `Session A` and `Session A - Updated` group under one `title_norm`.
- Side Plank rows store as `kind='timed'` with `duration_s`, null weight/reps, and never get an e1RM.
- `exercise-history "Hip Thrust"` returns one row per session Curtis did it, chronologically.
- Importing a CSV containing a brand-new exercise → it appears in `exercise-history` / `stalls` /
  `recent-workouts` with no code change, **and** the import summary flags it as unmapped, **and**
  `muscle-volume` shows its volume in the `unmapped` bucket (not dropped) until the map is updated.
