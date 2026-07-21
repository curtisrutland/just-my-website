---
name: manage-lifting
description: >-
  Read and interpret Curtis's lifting sessions in justmy.website (the training journal over Hevy).
  Use whenever Curtis asks you to read/interpret his workouts, catch up on un-interpreted sessions,
  classify a session's focus, review a lift's progression, or pull recent workouts from Hevy. This is
  the interpretation layer — you write the read; the sets/reps/weights are Hevy's and read-only.
---

# manage-lifting

This is a training **journal**, not a workout tracker — Hevy already logs the sets. The signature:
**the numbers are Hevy's; the meaning is ours.** Curtis's workouts flow in from Hevy as read-only
facts. Your job is the **annotation**: read a session and write the `interpretation` (your read on
where the training is going) and a `focus` tag. The emotional throughline is **progress — is he
getting better?** This is general strength & fitness (not bodybuilding, not a max sheet, not rehab).

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import LiftingClient, kg_to_lb
lf = LiftingClient()   # base URL + Curtis's agent token are baked in
```

**Weights are canonical KILOGRAMS in every field (`weightKg`, `e1rmKg`, `tonnageKg`, PR `value`).
Curtis logs and thinks in whole POUNDS.** Reason and write in lb — `kg_to_lb(kg)` gives the whole
pound value. Never put a raw kg number or a decimal in an interpretation.

## The loop: read the queue → read a session → write the interpretation

```python
queue = lf.list_uninterpreted()          # sessions with no read yet (interpreted=false)
for s in queue["items"]:
    print(s["startedAt"][:10], s["title"], s["derived"]["prs"])
```

Pick a session and read it in FULL before interpreting:

```python
d = lf.get_session(session_id)
d["annotation"]["sessionNotes"]   # ← READ THIS FIRST — Curtis's context (see "Honesty" below)
d["derived"]                      # tonnageKg, workingSets, totalReps, topE1rmKg, durationMin, prs[]
d["exercises"]                    # each: title, exerciseTemplateId, e1rmKg, e1rmUnreliable, sets[]
```

Write the read (and, usually, the focus tag) in one call:

```python
lf.interpret(session_id,
    interpretation="A quiet accessory day — light dumbbell and cable work, clean 10s throughout. "
                   "The pallof press edged a small PR, so anti-rotation strength is trending up. "
                   "Hold the loads here; let form stay crisp before adding weight.",
    focus="upper")   # one of: push pull upper lower full accessory other
```

`interpret` writes **only** your fields (`interpretation`, `focus`) — latest-wins, overwrite freely
on re-analysis. It raises on an unknown `focus`. **Do NOT write `session_notes` or `quality`** — those
are Curtis's (he sets them in the web); this client deliberately can't.

## Honesty — read the notes, quote the numbers

**Two note sources — read BOTH, cite them distinctly, never conflate:**
- `annotation.sessionNotes` — **Curtis's** session-level context ("backed off RDLs, they felt like I
  was loading my back"). May be null.
- `exercises[].notes` — **Hevy's per-exercise notes**, read-only, ingested from the log ("Now with
  dumbbells", "Load next time", "15lbs kettle bell"). Real signal — implement changes and intent —
  and now visible to Curtis in the detail view. When you cite one, **name its source** ("per the Hevy
  exercise note"); never attribute it vaguely to "the note" or fold it into Curtis's session notes.

Let the notes override the raw reading:
- A load that **dropped** is often not a regression — a **gym/machine change** (a different pushdown
  cable is harder), a **form correction** (lighter, done right), a **new implement** (kettlebell →
  dumbbell), or a deliberate deload. If a note says so, say so — never call it a loss.
- A **debut** movement shows no PR even at a high number (it's just setting its baseline).

**Quote Hevy's numbers — never a remembered figure.** The module's signature is *the numbers are
Hevy's*. Every e1RM / tonnage / top-set in your prose must come from `derived` or
`get_lift()["points"]`, not from memory or an eyeballed estimate — reason and write in lb (`kg_to_lb`),
but the source number is Hevy's. A prose figure that doesn't trace to the computed value is an
integrity leak, even when directionally right.

**Whole-lb rounding can hide small progress.** `kg_to_lb` gives whole pounds, so a real e1RM creep
under ~1 kg can round to the same lb and read as "flat." For trajectory, compare the underlying
`e1rmKg` across `get_lift()["points"]`; you may note a sub-pound gain in words ("up a touch, under a
pound") — just never print raw kg or a decimal in the prose.

## Reading the data (real shapes)

- **List reads are wrapped; single reads are NOT.** The list calls return a paginated wrapper —
  `list_sessions` / `list_uninterpreted` → `{"items": [...], "limit", "offset", "count"}` (iterate
  `["items"]`). The single-resource calls return the object **directly, with no `items`**:
  - `get_session(id)` → the session dict itself (`["exercises"]`, `["derived"]`, `["annotation"]`, …).
  - `get_lift(template_id)` → `{"templateId", "title", "points": [...]}`; each point is
    `{"sessionId", "startedAt", "e1rmKg", "topSetKg"}` (kg; `e1rmKg` is null for bodyweight lifts).
    Read `["points"]` — there is no `["items"]` here.

  ```python
  p = lf.get_lift(template_id)
  [kg_to_lb(pt["e1rmKg"]) for pt in p["points"]]   # e1RM per session, oldest → newest (lb)
  ```
- **PRs.** `derived.prs` lists PR *flags* — a lift that beats both its top weight and its best e1RM
  produces two entries (`kind: "weight"` and `"e1rm"`). Count **distinct lifts** for "how many PRs".
  In the sets, `pr: true` marks the set that achieved it.
- **Not everything is a barbell.** `weightKg` is **null** for bodyweight moves (read `reps`); a
  **timed/cardio** set has only `durationSeconds` (or `distanceMeters`), no weight/reps. `e1rmKg` is
  null for those exercises. `rpe` is always null. `e1rmUnreliable: true` means the best set was
  high-rep (>12) — treat that e1RM as soft.
- Instants (`startedAt`) are ISO strings; `focus`/`interpretation` are null until you write them.

## Catch up from Hevy

```python
lf.pull()            # ingest recent workouts (recover a missed webhook); idempotent
lf.pull(pages=50)    # a deeper sweep / initial backfill
```

New workouts normally arrive by webhook; `pull()` is the manual recovery lever. After a pull, the new
sessions show up in `list_uninterpreted()` for you to read.
