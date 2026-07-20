# Design brief → Claude Design: Lifting journal (justmy.website)

A **fourth module** for justmy.website. **Reuse the existing design system you already built** for
this project — the exact same tokens (`--color-*`, `--font-*`, `--radius`, `--band`), the dark-mode-
first look, the mono/tabular numbers, and the `AppShell` chrome (210px nav rail + terminal header).
This module adds a `lifting` nav entry (add it as a **LIVE** link) and two screens: a **journal
list** and a **session detail**. Don't invent a new aesthetic; extend the one that's there.

Produce a **visual + structural reference** (single-file artifact is fine), rendered against the
**real data** below. The full binding spec is `docs/lifting-model.md` — it wins on any conflict. The
backend is built; the JSON in this brief is **real output from the live API**, not a sketch.

---

## STOP — what the real data actually looks like (this changed the brief)

The backend is now live and Curtis's full Hevy history (13 sessions) is loaded. Rendering against
the real data surfaced things a first reading of "lifting journal" would get wrong. Design for
**these**, not for a powerlifting max sheet:

1. **It's rehab / accessory work, not heavy barbell.** The real sessions are dumbbell, cable, and
   **bodyweight mobility** (Bird Dog, Glute Bridge, Lateral Lunge, planks), mostly **10-rep sets**.
   Titles are "Session A - Injury", "Session B - Injury Adjusted". The hero is NOT a barbell single
   — it's a dense, quiet list of light accessory movements. Make *that* feel considered.
2. **Weights are stored as noisy kg floats — Curtis logs in `lb`.** A set reads `weightKg:
   18.143717` (that's 40 lb). The clean numbers are the **pound** originals (an exercise note even
   says "15lbs kettle bell"). So: **default the display to `lb`**, offer a `kg` toggle, and **round
   for display either way** (`18.143717` kg → `40` lb, or `18.1` kg). Never render a raw float.
   *(This flips the old brief's "kg with an optional lb toggle" — lb is the natural default here.
   Curtis: flip it if you disagree.)*
3. **RPE is 100% empty** (0 of 249 sets). **Drop the RPE column entirely.** Don't design a slot for
   data that never comes. (If it ever appears, it can return — but not now.)
4. **Many exercises have NO e1RM** (bodyweight/mobility/cardio — Bird Dog, Elliptical, planks). The
   left "instrument panel" must render an exercise with a **null e1RM** and **null weight** calmly —
   just reps, or just a duration — not as a broken/empty cell.
5. **Some sets have only a duration or distance** (18 timed sets — Elliptical, Side Plank). A set row
   must render **`durationSeconds` / `distanceMeters`** when weight+reps are absent.
6. **There are no `warmup`-type sets in the data** — every set is `normal`. "Warm ups" show up as
   whole **exercises** (an exercise literally titled "Warm Up"), not tagged sets. Still *support*
   muted warmup-set styling for future data, but don't make it a headline; it won't show today.
7. **The entire history is un-interpreted** (13/13 `interpreted:false`). The **"needs read" state is
   the default, not the exception** — the journal opens as a wall of un-read sessions. Make that
   wall feel intentional and calm, not like 13 error badges.
8. **PRs are NOT rare in a fresh backfill** — one session set **8**, others 5/4/3/2, many 0. Early
   history racks them up as baselines climb (they get rarer over time). So a card may carry **many**
   PRs: show a **count/summary on the card** (e.g. "4 PRs"), and mark the specific PR **sets** in the
   detail — don't try to fit eight individual badges on one card.

---

## The one idea that must come through visually
**The numbers are Hevy's; the meaning is ours.** This is a *training journal / interpretation layer*,
**not a workout tracker** — Hevy already logs the sets. Unlike weight (trend-over-noise hero) or
macros (honest-about-fuzziness hero), the signature here is a **juxtaposition**: on the session
detail, the **cold, precise set table** sits beside the **warm, editorial interpretation**. That
contrast *is* the module. Spend your boldness on making that pairing feel deliberate — the hard grid
of numbers on one side, the prose read on the other — not on a data-viz hero. There is a small
progression chart, but it is supporting evidence, never the star.

## Screen 1 — `SessionDetail` (the signature surface; spend your care here)
Two zones, side by side on desktop (stacked on narrow):

- **The facts (left) — Hevy's truth, cold and exact.** The exercise → set table. Each exercise is a
  quiet mono subheading (like the `DAY ROLLUP` / column-header treatment); under it, set rows. The
  columns that actually carry data: **set #**, **weight** (mono/tabular, rounded, in the active unit
  — `lb` default), **reps**. **No RPE column.** For a **bodyweight** exercise show reps alone (weight
  blank/`—`, never `0`); for a **timed/cardio** set show **duration** (`mm:ss`) or **distance** in
  place of weight×reps. Mark **PR** sets with a single `--color-accent` glyph (decisive — this is
  where the accent earns emphasis). Show a per-exercise **e1RM** in mono **only when it exists**;
  when `e1rmUnreliable` is true render it parenthesized/muted; when the exercise has no e1RM at all
  (bodyweight/cardio), show nothing there rather than an empty stat. Surface the exercise **`notes`**
  when present (e.g. "15lbs kettle bell") — quiet, secondary. This side reads like an instrument
  panel for accessory work: many short rows, light loads, honest gaps.
- **The meaning (right) — ours, warm and editorial.** A stacked panel:
  - **`session_notes`** — Curtis's editable textarea (the web write path). Placeholder like
    "`how did it feel?`". Quiet, roomy. Inline optimistic save (no modal).
  - **`quality`** — a 1–5 selector Curtis sets (pips or a small segmented control). Subjective, his.
  - **`focus`** — a single tag from a fixed set (`push · pull · legs · upper · lower · full ·
    accessory · other`), Claude-set, shown as a quiet chip (read-only in web).
  - **Claude's `interpretation`** — rendered as **prose, read-only** in the web (Claude writes it via
    the skill). Give it editorial warmth — comfortable measure, `--font-body`, a subtle left rule or
    label ("`the read`") so it reads as commentary, distinct from Curtis's own notes. **When empty
    (the current state for every session), show a calm muted "`no read yet`"** — this is the common
    case, so make the empty state feel like a natural resting state, not a gap.
  A session header carries date, title, and a derived stat line (tonnage, duration, working sets,
  and a PR summary when `prs` is non-empty).

## Screen 2 — `LiftingJournal` (the list surface)
Session cards, **newest first**. Each card, scannable in one pass:
- Date + workout **title** (e.g. "Session B - Injury Adjusted"); a compact mono stat line
  (**tonnage**, **top e1RM**, **duration**). Real magnitudes vary widely — tonnage ~2,000–5,000 (kg),
  top e1RM anywhere from ~12 to 130+ (kg), duration 30–100 min — so size these columns for range.
- The **`focus`** chip and the **`quality`** pips **when set** — currently they're all empty, so the
  card's resting state has neither; design that bare state to still look complete.
- A **one-line interpretation snippet** (truncated) when present — otherwise a quiet **"needs read"**
  marker (muted — information, not alarm). **This is the default state for every card right now.**
- **PR summary** (`--color-accent`) when the session set one — a **count** ("4 PRs"), not N badges.
- Header offers **filter chips** for `focus` and an **un-interpreted** toggle (the API supports
  `?focus=` and `?interpreted=true|false`, plus `?from=`/`?to=` date bounds). Empty state (no
  sessions at all): a friendly mono line ("`no sessions yet — connect Hevy`").

## Supporting component (quieter — reuse existing patterns)
- **`LiftProgression`** — a small e1RM-over-time line for one lift, opened from a set/exercise row
  (`GET /api/lifting/lifts/{templateId}` → `{ points: [{ startedAt, e1rmKg, topSetKg }] }`). Muted,
  `--color-accent` line, mono axis labels. Evidence, not spectacle. Only meaningful for lifts that
  *have* an e1RM (skip the affordance on bodyweight/cardio exercises). Fine to mark as phase-2.

## Interactions & behavior
- **Edit `session_notes` / set `quality`** → inline, optimistic, server-action save (no modal).
- **`interpretation` and `focus` are read-only in the web** — they're Claude's, via the skill.
- **`lb` / `kg` unit toggle** in the detail header (and applied consistently in cards). `lb` default.
- **No add-a-workout affordance anywhere** — sessions only arrive from Hevy. A quiet, understated
  header-level "catch up from Hevy" action may exist, but it's a *pull*, not a create.
- **Theme toggle / terminal header / nav rail** — inherited from `AppShell`, unchanged. Header route
  reads `~/lifting`.

## Color / tone
Mostly **neutral** — `--color-text`, `--color-text-muted`, `--color-border` — with the **accent
reserved for what's genuinely notable**: PR marks and the progression line. The **`quality`** control
may use the accent for the selected value. Keep `quality` calm. `--font-mono` tabular for every
number (weights, reps, tonnage, e1RM, duration). Dark-mode-first; light derived. The emotional
register: the left side clinical, the right side reflective — one screen, two temperatures.

---

## The response contract (what your components receive)

Bind to these exact field names (from `src/lib/lifting/types.ts`; instants are ISO strings, weights
are canonical **kg** numbers you round/convert for display).

- **`GET /api/lifting/sessions`** → `{ items: SessionSummary[], limit, offset, count }`
- **`GET /api/lifting/sessions/{id}`** → `SessionDetail`

```
SessionSummary = {
  id, hevyId, title: string|null, startedAt: ISO, endedAt: ISO|null, description: string|null,
  derived: {
    tonnageKg: number, workingSets: number, totalReps: number, exerciseCount: number,
    topE1rmKg: number|null, durationMin: number|null,
    prs: { lift: string, templateId: string|null, kind: "weight"|"e1rm", value: number }[]
  },
  annotation: {
    sessionNotes: string|null, quality: 1..5|null,
    focus: "push"|"pull"|"legs"|"upper"|"lower"|"full"|"accessory"|"other"|null,
    interpretation: string|null, interpreted: boolean
  }
}

SessionDetail = SessionSummary & {
  exercises: {
    index, title, exerciseTemplateId: string|null, notes: string|null, supersetGroup: number|null,
    e1rmKg: number|null, e1rmUnreliable: boolean,
    sets: {
      index, setType: "normal"|"warmup"|"failure"|"dropset",
      weightKg: number|null, reps: number|null, rpe: number|null,
      distanceMeters: number|null, durationSeconds: number|null, pr: boolean
    }[]
  }[]
}
```

Notes: `description` is often `""` (treat empty as absent). `rpe` is always null today. `supersetGroup`
is null today (would group co-performed exercises). `weightKg` is a precise float — round for display.

---

## Real data to render against (live API output — abridged)

**Journal list** (real `GET /api/lifting/sessions`, newest first — every one un-interpreted):

```jsonc
{ "items": [
  { "title": "Session B - Injury Adjusted", "startedAt": "2026-07-16T22:46:30.000Z",
    "endedAt": "2026-07-17T00:09:38.000Z",
    "derived": { "tonnageKg": 5121, "workingSets": 25, "totalReps": 235, "exerciseCount": 10,
                 "topE1rmKg": 133.1, "durationMin": 83, "prs": [] },
    "annotation": { "sessionNotes": null, "quality": null, "focus": null,
                    "interpretation": null, "interpreted": false } },
  { "title": "Session B", "startedAt": "2026-07-09T22:04:20.000Z",
    "derived": { "tonnageKg": 2136, "workingSets": 20, "totalReps": 198, "exerciseCount": 8,
                 "topE1rmKg": 36.3, "durationMin": 55,
                 "prs": [ { "lift": "Cable Core Pallof Press", "kind": "weight", "value": 18.1 },
                          { "lift": "Cable Core Pallof Press", "kind": "e1rm",   "value": 24.2 },
                          { "lift": "Bicep Curl (Dumbbell)",   "kind": "weight", "value": 20.4 },
                          { "lift": "Bicep Curl (Dumbbell)",   "kind": "e1rm",   "value": 27.2 } ] },
    "annotation": { "sessionNotes": null, "quality": null, "focus": null,
                    "interpretation": null, "interpreted": false } }
] }
```

**Session detail** (real `GET /api/lifting/sessions/{id}` for "Session B" — abridged to 4 of its 8
exercises: a bodyweight-mobility block with null e1RM, then cable/dumbbell accessory work with PRs.
Note the raw float `weightKg` you must round, and the "needs read" annotation):

```jsonc
{
  "title": "Session B", "startedAt": "2026-07-09T22:04:20.000Z", "endedAt": "2026-07-09T22:59:04.000Z",
  "description": "",
  "derived": { "tonnageKg": 2136, "workingSets": 20, "totalReps": 198, "exerciseCount": 8,
               "topE1rmKg": 36.3, "durationMin": 55, "prs": [ /* 4, see list above */ ] },
  "annotation": { "sessionNotes": null, "quality": null, "focus": null,
                  "interpretation": null, "interpreted": false },
  "exercises": [
    { "index": 0, "title": "Bird Dog", "notes": "", "e1rmKg": null, "e1rmUnreliable": false,
      "sets": [ { "index": 0, "setType": "normal", "weightKg": null, "reps": 10, "durationSeconds": null, "pr": false },
                { "index": 1, "setType": "normal", "weightKg": null, "reps": 10, "durationSeconds": null, "pr": false } ] },
    { "index": 2, "title": "Lateral Lunge", "notes": "15lbs kettle bell", "e1rmKg": null, "e1rmUnreliable": false,
      "sets": [ { "index": 0, "setType": "normal", "weightKg": null, "reps": 10, "pr": false },
                { "index": 1, "setType": "normal", "weightKg": null, "reps": 10, "pr": false } ] },
    { "index": 3, "title": "Cable Core Pallof Press", "notes": "", "e1rmKg": 24.2, "e1rmUnreliable": false,
      "sets": [ { "index": 0, "setType": "normal", "weightKg": 18.143717, "reps": 10, "pr": true },
                { "index": 1, "setType": "normal", "weightKg": 18.143717, "reps": 10, "pr": false },
                { "index": 2, "setType": "normal", "weightKg": 18.143717, "reps": 10, "pr": false } ] },
    { "index": 5, "title": "Bicep Curl (Dumbbell)", "notes": "", "e1rmKg": 27.2, "e1rmUnreliable": false,
      "sets": [ { "index": 0, "setType": "normal", "weightKg": 20.41168, "reps": 10, "pr": true },
                { "index": 1, "setType": "normal", "weightKg": 20.41168, "reps": 8,  "pr": false } ] }
  ]
}
```

**A timed/cardio set** looks like this (weight+reps null, only a duration) — the set table must
render this row shape too:

```jsonc
{ "index": 0, "setType": "normal", "weightKg": null, "reps": null, "durationSeconds": 600, "pr": false }
// e.g. "Elliptical Trainer" — show 10:00, no weight/reps
```

For the **interpreted** state (none exist yet — Claude writes these later via the skill), render the
right panel with illustrative values like:
`quality: 3, focus: "pull", interpretation: "A quiet rehab session — light cable and dumbbell work,
clean 10s throughout. The Pallof press edged a small PR, so the injured side is tolerating anti-
rotation load again. Hold here; don't chase weight until the mobility block moves cleanly."`

Dark-mode-first. Numbers `--font-mono` tabular, rounded, in the active unit (`lb` default). PR marks
use `--color-accent`; the "needs read" marker is muted (information, not alarm).

## Out of scope
No add/log-a-workout UI (ingestion only). No editing of Hevy facts (sets/reps/weights are read-only).
No editable `interpretation`/`focus` in the web (Claude's, via skill). No RPE column (no data). No
big analytics dashboard, no per-body-part volume heatmaps, no calendar heatmap, no social/comparison
anything. No new tokens or fonts. Just the two `lifting` screens + the `lifting` nav entry, in the
established look.
