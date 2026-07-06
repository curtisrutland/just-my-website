---
name: manage-macros
description: >-
  Log and manage Curtis's food intake in justmy.website (the macro tracker). Use whenever Curtis
  says what he ate or drank ("had a couple handfuls of almonds and a big chicken thigh"), asks how
  his day is going against target, wants to correct or remove something he logged, or tells you a
  day was training or rest. This is the only write path into the tracker.
---

# manage-macros

You log what Curtis eats into justmy.website. Curtis describes food in plain, often vague terms and
**you estimate the macros**. The whole system is built to be **honest about fuzziness** — never
record an estimate as if it were a measured fact.

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import MacrosClient
m = MacrosClient()   # base URL + Curtis's agent token are baked in
```

Dates are `YYYY-MM-DD` in Curtis's local timezone (America/Chicago). "Today" is his local date.

## The core loop: logging food

1. **Parse** what Curtis said into distinct items.
2. **Get numbers.** For a recognizable food, prefer real data: `m.search_usda("chicken thigh cooked")`
   → pick an `fdcId` → `m.resolve_usda(fdcId)` (caches it, returns per-100g macros) → scale by the
   amount. Otherwise estimate from your own knowledge.
3. **Log** each item with a concise **`name`** and absolute macros (quantity already applied). The
   call returns the created entry — check its `id` to confirm the write inline (no need to re-read):

```python
e = m.log_entry(
    consumed_on="2026-07-05",
    name="grilled chicken breast",        # display label — ALWAYS set this (or entries read "ad-hoc")
    quantity_grams=180,
    confidence="estimated",
    note="one breast, eyeballed ~180g",   # the fuzziness / how you estimated
    calories=298, protein=56, fat=6, carbs=0,
)
assert e["id"]                            # write confirmed
```

### `name` vs `note`
- **`name`** — what it was, short and scannable ("3 large eggs", "half a tub of hummus"). This is the
  row label in the UI. **Always provide it.**
- **`note`** — optional: the fuzziness, how you estimated, or Curtis's exact words. This is the audit
  trail on an estimate, not the label.

### Confidence — pick honestly
- `measured` — weighed, or a packaged/known serving.
- `estimated` — **you inferred it from Curtis's words.** Attach a `note` so it's auditable.
- `logged_serving` — Curtis gave a household unit (1 scoop, 1 banana) you converted to grams.

Macros are plain numbers: grams for protein/fat/carbs/fiber/sugar/sodium/satfat, kcal for calories.
Provide what you know; leave the rest out (unknown ≠ zero).

## Day kind (which target applies)

Only set it when Curtis actually tells you:

```python
m.set_day_kind("2026-07-05", "training")   # or "rest"
m.clear_day_kind("2026-07-05")             # back to unspecified
```

**Do not guess.** A day with no tag is `unspecified`, and the rollup deliberately shows BOTH the
training and rest targets for it — that's correct, not a gap to fill.

## Targets (so the rollup can compare)

Set Curtis's calorie-cycling targets when he gives them (they persist; you only set them when they
change):

```python
m.set_target("training", "2026-01-01", calories=2800, protein=160, fat=90, carbs=300)
m.set_target("rest",     "2026-01-01", calories=2200, protein=160, fat=70,  carbs=200)
```

Targets are dated — the latest one effective on/before a day applies. If `get_day` returns
`targets: {}`, no profile is configured yet.

## Reviewing, correcting, removing

```python
day = m.get_day("2026-07-05")   # totals, estimation %, target(s), entries (each with an id)
m.correct_entry(entry_id, calories=360, protein=50)   # only supplied fields change
m.correct_entry(entry_id, name="chicken thigh (not breast)")
m.delete_entry(entry_id)        # soft delete
```

When Curtis says "actually that was closer to X," correct the specific entry — don't edit the food.

## Principles
- An estimate is information, never a warning. Log it plainly with a name + note.
- The client snapshots the numbers at log time — correcting a food later never rewrites past days.
- If Curtis is vague, estimate and say so (confidence `estimated` + note). Don't refuse to log because
  the input is fuzzy — that's the normal case.
