# Lifting module — data model & spec

The fourth module. Same platform kernel as the others (two surfaces / one data, two-token auth,
error envelope, pagination, soft-delete, numeric contract). Lives in `src/lib/lifting/`, its own
tables, its own read API under `/api/lifting/`, its own UI under `src/app/(app)/lifting/`.

**This doc is the approved code spec.** The substance lives in three companion briefs — read them
first; this doc does not restate them, it **reconciles** them against the actual codebase and adds
the code-level surface (Zod, repo, routes, build checklist) they don't carry:

- **`docs/manage-lifting-handoff.md`** — the code brief (data model, ingest, derived metrics). This
  model doc **supersedes it** wherever they differ (see the reconciliation ledger below).
- **`docs/manage-lifting-contract.md`** — the read-API response shapes. The backend **owns and
  implements** it; Claude Design consumes it. If a shape changes, it changes there first.
- **`docs/manage-lifting-design-brief.md`** — Claude Design's read-only UI. Context only; I serve
  exactly the contract shapes its screens consume, and invent no screens.

**Core principle (the signature):** *Hevy is the source of truth; this is the reasoning mirror.*
The module imports Curtis's Hevy strength history and returns **answers, not set dumps** — trend,
stalls, cadence, muscle-volume. The deep reasoning surface is Claude-in-chat via the read-only
skill; the web UI is the glanceable, phone-first window plus the one import mechanism.

**How it differs from the three existing modules:**
- **First import-only module.** No entry-style writes at all. The *only* write is a bulk CSV
  upload; everything else is read/derived. There is no `log`/`correct`/`add` anything.
- **First multi-screen module** (a scrolling dashboard + one drill-in). Per the design brief this
  must **not** introduce an app-shell / global-nav pattern — that's a deliberate platform decision,
  not a byproduct of this module.
- **First non-JSON write.** The import is a CSV file, handled by a web **server action**, not a
  token-API route (see ledger item 2).

---

## Reconciliation ledger — deltas from the briefs (the reason this doc exists)

1. **No `user_id`, no RLS.** The handoff §3 gives every table `user_id text -- Clerk id … RLS as
   elsewhere`. That pattern **does not exist in this codebase** — every existing table uses only the
   shared `auditColumns()` (id, createdAt, updatedAt, deletedAt); this is a single-user platform
   (one human, one agent). **Drop `user_id` from all three tables.** Soft-delete still comes free via
   the shared audit columns.

2. **Import is web-only; the skill is read-only.** Per Curtis: the CSV is a one-off manual download
   from Hevy, so the upload happens where he already is — the website. Consequences:
   - The **token API has no write route.** Import is a Next.js **server action** in the web UI
     (`FormData` File → `ingestCsv` → repo). This sidesteps multipart-on-the-token-API entirely.
   - The **skill has no `import` command** (drops handoff §9 CC's import bullet). The skill is
     **read-only** — it surfaces the computed views for Claude to reason over.
   - The contract's `POST /api/lifting/import` is **re-cast as the server action's contract**: same
     response summary shape, delivered to the import screen by the action, not a token route. The
     summary shape stays authoritative in `manage-lifting-contract.md`.

3. **Source-side deletions: don't prune (v1).** Hevy re-exports full history; ingest **inserts and
   updates only**. A workout/set deleted in Hevy stays in our DB (it simply stops appearing in new
   files). Chosen over reconcile-on-absence because a partial/filtered export must never silently
   soft-delete real history. Deletions in Hevy are rare. **Deferred:** a scoped reconcile (soft-delete
   sets absent from a workout that *is* present in the file) — see Open / deferred.

4. **Muscle-bucket slugs standardized.** The contract examples used `"glutes"`; the handoff §8 table
   used `"glutes/hips"`. Canonical is **six slug keys** — `glutes`, `back`, `chest`, `shoulders`,
   `arms`, `core` — plus the literal `unmapped` (always rendered last). `muscle_group` in the
   `/exercises` and `/muscle-volume` responses carries the slug; display names ("Glutes / Hips") are
   a UI concern. The contract will be updated to use these slugs.

---

## Tables (three — do NOT flatten)

Session → exercise instance → set. Flattening makes the core "how's my Hip Thrust trending" query
painful, and that query is the whole point (handoff §3). Every table gets the shared `auditColumns()`
(id, createdAt, updatedAt, deletedAt); calendar-only fields would be `date` string-mode, but every
timestamp here is an instant (`timestamptz`) since Hevy gives real clock times.

### `lifting_workout`
- `title` (text) — as-imported ("Session A - Updated").
- `titleNorm` (text) — normalized for grouping A/B/C across renames (§5 of handoff: lowercase, trim,
  collapse whitespace, strip trailing ` - updated`/`(updated)`).
- `description` (text, null).
- `startedAt` (timestamptz) — from `start_time`, parsed as America/Chicago. **Primary time key.**
- `endedAt` (timestamptz, null); `durationS` (int, null) — convenience `endedAt − startedAt`.
- `naturalKey` (text, unique) — `sha256(startedAtIso + "|" + titleNorm)`; the session dedupe anchor.

### `lifting_exercise_instance`
- `workoutId` (uuid, fk → `lifting_workout` on delete cascade).
- `exerciseTitle` (text) — as-imported ("Bench Press (Dumbbell)").
- `exerciseNorm` (text) — normalized for cross-session grouping; **equipment stays in the name**
  ("Bench Press (Dumbbell)" ≠ a future "(Barbell)").
- `equipment` (text, null) — parsed from trailing parens.
- `notes` (text, null); `position` (int) — first-seen order within the workout.
- Unique `(workoutId, exerciseTitle)`.

### `lifting_set`
- `exerciseInstanceId` (uuid, fk → `lifting_exercise_instance` on delete cascade).
- `setIndex` (int) — 0-based, resets per exercise.
- `kind` (text) — `weighted | bodyweight | timed`, classified on ingest.
- `setType` (text) — `normal | warmup | failure | drop | …`; unrecognized → `normal` + a warning.
- `weightLbs` (real, null); `reps` (int, null); `durationS` (int, null).
- `distanceMiles` (real, null) — stored verbatim, unused by lifting metrics (handoff §1).
- `rpe` (real, null) — stored if present.
- `volumeLbs` (real, null) — derived: `weightLbs × reps` when `kind='weighted'`, else null.
- `naturalKey` (text, unique) — `sha256(startedAtIso + "|" + exerciseTitle + "|" + setIndex)`. Note
  what's **out** of the key: weight, reps, duration, setType — the mutable payload. So
  `ON CONFLICT (naturalKey) DO UPDATE` the payload → a corrected-in-Hevy set updates in place instead
  of duplicating (handoff §4).

**Indexes:** `lifting_exercise_instance(exerciseNorm)` and `lifting_set(exerciseInstanceId)` carry
the progression queries; `lifting_workout(startedAt)` for recency.

### `lifting_import` — the upload log (so "how long since I uploaded?" is answerable)
Every upload writes **one row here, even a no-op re-import**, because a re-import of the same CSV
changes no data row — so `max(createdAt)` on the data tables can't tell us when Curtis last uploaded.
This event log can. Its shared `createdAt` **is** the import timestamp (each row is insert-only,
never updated).
- `inserted` / `updated` / `unchanged` / `workoutsSeen` (int) — the summary that upload reported.
- `unmappedExercises` (jsonb / text[], default `[]`) — so status can still say "last upload left
  new lifts uncategorized" without re-reading the file.
- No natural key / no upsert — it's an append-only audit of upload *events*. Latest by `createdAt`.

---

## Derived model (computed in repo, never stored)

Every metric respects the **set-type predicate** (one helper, decided once — handoff §6): top-set /
e1RM / PR consider `setType IN ('normal','failure')`; volume includes `normal|failure|drop`, excludes
`warmup`. `e1RM` is a **number or `null`** — never fabricated.

- **e1RM (Epley):** `weight × (1 + reps/30)`, computed **only** for `kind='weighted'`, `reps ≤ 12`.
  Above 12 reps → `null` e1RM, fall back to top-set weight×reps as the signal. One decimal, always
  alongside the top set it came from.
- **Per-kind progression signal** (the chart Y-axis): weighted → e1RM else top weight; bodyweight →
  top reps in a working set; timed → longest hold (`durationS`). The off-kind signal fields are null.
- **PR by kind** (handoff §8.3): weighted → new best e1RM (or best top-set weight where e1RM null);
  bodyweight → most reps in a single working set; timed → longest single hold.
- **Stalls:** trend flag `progressing | flat | regressing` over the **last N=5 sessions**
  (session-based, not calendar — §8.2), plus best-ever signal, best-in-last-30d, sessions-since-PR.
- **Muscle-volume:** weekly `sum(volumeLbs)` bucketed by the static muscle map; unmapped exercises
  go in an explicit `unmapped` bucket (never dropped — §7.4).

### Static muscle map (`src/lib/lifting/muscle-map.ts`, not the DB — handoff §8.1)
Six buckets, seeded with Curtis's current 18 exercises (legs deliberately one `glutes` bucket, not
split — posterior-chain program). A new lift not in the map is **loud, not silent**: flagged in the
import summary's `unmapped_exercises`, and its volume parked in the `unmapped` bucket until one map
line is added. Never guess a muscle from the name.

| slug | exercises (`exerciseNorm`) |
|---|---|
| `glutes` | Hip Thrust, Glute Bridge, Deadlift (Dumbbell), Reverse Lunge (Dumbbell), Lateral Lunge, Single Leg Press (Machine) |
| `back` | Lat Pulldown (Cable), Dumbbell Row, Seated Cable Row - Bar Grip |
| `chest` | Bench Press (Dumbbell), Floor Press (Dumbbell) |
| `shoulders` | Shoulder Press (Dumbbell) |
| `arms` | Bicep Curl (Dumbbell), Triceps Pushdown |
| `core` | Dead Bug, Bird Dog, Side Plank, Cable Core Pallof Press |

---

## Ingest (the one write — a web server action)

`src/app/(app)/lifting/actions.ts` → `importHevyCsv(formData)`: read the `File`, `await file.text()`,
hand the raw CSV to `ingestCsv(text)` in the repo. One transaction per upload:
parse rows → group into workouts/exercises/sets → classify `kind` → **upsert all three tiers** with
the §4 natural keys → return the summary. `neon-http` has no interactive transactions, but each tier
is a single multi-row `INSERT … ON CONFLICT DO UPDATE`, which is atomic per statement; ingest is
insert/update-only (no cross-statement invariant to protect), so the driver limitation doesn't bite.

CSV specifics (handoff §2): CRLF, all fields quoted, one row per set; `start_time`/`end_time` are
`"%-d %b %Y, %H:%M"` (e.g. `6 Jul 2026, 19:14`), no tz → America/Chicago. Three set shapes:
weighted (`weight_lbs`+`reps`), bodyweight (`reps` only), timed (`duration_seconds` only).

The summary shape is the contract's import response, returned to the import screen by the action:
`{ inserted, updated, unchanged, workouts_seen, unmapped_exercises, warnings }`. The action also
**appends a `lifting_import` row** with the same counts, so the timestamp is queryable afterward.

### Last-import status (skill + API + UI)
`GET /api/lifting/last-import` → the latest `lifting_import` event, so Curtis/Claude can tell **how
long it's been since the last upload** (freshness, not just what changed):
```jsonc
{ "imported_at": "2026-07-06T19:58:00-05:00",
  "inserted": 12, "updated": 1, "unchanged": 480, "workouts_seen": 10,
  "unmapped_exercises": [] }
```
Before the first upload it returns `{ "imported_at": null }` (the object, not a 404 — contract empty
-state rule). The skill exposes `last_import()`; the UI shows a "Last import: 3 days ago" line on the
dashboard/import screen. **Contract addition** — I own it, so it lands in `manage-lifting-contract.md`.

---

## Surfaces & route layout

- **Web UI** (`src/app/(app)/lifting/`, Clerk-gated): the read dashboard (recent workouts / stalls /
  muscle-volume sections + exercise-trend drill-in) **and** the import screen (the server action).
  Server components read via repo; the import action writes via `ingestCsv`. **The UI never calls the
  token API** (convention).
- **Token API** (`/api/lifting/**`): **read-only**, for the skill. `requireBearer` (either token) on
  every route; no write route, so no `requirePrimary`/DELETE path exists.
- **Skill** (`manage-lifting`, Python stdlib over the token API): **read-only** commands mirroring the
  read endpoints. No import command.

| Method & path | Repo fn | Contract §  |
|---|---|---|
| `GET /api/lifting/exercises` | `listExercises()` | Read: exercises |
| `GET /api/lifting/exercise-history?exercise=` | `getExerciseHistory(norm)` | Read: exercise-history |
| `GET /api/lifting/stalls` | `getStalls()` | Read: stalls |
| `GET /api/lifting/recent-workouts?limit=` | `getRecentWorkouts(limit)` | Read: recent-workouts |
| `GET /api/lifting/muscle-volume?weeks=` | `getMuscleVolume(weeks)` | Read: muscle-volume |
| `GET /api/lifting/last-import` | `getLastImport()` | Read: last-import *(new)* |
| *(web only)* `importHevyCsv(formData)` server action | `ingestCsv(text)` | Import |

The `raw` escape hatch (handoff §7.5) is **deferred** — the five computed endpoints are the product;
`raw` gets defined in the contract only if Claude reaches for it routinely (which is itself a signal
a computed view is missing).

---

## Zod schema surface (`src/lib/lifting/schema.ts` — single source of truth)

- **CSV-row schema** — parse/coerce one raw Hevy record (string cells → typed), the `kind` classifier,
  and name normalization (`titleNorm`, `exerciseNorm`, equipment parse). Ingest's parse gate.
- **Natural-key builders** — the two `sha256` helpers, so the key definition lives in one place.
- **Response/view schemas** — `ExerciseView`, `HistoryPoint` (per-kind), `StallRow`, `WorkoutRollup`,
  `MuscleWeek`, `ImportSummary`, `LastImport` — mirroring the contract exactly. These feed the
  OpenAPI fragment via `z.toJSONSchema` (`target: "openapi-3.0"`), the same as the other modules.

## Repo surface (`src/lib/lifting/repo.ts` — the only place tables are touched)

`ingestCsv(text) → ImportSummary` (also appends a `lifting_import` row) · `getLastImport() →
LastImport | null` · `listExercises()` · `getExerciseHistory(exerciseNorm)` · `getStalls()` ·
`getRecentWorkouts(limit)` · `getMuscleVolume(weeks)`. Reads exclude soft-deleted
rows. The set-type predicate and e1RM/PR/trend helpers are pure functions in this module, used by
every query (not re-decided per call).

## UI inventory & mock data

Deferred to `docs/manage-lifting-design-brief.md` (screens) and `docs/manage-lifting-contract.md`
(response shapes / mock data). Charts match the weight-tracker's SVG line-chart visual language (a
sibling, not forced reuse); a grouped/stacked bar chart for muscle-volume in the same language.

---

## Open / deferred

- **Scoped reconcile for Hevy deletions** — v1 doesn't prune (ledger 3). A future import could
  soft-delete sets absent from a workout that *is* present in the file (never touching absent
  workouts), so edits/deletions in Hevy propagate without a partial export nuking history.
- **`raw` escape-hatch endpoint** — set-level rows; define in the contract only if the computed views
  prove insufficient.
- **Bodyweight/timed work contributes no lbs-volume.** Muscle-volume is `sum(weightLbs × reps)`, so a
  bucket that's mostly bodyweight/timed (notably `core` — Side Plank, Dead Bug) under-reads on the
  volume chart. That's inherent to an lbs-volume metric; per-exercise trend covers those lifts. Noted
  so it's not mistaken for a bug.
- **Muscle-map growth / quad split** — one map line per new lift; split `glutes` later only if
  quad-specific work grows (handoff §8.1).
- **Rides/Strava** — separate `manage-rides` module, API-sync not CSV (handoff §1). Not here.

---

## Build checklist (CONVENTIONS §8, made concrete)

- [ ] `src/lib/lifting/schema.ts` (CSV-row + view schemas + normalization + natural-key builders)
- [ ] `lifting_workout` / `lifting_exercise_instance` / `lifting_set` / `lifting_import` in
      `src/lib/db/schema.ts` + a Drizzle **migration**
- [ ] `src/lib/lifting/muscle-map.ts` (static six-bucket map)
- [ ] `src/lib/lifting/repo.ts` (ingest transaction + the five read queries; excludes soft-deleted)
- [ ] `src/lib/lifting/types.ts` (domain + response-contract types, shared by repo AND UI)
- [ ] Read routes under `src/app/api/lifting/**` (thin: `requireBearer` → repo)
- [ ] Web UI under `src/app/(app)/lifting/**` + `src/components/lifting/**`, incl. the import server
      action; dashboard reads via repo. **UI never calls the API.**
- [ ] Nav chip (`AppShell.tsx`) + landing card (`Landing.tsx`) flipped `SOON` → LIVE
- [ ] **OpenAPI:** import the Zod schemas in `scripts/build-openapi.ts`, build `liftingSpec`, add
      `["lifting", liftingSpec]` to `fragments`, run `npm run openapi:build`, confirm
      `openapi/lifting.json` appears
- [ ] **Docs:** this model doc committed, contract updated to the standardized slugs + server-action
      import framing, README module list + `docs/ARCHITECTURE.md` live-modules table +
      `docs/BACKLOG.md` updated
- [ ] Acceptance checks (handoff §10): re-import same CSV → `0 inserted, 0 updated`; edit one set's
      weight + re-export → `0 inserted, 1 updated`, no dup; `Session A`/`Session A - Updated` group
      under one `titleNorm`; Side Plank stores `kind='timed'`, never gets an e1RM; a brand-new
      exercise appears in history/stalls/recent-workouts with no code change **and** is flagged
      `unmapped` + parked in the `unmapped` muscle bucket; **a no-op re-import still advances
      `last-import`'s `imported_at`** (the whole reason `lifting_import` exists)
- [ ] **Skill** (`manage-lifting`, read-only) — can land after web + API, per the runbook
