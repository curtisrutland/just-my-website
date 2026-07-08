---
name: manage-macros
description: >-
  Log and manage Curtis's food intake in justmy.website (the macro tracker). Use whenever Curtis
  says what he ate or drank ("had a couple handfuls of almonds and a big chicken thigh"), asks how
  his day is going against target, wants to correct or remove something he logged, or tells you a
  day was training or rest. Also when he shows you a **nutrition label** to pin a branded ingredient's
  macros, or logs a recurring multi-part food (a smoothie) whose parts should come from pinned values
  rather than re-estimation. This is the only write path into the tracker.
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

## Get the date right — before every log

**Establish the actual current date first: call `m.today()`** (Curtis's local date, America/Chicago).
Do NOT infer the day from the conversation. If you've been talking *about* yesterday, or catching up
on an earlier meal, the day you log against is still **today's real date** unless Curtis actually says
the food was eaten on another day. Set each entry's `consumed_on` deliberately — a wrong date silently
lands food on the wrong day's totals.

- "I had eggs for breakfast" (no day mentioned) → `m.today()`.
- "yesterday I…" or an explicit date → that day (e.g. `addDays` in your head from `m.today()`).
- **Unsure which day it belongs to** — late-night eating, a chat that spanned midnight, or the
  conversational context is pulling you toward a different date than the calendar — **ask Curtis which
  date to log it against. Don't guess.**

Dates are always `YYYY-MM-DD` in Curtis's local timezone.

## The core loop: logging food

1. **Parse** what Curtis said into distinct items.
2. **Get numbers.** Prefer a pinned value over a fresh estimate, in this order:
   (a) a **registry ingredient** — `m.search_ingredient("ripple", category="plant-milk")` for a
   branded/label food Curtis has pinned (see *Ingredient registry* below);
   (b) **USDA** — `m.search_usda("chicken thigh cooked")` → pick an `fdcId` → `m.resolve_usda(fdcId)`
   (caches it, returns per-100g macros) → scale by the amount;
   (c) otherwise **estimate** from your own knowledge.
3. **Log** each item with a concise **`name`** and absolute macros (quantity already applied). The
   call returns the created entry — check its `id` to confirm the write inline (no need to re-read):

```python
e = m.log_entry(
    consumed_on=m.today(),                 # the real current date — not a date carried from the chat
    name="grilled chicken breast",        # display label — ALWAYS set this (or entries read "ad-hoc")
    quantity_grams=180,
    confidence="estimated",
    note="one breast, eyeballed ~180g",   # the fuzziness / how you estimated
    calories=298, proteinContent=56, fatContent=6, carbohydrateContent=0,
)
assert e["id"]                            # write confirmed
```

### A composite meal → log it atomically with `log_entries`
When one thing Curtis ate is really several components (a restaurant plate, a smoothie broken into
constituents), log them in **one atomic call** instead of a loop. All the components land or none do
— you never get a half-logged meal. Each item is a dict with the SAME fields as `log_entry`:

```python
plate = m.log_entries([
    {"consumed_on": "2026-07-05", "name": "sirloin", "quantity_grams": 200, "confidence": "estimated", "calories": 430, "proteinContent": 62, "fatContent": 20, "carbohydrateContent": 0},
    {"consumed_on": "2026-07-05", "name": "baked potato", "quantity_grams": 250, "confidence": "estimated", "calories": 260, "proteinContent": 6, "fatContent": 0, "carbohydrateContent": 60},
    {"consumed_on": "2026-07-05", "name": "side salad + dressing", "quantity_grams": 150, "confidence": "estimated", "calories": 180, "proteinContent": 3, "fatContent": 15, "carbohydrateContent": 8},
])
# Returns the created entries (read shape, input order). If any component is bad, NOTHING is logged
# and the call raises, naming the offending index — so a "success" always means the whole plate landed.
```

Use a single `log_entry` for a single item; reach for `log_entries` only when the components belong
to one meal and you want the all-or-nothing guarantee.

### `name` vs `note`
- **`name`** — what it was, short and scannable ("3 large eggs", "half a tub of hummus"). This is the
  row label in the UI. **Always provide it.**
- **`note`** — optional: the fuzziness, how you estimated, or Curtis's exact words. This is the audit
  trail on an estimate, not the label.

### Confidence — pick honestly
- `measured` — weighed, or a packaged/known serving.
- `estimated` — **you inferred it from Curtis's words.** Attach a `note` so it's auditable.
- `logged_serving` — Curtis gave a household unit (1 scoop, 1 banana) you converted to grams.

Macros are plain numbers (grams for mass macros, kcal for `calories`) and use the **schema.org
field names — the same on write and read**: `calories`, `proteinContent`, `fatContent`,
`carbohydrateContent`, `fiberContent`, `sugarContent`, `sodiumContent`, `saturatedFatContent`.
The name you log with is the name you read back. Provide what you know; leave the rest out
(unknown ≠ zero).

## Ingredient registry — pin branded/label foods

Some foods recur constantly (a daily smoothie's parts: a plant-milk, a whey, a skyr, a banana). If you
re-estimate their macros from memory every time, the *same product* drifts day to day. The registry
fixes that: pin each product's **per-100g** macros **once**, then log by referencing the pinned row, so
a number only moves when a *weight* moves. Registry foods live in the same catalog as USDA foods —
`source` records how the numbers were obtained and how far to trust them:

- `scanned` — from a real nutrition label Curtis showed you. Highest trust.
- `proxy` — a deliberate stand-in (e.g. Greek-yogurt numbers for skyr until you get the real label).
  **Visibly a guess.** Upgrade it later.
- `estimated` — your own knowledge, no label. Lowest trust.
- `usda` — resolved from FoodData Central (via `resolve_usda`); carries an `fdcId`.

### Register from a label (per-100g, keep the printed label)
Labels print **per serving**; the registry stores **per 100g**. Convert: `per100g = printed × 100 /
servingGrams`. Pass the printed serving + printed macros **verbatim** as `label_basis` so the per-100g
value stays auditable back to the scan. Every non-usda ingredient needs a `category` (the match key)
and at least `calories`/`proteinContent`/`fatContent`/`carbohydrateContent` per 100g.

```python
res = m.register_ingredient(
    "Ripple Unsweetened", "plant-milk", source="scanned", brand="Ripple",
    # per 100g (label said 8g protein / 4.5g fat per 240 mL cup → ×100/240):
    calories=52, proteinContent=3.3, fatContent=1.9, carbohydrateContent=0,
    serving_label="1 cup", serving_grams=240,
    label_basis={"servingLabel": "1 cup", "servingGrams": 240,   # AS PRINTED (per serving)
                 "calories": 125, "proteinContent": 8, "fatContent": 4.5, "carbohydrateContent": 0},
    tags=["low-carb", "liquid"],
)
```

### Dedupe is automatic — confirm before making a twin
`register_ingredient` searches the brand+category cohort first. If it finds likely matches it does
**not** insert — it hands them back for you to judge, so you don't end up with "Ripple" and "Ripple
Unsweetened" as accidental twins a month apart:

```python
if res["created"] is None:
    for c in res["duplicate_candidates"]:
        print(c["id"], c["name"], c["proteinContent"])   # ask Curtis: update one of these, or genuinely new?
    # → to UPDATE an existing row: m.update_ingredient(<id>, ...)
    # → if it's truly a new variant (different per-100g): re-call with confirm=True
    res = m.register_ingredient("Ripple Unsweetened", "plant-milk", source="scanned", brand="Ripple",
                                confirm=True, calories=52, proteinContent=3.3, fatContent=1.9, carbohydrateContent=0)
ingredient = res["created"]
```

### Find, resolve, and upgrade
```python
hits = m.search_ingredient("skyr", category="yogurt")["items"]   # CONFIRM which row — never auto-pick
row  = m.resolve_ingredient(hits[0]["id"])                        # full row; cached for the session
# When the real skyr label finally appears, upgrade the proxy IN PLACE (same id → past logs untouched):
m.update_ingredient(row["id"], source="scanned", proteinContent=11, fatContent=0.2,
                    label_basis={"servingLabel": "1 container", "servingGrams": 150, "proteinContent": 17})
```
`search_ingredient` returns candidates and **never auto-selects** — confirming which row is what keeps a
sweetened-vs-unsweetened mix-up out. `update_ingredient` errors on any unrecognised field (no silent
no-op), same discipline as `correct_entry`.

### Log from the registry — estimation-free
Reference the pinned row by `food_id` and pass the **weighed grams**, with **no macros** — the API scales
the ingredient's per-100g by the grams and snapshots the result onto the entry. The estimation step is
gone; the numbers trace to a pinned row:

```python
milk  = m.search_ingredient("ripple", category="plant-milk")["items"][0]   # confirm it
whey  = m.search_ingredient("whey",   category="protein-powder")["items"][0]
m.log_entries([
    {"consumed_on": m.today(), "name": "Ripple (smoothie)", "food_id": milk["id"], "quantity_grams": 240, "confidence": "measured"},
    {"consumed_on": m.today(), "name": "whey (smoothie)",   "food_id": whey["id"], "quantity_grams": 32,  "confidence": "measured"},
])
# no macros passed → each entry's macros are snapshotted from its food's per-100g × grams, at log time.
```

Because macros are snapshotted at log time, later fixing an ingredient (or upgrading a proxy to scanned)
**never rewrites past days** — it only affects logs made after the fix. That's the intended behavior.

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
m.set_target("training", "2026-01-01", calories=2800, proteinContent=160, fatContent=90, carbohydrateContent=300)
m.set_target("rest",     "2026-01-01", calories=2200, proteinContent=160, fatContent=70,  carbohydrateContent=200)
```

Targets are dated — the latest one effective on/before a day applies. If `get_day` returns
`targets: {}`, no profile is configured yet.

## Reviewing, correcting, removing

```python
day = m.get_day("2026-07-05")   # totals, estimation %, target(s), entries (each with an id)
m.correct_entry(entry_id, calories=360, proteinContent=50)   # only supplied fields change
m.correct_entry(entry_id, name="chicken thigh (not breast)")
m.correct_entry(entry_id, consumed_on="2026-07-06")          # move it to another day (no delete-and-recreate)
m.delete_entry(entry_id)        # soft delete
```

When Curtis says "actually that was closer to X," correct the specific entry — don't edit the food.

`correct_entry` **errors on any field it doesn't recognise** — a typo'd or non-correctable field
raises instead of silently succeeding, so a "success" always means the change landed.

### Reading it back — the day shape
`get_day(date)` returns `{"day": {...}, "totals", "estimation", "targets", "entries"}`:
- The day's tag is at **`day["day"]["kind"]`** — `"training"`, `"rest"`, or `"unspecified"`. There is
  **no top-level `day_kind`**; reading one yields `None` and misreads every tagged day as untagged.
  (A tagged day also narrows `targets` to that one kind; an unspecified day returns both — so if
  `targets` has a single kind, the day IS tagged, and `day["day"]["kind"]` will say which.)
- `totals` is the four-macro day sum; each of `entries` is the object below.

### Reading it back — the entry shape
`get_day(...)["entries"]` and `list_entries(...)["items"]` return the **identical** entry object —
same keys, every time:
- **`name`** — the entry's label (its own, or the linked food's name). It is `name` on *both*
  endpoints (there is no `foodName`).
- macros under their **schema.org names** (`proteinContent`, `carbohydrateContent`, ...) — the same
  names you write with. Every macro key is always present, `null` when unknown.

Read a macro by its exact schema.org key. A missing/mistyped key yields `None` **silently** — so
never conclude "no data" from a blank; if a value looks absent, re-check the key name against the
list above before reasoning from a blank.

## Multi-day questions — `get_range`

For anything spanning more than one day ("how's the fat trend this week," "am I consistently under
calories on rest days," pairing with the weight trend view), pull the whole span in one call instead
of looping `get_day`:

```python
days = m.get_range("2026-07-01", "2026-07-07")   # inclusive; one object per day, chronological
# each: {"date", "kind", "totals": {calories, proteinContent, fatContent, carbohydrateContent}, "targets"}
avg_fat = sum(d["totals"]["fatContent"] for d in days) / len(days)
```

- `totals` is the **four tracked macros** (calories/protein/fat/carb) — the same rollup shape
  `get_day` returns. Range does not expand to the other macros.
- **Empty days are present and zeroed**, never dropped — a zeroed day means "nothing logged," which
  is not the same as a missing row. Don't infer a day is missing; it never is.
- You get the daily **series**; do the aggregation the question needs (average, trend, over/under
  counts) yourself — the endpoint deliberately doesn't pre-average.

## Principles
- An estimate is information, never a warning. Log it plainly with a name + note.
- The client snapshots the numbers at log time — correcting a food later never rewrites past days.
- If Curtis is vague, estimate and say so (confidence `estimated` + note). Don't refuse to log because
  the input is fuzzy — that's the normal case.
