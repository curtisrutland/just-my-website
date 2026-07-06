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

## Setup

The client is `client.py` in this skill directory, with the API base URL and Curtis's agent token
already baked in. In a Python sandbox:

```python
from client import MacrosClient
m = MacrosClient()
```

Dates are `YYYY-MM-DD` in Curtis's local timezone. "Today" is his local date.

## The core loop: logging food

1. **Parse** what Curtis said into distinct items.
2. **Get numbers.** For a recognizable food, prefer real data: `m.search_usda("chicken thigh cooked")`
   → pick an `fdcId` → `m.resolve_usda(fdcId)` (caches it, returns per-100g macros) → scale by the
   amount. For a custom item (a specific bar, unflavored whey), `m.create_food(...)` once, then reuse.
   When you can only eyeball it, estimate from your own knowledge.
3. **Log absolute macros** for the whole entry (quantity already applied):

```python
m.log_entry(
    consumed_on="2026-07-05",
    quantity_grams=180,
    confidence="estimated",
    note="one big thigh, eyeballed",   # what Curtis actually said — load-bearing on estimates
    calories=342, protein=47, fat=17, carbs=0,
)
```

### Confidence — pick honestly
- `measured` — weighed, or a packaged/known serving.
- `estimated` — **you inferred the grams/macros from Curtis's words.** Always attach a `note` with
  his description so the estimate is auditable and re-estimable. This is not decoration.
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

## Reviewing, correcting, removing

```python
day = m.get_day("2026-07-05")   # totals, estimation %, target(s), entries (each with an id)
m.correct_entry(entry_id, calories=360, protein=50)   # only supplied fields change
m.correct_entry(entry_id, note="actually two thighs")
m.delete_entry(entry_id)        # soft delete
```

When Curtis says "actually that was closer to X," correct the specific entry — don't edit the food.

## Principles
- An estimate is information, never a warning. Log it plainly with its note; don't hedge in the data.
- Snapshot the numbers at log time (the client does this) — correcting a food later must never rewrite
  past days.
- If Curtis is vague, estimate and say so (confidence `estimated` + note). Don't refuse to log because
  the input is fuzzy — that's the normal case.
