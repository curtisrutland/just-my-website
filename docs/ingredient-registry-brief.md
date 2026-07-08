# Ingredient Registry — Scoping Brief

**Platform:** justmy.website
**Author:** Curtis (scoped) / Claude (drafted)
**Date:** 2026-07-08
**Status:** Scoping — for CC/CD handoff after review

---

## Problem this solves

Logging a smoothie (or any multi-component food) currently re-derives per-gram macros
from Claude's memory on every log. Memory drifts, so the *same product* gets a
*different number* on different days. Concrete instance: a near-identical smoothie
logged 47g protein one day and 34g the next — the food didn't change, the estimation
did. The 13g swing was entirely Claude-side estimation churn on three branded/label
items (Ripple, Sports Research whey, Icelandic Provisions skyr) whose values were
eyeballed rather than pinned.

The fix is to reuse at the **ingredient** level, not the recipe level. Recipes are the
wrong unit — there are too many minor smoothie variations to enumerate as recipes, and
a recipe-level pin forces you to capture combinations. Ingredients are the atoms that
recur across every variation; resolve each product **once**, reuse everywhere.

This is the same pattern `resolve_usda` already implements for USDA foods
(search → resolve → cache-on-first-resolve). The registry generalizes that caching to
**branded / label-scanned items** USDA doesn't cover cleanly.

---

## Key finding: most of this already exists

The macro API already has a per-100g food catalog that is currently underused:

| Existing (`/api/macros`) | Method | What it does |
|---|---|---|
| `GET /foods` | `list_foods(q, limit, offset)` | Search catalog foods by name |
| `POST /foods` | `create_food(name, source, fdc_id?, serving_label?, serving_grams?, **macros)` | Create a per-100g catalog food |
| `POST /usda/resolve` | `resolve_usda(fdc_id)` | Resolve + cache a USDA food |
| entry linkage | `foodId` on an entry | An entry can already reference a catalog food |

So `create_food` already stores: `name`, `source`, optional `fdcId`,
`servingLabel` + `servingGrams`, and per-100g macros. And entries can already link to a
food by `foodId`.

**Recommendation: extend `/foods`, do not build a parallel `/ingredients` table.**
A second catalog would fork the source of truth and desync from the entry-linkage that
already exists. Everything below is specified as *additive fields + better search/dedupe*
on the existing catalog, not a new store.

Gaps to close on the existing catalog:
1. No **category** (needed to narrow matches so "yogurt" doesn't collide across brands).
2. No **brand** (needed to group variants and dedupe).
3. No **tags** (freeform, for Curtis's own querying later).
4. `source` IS a controlled enum, but only two coarse values (`usda | custom`) — no
   **provenance/trust** granularity, so a scanned label and a proxy-guess look identical.
   (Corrected from the brief's first draft, which wrongly said `source` was an untyped
   string. Fix is to *expand the enum*, not add a field — see the source/provenance
   decision below.)
5. No **label basis captured as data** (serving_label/serving_grams exist, but the
   *printed serving macros* aren't stored, so a per-100g value can't be audited back to
   the label it came from).
6. Search is name-only; no category filter, no dedupe-on-write check.

---

## Data model (additive to the `/foods` row)

Store macros **per 100g, always** — the log path is then pure arithmetic
(`grams × value/100`). Keep the original label so the /100g is auditable and a mis-scan
is catchable.

```
Food (existing row, extended)
  id                string        (existing)
  name              string        (existing)  canonical display name
  source            enum          (EXPANDED)  usda | scanned | proxy | estimated
                                              — provenance IS the source; one axis, no
                                                separate `confidence` field. See below.
  fdcId             int?          (existing)  set when source = usda (else must be null)
  servingLabel      string?       (existing)  e.g. "1 scoop", "1 cup", "1 container"
  servingGrams      float?        (existing)  grams for one serving

  # per-100g macros (existing — schema.org names, same as everywhere)
  calories, proteinContent, fatContent, carbohydrateContent,
  fiberContent?, sugarContent?, sodiumContent?, saturatedFatContent?

  # NEW
  brand             string?       groups variants; used in dedupe + search
  category          enum(string)  REQUIRED on new writes; narrows matching
  tags              string[]      freeform; NOT a controlled vocabulary (yet)
  labelBasis        object?       the printed label, stored verbatim for audit:
                                    { servingLabel, servingGrams,
                                      calories, proteinContent, ... }  <- AS PRINTED
  createdAt/updatedAt (existing)
```

### Category (required, controlled — small closed list)
Category does the heavy lifting for match-narrowing, so it's the one enum worth pinning
up front. Start deliberately small; add values only when a real ingredient doesn't fit:

```
plant-milk | dairy-milk | yogurt | protein-powder | fruit | vegetable |
nut-butter | oil-fat | grain | meat | seafood | condiment | sweetener |
egg | legume | beverage | cheese | other
```

`other` is the escape hatch so a write is never blocked on category modeling.
(`egg | legume | beverage | cheese` added to the brief's original list per Curtis's
review — day-one coverage for common non-smoothie whole foods.)

### Tags (freeform — do NOT model up front)
Tags are for *Curtis's* later querying ("my low-fat liquids"), not for matching.
Ship them as a freeform string array. **Resist designing a controlled tag vocabulary
until the pain is real** — the up-front guess will be wrong, same reason recipes aren't
the right unit. Category + brand already do the matching work.

### source / provenance (RESOLVED: expand the existing `source` enum)
The skyr error persisted because a *proxy* (Greek-yogurt stand-in) was indistinguishable
from a real value. Make provenance first-class.

**Decision (Curtis):** the food `source` field is ALREADY a controlled enum
(`usda | custom`), and `confidence` is ALREADY used at the *entry* level
(`measured | estimated | logged_serving`). So provenance goes into `source` — one axis,
no new field, no name-collision with entry-confidence. `custom` retires; its meaning
splits across the trust-graded values:

- `source = "usda"` — resolved from FoodData Central. `fdcId` required. High trust, generic.
- `source = "scanned"` — from a real label Curtis showed. Highest trust.
- `source = "proxy"` — deliberately using a *different* product's values as a stand-in
  (e.g. Greek yogurt for skyr). **Visibly a guess. Upgradeable.**
- `source = "estimated"` — Claude's own knowledge, no label. Lowest trust.

Migration: existing `custom` rows (seed foods, Claude-defined, no label) map to
`estimated` — the honest value for what they are. The `fdcId` refinement generalizes from
"custom foods carry no fdcId" to "**non-usda** foods carry no fdcId". `create_food`'s
default `source` moves from `custom` → `estimated`; entry-level `confidence` is untouched.

A `proxy`/`estimated` row is a placeholder that should be *upgraded* to `scanned` when
the label finally appears — via `update_ingredient`, keeping the same `id` so the entry
history that snapshotted from it stays intact.

### labelBasis — capture the label, don't discard it
When registering from a scan, store the printed serving + printed macros verbatim, then
compute /100g from them. This makes every /100g value auditable back to its source and
lets a bad scan be caught later. Do **not** throw the label away after normalizing.

---

## Skill contract (mirror manage-macros so the log path composes)

Method names and the search→resolve→cache shape deliberately mirror the USDA path and
the existing `MacrosClient`, so the smoothie-logging flow reads the same whether an
ingredient is USDA or branded. **Decision (Curtis):** ADD these four ingredient-named
methods; KEEP the existing `create_food` / `list_foods` as low-level primitives (they
gain the new `category`/`brand` params but stay as the thin catalog accessors).

```python
# --- read / match ---------------------------------------------------------
search_ingredient(query, category=None, brand=None, limit=10) -> {"items": [...]}
    # fuzzy name match, optionally filtered by category/brand.
    # returns CANDIDATES with per-100g macros + source (source carries the trust signal).
    # NEVER auto-picks — Claude confirms, same discipline as usda search→resolve.

resolve_ingredient(id) -> {...full row...}
    # returns the full row. Cache-on-resolve (like resolve_usda) so repeated
    # logging in one session doesn't re-fetch.

# --- write ----------------------------------------------------------------
register_ingredient(
    name, category, per100g={calories, proteinContent, ...},
    *, brand=None, tags=None, source,
    serving_label=None, serving_grams=None, label_basis=None,
) -> {...row..., "duplicate_candidates": [...]}
    # REQUIRED: name, category, per100g (at least cal+protein+fat+carb), source.
    # `source` is the expanded provenance enum (scanned|proxy|estimated|usda) — it
    # carries the trust signal; there is no separate `confidence` arg.
    # dedupe-checks BEFORE insert: searches brand+category, and if a likely match
    # exists, returns it under `duplicate_candidates` instead of blindly inserting,
    # so Claude can ask "update #47 or create new?" rather than making
    # "Ripple" and "Ripple Unsweetened" a month apart.

update_ingredient(id, **fields) -> {...row...}
    # upgrade a proxy/estimated row to scanned; fix a value; add tags/brand.
    # same id — history preserved. Errors on unknown field (no silent no-op),
    # matching correct_entry's contract.
```

### Write-path rules
- **Dedupe on write is mandatory, not advisory.** `register_ingredient` must surface
  likely duplicates (same brand + category, fuzzy name) and let the caller choose
  update-vs-new. This is the single most important behavior for preventing registry rot.
- **Minimum to write a row:** `name`, `category`, `per100g` (cal/protein/fat/carb at
  least), `source` (the provenance/trust enum). Everything else (brand, tags, label_basis,
  serving) is optional-but-encouraged. Never block a write on complete tags.
- **Confirm, don't assume, on read.** `search_ingredient` returns candidates; the caller
  confirms which one. No auto-select — that's how the sweetened-vs-unsweetened error
  slips in.
- **Variants are separate rows.** Ripple Unsweetened and Ripple Sweetened are different
  /100g → different rows, sharing `brand="Ripple"`. The unsweetened/sweetened distinction
  is exactly what silently corrupted a prior log.

---

## Integration with manage-macros (the payoff)

Once an ingredient is in the registry, logging a smoothie becomes estimation-free:

```
for each component:
    search_ingredient(name, category)   -> confirm the row
    scale per-100g by today's weighed grams
log_entries([...scaled components...])  -> atomic, all-or-nothing
```

Two integration options for the linkage, in preference order:

1. **Link, don't copy (preferred).** The entry references the food via the existing
   `foodId`, and the macro snapshot is computed from the food's /100g × grams at log
   time. This reuses linkage that already exists and means "what did I log" always
   traces to a registry row.
   - Keep the existing **snapshot-at-log-time** semantics: correcting a food later must
     NOT rewrite past days (manage-macros already snapshots — preserve that).
2. **Compute-and-log (fallback).** If per-entry `foodId` linkage is awkward, Claude
   computes the scaled macros from the resolved row and logs them as normal absolute
   entries with a `note` naming the registry id. Less clean (no live trace) but requires
   zero macro-API change.

Either way the estimation step is *gone*: the number comes from a pinned row, not memory.

---

## What this fixes vs. what it doesn't

**Fixes (fully):** Claude-side estimation churn — same product yielding different numbers
on different days. After pinning, a number only moves if a *weight* moved, which is
correct. Also fixes the invisible-proxy problem (skyr-as-Greek-yogurt now visibly a
proxy, and upgradeable).

**Does NOT fix (be honest going in):** product reality churn. Ripple reformulates, banana
ripeness varies, scoop packing varies, container-scrape varies. Labels round to the
nearest 5. So values remain ~±5%. The registry buys **consistency and auditability**,
which is what's actually needed for decision-making — not lab-grade truth on a blended
whole-food drink. Consistency was the thing that was broken; this fixes that.

---

## Open decisions — RESOLVED (Curtis, 2026-07-08)

1. **Extend `/foods` vs. new `/ingredients` table** → **EXTEND.** Confirmed by the code:
   `macro_food` is the catalog, `macro_entry.foodId` already links entries to it, and
   `snapshotMacros()` already derives absolute macros from a food's per-100g × grams.
2. **Category enum** → brief's list **+ `egg | legume | beverage | cheese`** (day-one
   coverage for common non-smoothie whole foods). `other` stays the escape hatch.
3. **Linkage model** → **link-via-`foodId` (option 1).** Already implemented in
   `snapshotMacros()`; snapshot-at-log-time preserved. No macro-API change needed for it.
4. **`confidence` vs `source`** → **collapse into `source`.** Expand the existing enum to
   `usda | scanned | proxy | estimated`; no new field (avoids the entry-level `confidence`
   name-collision). `custom` retires → existing rows migrate to `estimated`.
5. **Skyr:** unchanged — still the concrete first `source="proxy"` → `"scanned"` upgrade
   to validate the flow, once the label is in hand. A validation step, not a build gate.

---

## Suggested build split (CC / CD)

- **API / data (CC):** migration adding `brand`, `category`, `tags`, `labelBasis` to the
  foods row + expanding the `source` enum (`usda|scanned|proxy|estimated`, `custom` rows →
  `estimated`, `fdcId` refinement generalized to non-usda); category enum; `search_ingredient`
  (fuzzy + filters); dedupe check in the register path; `update_ingredient` with
  unknown-field rejection.
- **Skill client (CC):** `search_ingredient` / `resolve_ingredient` (cache-on-resolve) /
  `register_ingredient` / `update_ingredient`, mirroring `MacrosClient` conventions and
  error discipline (loud on unknown fields, returns the row for inline verify).
- **manage-macros integration (CC):** the log-from-registry path (option 1 or 2 above),
  preserving snapshot-at-log-time.
- **No UI required for v1** — skill-first, matching the platform's API-first pattern. A
  web view of the registry is a later nicety, not a blocker.
