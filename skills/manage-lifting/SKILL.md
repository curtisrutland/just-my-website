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
    focus="upper")   # one of: push pull legs upper lower full accessory other
```

`interpret` writes **only** your fields (`interpretation`, `focus`) — latest-wins, overwrite freely
on re-analysis. It raises on an unknown `focus`. **Do NOT write `session_notes` or `quality`** — those
are Curtis's (he sets them in the web); this client deliberately can't.

## Honesty — read the notes, don't misread the numbers

`annotation.sessionNotes` is where Curtis records **context you can't see in the numbers**. Read it
before you interpret, and let it override the raw reading:

- A load that **dropped** is often not a regression — a **gym/machine change** (a different
  pushdown cable is harder), a **form correction** (lighter weight done right), or a deliberate
  deload. If the notes say so, say so — never call it a loss.
- A **debut** movement shows no PR even at a high number (it's just setting its baseline).

The point of this module is that you don't re-litigate these each time — the context lives in the
notes and your prior reads. Ground trajectory claims with `get_lift(template_id)` (e1RM per session).

## Reading the data (real shapes)

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
