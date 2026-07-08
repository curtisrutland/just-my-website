# Shared Contract: `manage-lifting` read API

**This document is the seam between three agents.** It defines the read-endpoint
response shapes for the `manage-lifting` module. It is referenced by name by both:

- **`manage-lifting-handoff.md`** (the code brief) — the backend **implements** these shapes.
- **`manage-lifting-design-brief.md`** (Claude Design) — the read UI **consumes** these shapes.

Rules of the seam:
- The **code agent owns this contract** (backend is source of truth). If a shape must change,
  it changes here first, and the design brief follows.
- **Design does not invent response shapes.** If a screen needs a field not present here, that's
  a contract change requested of the code agent — not a field Design fabricates.
- **Code does not invent screens.** The backend exposes exactly these; layout is Design's.
- The **token API is entirely read-only.** The one write in the module — CSV import — is a **web
  server action** (the web UI never calls the token API), not a token endpoint. Its response summary
  is specified below because the import *screen* consumes it.
- Units: weight in **lbs**, volume in **lbs** (weight×reps summed), duration in **seconds**,
  dates as **ISO 8601** with offset (America/Chicago). e1RM is a **number or `null`** — never
  fabricated; `null` means "not applicable to this set kind / rep range" (see code brief §7).

---

## Import (the one write) — a **web server action**, not a token endpoint

Import is a web server action (`importHevyCsv(formData)`): the import screen submits one Hevy CSV
`File`, the action parses + upserts, and **returns this summary to the screen**. The skill does not
import (it's read-only); only the web UI echoes this.

**Return shape:**
```jsonc
{
  "inserted": 12,        // new sets
  "updated": 1,          // existing sets whose payload changed (edited in Hevy, re-exported)
  "unchanged": 480,      // sets already stored identically
  "workouts_seen": 10,   // distinct sessions in this file
  "unmapped_exercises": ["Barbell Squat"],  // exercise_norms not in the muscle map; [] if none
  "warnings": []         // e.g. unrecognized set_type coerced to normal
}
```
The import screen echoes this summary verbatim after an import. `unmapped_exercises` being non-empty
is a **visible prompt** that a new lift needs a map line — surface it, don't bury it.

## `GET /api/lifting/last-import`
The most recent upload event, so the UI and skill can show **how long since the last CSV upload**
(freshness, not just what changed). Backed by an append-only import log — a no-op re-import still
records a fresh event, so this timestamp always reflects the true last upload.
```jsonc
{ "imported_at": "2026-07-06T19:58:00-05:00",
  "inserted": 12, "updated": 1, "unchanged": 480, "workouts_seen": 10,
  "unmapped_exercises": [] }
```
Before the first upload: `{ "imported_at": null }` (the object, not a 404 — per empty-state rule).

---

## Read endpoints

### `GET /api/lifting/exercises`
List of exercises that have any history, for pickers/nav.
```jsonc
{
  "exercises": [
    { "exercise_norm": "hip thrust", "display": "Hip Thrust",
      "kind": "weighted", "equipment": null, "session_count": 4,
      "muscle_group": "glutes", "mapped": true },
    { "exercise_norm": "side plank", "display": "Side Plank",
      "kind": "timed", "equipment": null, "session_count": 5,
      "muscle_group": null, "mapped": false }
  ]
}
```
`kind ∈ {weighted, bodyweight, timed}`. `mapped=false` ⇒ not in muscle map (unmapped bucket).

### `GET /api/lifting/exercise-history?exercise=<norm>`
Per-session series for one exercise, chronological. **The chart source** for exercise trend.
```jsonc
{
  "exercise_norm": "hip thrust",
  "display": "Hip Thrust",
  "kind": "weighted",
  "points": [
    { "date": "2026-05-26T19:28:00-05:00",
      "top_weight_lbs": 135, "top_reps": 10,   // by kind: weighted → weight+reps
      "e1rm": 180.0,                            // number or null
      "session_volume_lbs": 2700,
      "is_pr": false },
    { "date": "2026-06-16T19:45:00-05:00",
      "top_weight_lbs": 145, "top_reps": 10,
      "e1rm": 193.3, "session_volume_lbs": 2900, "is_pr": true }
  ]
}
```
Per-kind meaning of a point's "signal" (what the chart Y-axis plots):
- **weighted** → `e1rm` if present, else `top_weight_lbs`. `top_reps` shown as context.
- **bodyweight** → `top_reps` (max reps in a working set that session). `e1rm`/`top_weight_lbs` null.
- **timed** → `top_duration_s` (longest hold). Other signal fields null.
  ```jsonc
  { "date": "...", "top_duration_s": 45, "session_volume_lbs": null, "is_pr": true }
  ```

### `GET /api/lifting/stalls`
Per-exercise status. **The stalls panel.** Backend-computed, not derived client-side.
```jsonc
{
  "as_of": "2026-07-06T19:58:00-05:00",
  "trend_window_sessions": 5,   // N used for the flag (code brief §8: 5, session-based)
  "exercises": [
    { "exercise_norm": "hip thrust", "display": "Hip Thrust", "kind": "weighted",
      "best_signal": 193.3, "best_signal_label": "e1RM",
      "best_last_30d": 193.3,
      "sessions_since_pr": 0,
      "trend": "progressing" },              // progressing | flat | regressing
    { "exercise_norm": "single leg press (machine)", "display": "Single Leg Press (Machine)",
      "kind": "weighted", "best_signal": 210.0, "best_signal_label": "e1RM",
      "best_last_30d": 190.0, "sessions_since_pr": 3, "trend": "flat" }
  ]
}
```
`best_signal_label ∈ {e1RM, top weight, reps, hold}` so the UI labels the number correctly by kind.

### `GET /api/lifting/recent-workouts?limit=<n>`
Session rollups, most recent first. **The recent-workouts list.**
```jsonc
{
  "workouts": [
    { "id": "…", "title": "Session A - Updated", "title_norm": "session a",
      "started_at": "2026-07-06T19:14:00-05:00", "duration_s": 2640,
      "total_volume_lbs": 8450, "set_count": 22,
      "exercises": ["Dead Bug", "Side Plank", "Bench Press (Dumbbell)", "..."] }
  ]
}
```

### `GET /api/lifting/muscle-volume?weeks=<n>`
Weekly volume bucketed by muscle group. **The muscle-volume bar chart.** Includes the
`unmapped` bucket so new lifts are visible, never dropped (code brief §7.4). `muscle_group` is one of
the **six canonical slugs** — `glutes`, `back`, `chest`, `shoulders`, `arms`, `core` — or the literal
`unmapped` (always rendered last). These same slugs are the `muscle_group` values on `/exercises`.
```jsonc
{
  "weeks": [
    { "week_start": "2026-06-01",
      "buckets": [
        { "muscle_group": "glutes", "volume_lbs": 12400 },
        { "muscle_group": "back",   "volume_lbs": 9800 },
        { "muscle_group": "unmapped", "volume_lbs": 1500 }  // always last if present
      ] }
  ]
}
```

---

## Empty / edge states (both UIs must handle)
- **No data yet** (before first import): every read endpoint returns its top-level object with an
  empty array (`exercises: []`, `points: []`, etc.), not a 404. UI shows an empty state pointing at import.
- **Unmapped-only muscle data:** `muscle-volume` may return weeks whose only bucket is `unmapped`.
- **Timed/bodyweight exercises never carry e1RM or volume-in-lbs** — UI must not render a $/lbs axis for them.
