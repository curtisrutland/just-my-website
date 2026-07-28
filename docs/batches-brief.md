# Batches — Scoping Brief

**Platform:** justmy.website (macros module)
**Author:** Curtis (scoped) / Claude (drafted)
**Date:** 2026-07-28
**Status:** Scoping — for review; no code until approved

---

## Problem this solves

Curtis cooks in batches ("taco chicken", a pot of chili) and then eats from the batch
over several days. The macros for the batch are computed once — from weighed registry
ingredients at cook time — but today that computation lives in old conversation
transcripts. Logging "200g of the taco chicken" three days later means re-finding (or
worse, re-estimating) that math. Same failure mode the ingredient registry fixed for
branded products, one level up: **pre-calculated numbers that should be pinned are
being re-derived from memory.**

The current workaround stores batches as rows in the ingredient registry
(`macro_food`). That's the wrong home, and this brief makes them first-class:

- A catalog food is a **timeless fact** — Ripple Unsweetened is the same next month.
  A batch is an **instance**: made on a date, drawn against, finished, then never
  usable again — but still pointed to by every entry that drew from it.
- Batch rows pollute the catalog search + dedupe that `register_ingredient` depends
  on ("taco chicken" is not a food anyone should dedupe against), and none of the
  catalog's provenance semantics (`source`, `labelBasis`, `fdcId`) fit an instance.
- The catalog has no lifecycle, so a finished batch is indistinguishable from a
  current one — exactly the stale-numbers trap this module's honesty principle exists
  to prevent.

## The one honest idea

**A batch is an instance, not a fact sheet.** Pinned numbers with an honest
lifecycle: the API never lets a finished batch masquerade as current, and never lets
"no current batch" silently resolve to an old one.

---

## Decisions (Curtis, 2026-07-28)

1. **New `macro_batch` table** — not an extension of `macro_food`, not a wrapper
   around a hidden food row. Entries link via a new nullable `batchId`, parallel to
   `foodId`. Snapshot-at-log-time works identically.
2. **Remaining is derived from entries** — a batch optionally stores `initialGrams`;
   remaining = initialGrams − Σ(live entries' `quantityGrams` against it). No draw
   ledger. Remaining is therefore **advisory** (family servings aren't logged) and is
   presented as such, never as truth.
3. **Derivation is stored verbatim** — a `basis` jsonb (total cooked weight +
   component list as-computed), the batch-level analog of `labelBasis`. Pure audit;
   never recomputed; not a recipe system.
4. **Existing mis-stored batches migrate** — inventory the `macro_food` rows that are
   really batches (Curtis confirms the list), recreate them as (mostly finished)
   batch rows, repoint their entries' linkage, soft-delete the food rows.

---

## Data model

### New table: `macro_batch`

Standard conventions apply: uuid `id`, `createdAt`/`updatedAt`, nullable `deletedAt`
(soft-delete; reads exclude by default). Nutrition per CONVENTIONS §6 — numbers,
grams/kcal, schema.org names.

```
macro_batch
  name          text      required   "taco chicken" — as Curtis says it. NOT unique:
                                     generations of the same name are separate rows.
  madeOn        date      required   local calendar date cooked (orders generations)
  finishedOn    date      nullable   null = ACTIVE. Set = finished on that date.
                                     Status is DERIVED from this — never stored.
  initialGrams  real      nullable   total cooked weight, for remaining-tracking.
                                     Optional: a batch without it just has no gauge.

  # per-100g macros — same eight schema.org fields as macro_food
  calories, proteinContent, fatContent, carbohydrateContent,
  fiberContent?, sugarContent?, sodiumContent?, saturatedFatContent?

  basis         jsonb     nullable   the derivation, VERBATIM (see below)
  note          text      nullable
```

Indexes: `name`, and `(finishedOn, madeOn)` for the active-first listing.

Invariants (Zod + repo):
- `finishedOn`, when set, must be `>= madeOn`.
- per-100g minimum to register: calories + protein + fat + carbs (same floor as
  `register_ingredient`).

**Why per-100g and not per-batch totals:** one storage basis across the whole module
means the log path stays a single code path (`grams × value/100`). Registering a
batch requires knowing the total cooked weight anyway (you can't get /100g without
it), which is also what makes `initialGrams` nearly free to capture.

### `basis` — capture the math, don't discard it

```jsonc
{
  "totalCookedGrams": 1840,
  "components": [
    { "name": "chicken thighs, raw", "foodId": "…", "grams": 1600,
      "calories": 2288, "proteinContent": 274, … },   // absolute, as summed
    { "name": "taco seasoning", "grams": 40, … }
  ]
}
```

Stored as-derived, unnormalized. `foodId` references are informational — not
FK-validated, not live-linked, never recomputed. If a component was mis-weighed, the
basis makes the error findable; fixing it means PATCHing the batch's per-100g values
(future draws corrected; past entries keep their snapshots, per module policy).

### Change to `macro_entry`: `batchId`

- `batchId` (uuid, nullable, FK → `macro_batch.id`) — parallel to `foodId`.
- **Mutually exclusive with `foodId`** (Zod refine + DB check): an entry drew from
  the catalog, or from a batch, or from neither (ad-hoc estimate). Never both.
- `snapshotMacros()` generalizes: absolute macros derive from the linked batch's
  per-100g × grams exactly as they do from a food's. Snapshot-at-log-time preserved —
  finishing or correcting a batch never rewrites past days.
- `EntryView` gains `batchId` (always present, null when absent) on **every** read
  endpoint — one view schema, per the field-parity rule. `name` resolution becomes
  `coalesce(entry.name, food.name, batch.name)`.

### Lifecycle rules (the honest part)

- **Finish** = PATCH `{ finishedOn: "YYYY-MM-DD" }` (PATCH is the modify verb; no
  bespoke `/finish` route). Undo = PATCH `{ finishedOn: null }`.
- **A finished batch rejects new draws** — with one honest exception: an entry with
  `consumedOn <= finishedOn` is allowed, so late logging ("forgot Tuesday's serving")
  doesn't force an unfinish/refinish dance. An entry dated after the finish date is a
  contradiction and is rejected with an error naming the batch and its `finishedOn`.
- **Registering a same-name batch while one is still active** doesn't block, but the
  response surfaces the active match under `active_name_matches` (the dedupe-on-write
  pattern from `register_ingredient`) — usually it means the old one should be
  finished, and the agent asks.
- Soft-delete remains for "this row shouldn't exist"; **finished ≠ deleted.**

---

## API surface (`/api/macros/batches`)

Token-only, standard envelope/pagination, same as every macros route.

| Route | Method | Behavior |
|---|---|---|
| `/batches` | GET | `q` (fuzzy name), `status` = `active \| finished \| all` (default **all**), paged. **Ordered active-first, then `madeOn` desc** — the current generation is always item one, older generations follow clearly flagged. |
| `/batches` | POST | Register. Returns the row + `active_name_matches`. |
| `/batches/[id]` | GET | Full row **+ derived** `consumedGrams`, `remainingGrams` (null unless `initialGrams`), `drawCount`. |
| `/batches/[id]` | PATCH | Corrections, finish/unfinish. Strict schema — unknown field errors. |
| `/batches/[id]` | DELETE | Soft-delete (hard DELETE key-gated as usual). |

**The "taco chicken" lookup, resolved:** `GET /batches?q=taco+chicken` answers all
three cases in one call with no special shape — a current batch exists (it's first,
`finishedOn: null`); only old ones exist (everything returned is visibly finished →
agent says so and offers to register a new one); nothing exists (empty). Each row
carries `finishedOn` so staleness is data, not inference.

Every item in list/get responses includes a derived `status: "active" | "finished"`
so the agent never has to infer it from `finishedOn` nullness.

Panel: batch writes do **not** `bump("health")` — same reasoning as food-catalog
writes (entries snapshot; a batch write changes no day's totals).

## Skill contract (manage-macros additions)

Mirrors the ingredient methods; same error discipline (loud on unknown fields,
returns the row for inline verify), field names verbatim from the API.

```python
search_batches(q=None, status="all", limit=20) -> {"items": [...], "count": n}
    # active-first ordering; each item carries status/finishedOn/madeOn.
    # NEVER auto-picks — agent confirms, same discipline as ingredients.

get_batch(id) -> {...row..., "consumedGrams", "remainingGrams", "drawCount"}

register_batch(name, made_on, per100g={calories, proteinContent, ...},
               *, initial_grams=None, basis=None, note=None)
    -> {...row..., "active_name_matches": [...]}
    # REQUIRED: name, made_on, per100g (cal+protein+fat+carb floor).
    # If active_name_matches is non-empty, ask "finish the old one?"

finish_batch(id, finished_on=<today>) -> {...row...}
update_batch(id, **fields) -> {...row...}   # errors on unknown field

# log path: log_entry/log_entries gain batch_id (exclusive with food_id);
# macros snapshot from the batch exactly as from a food.
```

The logging flow becomes: `search_batches("taco chicken")` → confirm the active row →
`log_entry(batch_id=…, quantity_grams=200, confidence="measured")`. No transcript
archaeology, no re-estimation.

## Migration (one-time, Curtis confirms the inventory)

1. Query live `macro_food` rows that are batch-shaped; Claude proposes the list,
   **Curtis confirms** which are truly batches (and their made/finished dates, best
   effort).
2. For each: create a `macro_batch` row (per-100g values carried over; `basis` only
   if reconstructable — else `note: "migrated from registry; basis predates it"`),
   almost certainly finished.
3. Repoint those foods' entries: `foodId → batchId`. Safe — snapshots are untouched;
   only linkage moves, and resolved entry `name`s are preserved via the batch name.
4. Soft-delete the food rows. Catalog search comes back clean.

## Anti-scope (the deliberate noes)

- **No recipe system.** `basis` is a verbatim audit blob — components are not
  FK-validated, not recomputed, not reusable as a template. If "cook this again"
  automation is ever wanted, it's a new scoping conversation.
- **No draw ledger / no multi-person accounting.** Remaining is advisory,
  derived only from Curtis's logged entries. Stated plainly in responses, not
  papered over.
- **No fraction-of-batch units.** Grams only, like everywhere else. "A quarter of
  it" is agent-side arithmetic against `initialGrams`, before the write.
- **No generation linking.** Same-name batches relate by name + dates only; no
  `previousBatchId` chain.
- **No freshness/expiry/location tracking.** Finished-or-not is the only lifecycle.
- **No UI in v1.** Skill-first, matching the registry precedent. A batches web view
  is a later nicety.

## Open / deferred

- Whether `remainingGrams` should ever warn ("you've drawn 110% of initialGrams") —
  deferred; the number itself is enough for the agent to notice.
- A `tags` column (registry has one) — deferred until a real query needs it; YAGNI
  for instances.

## Suggested build split

- **API / data (CC):** migration (table + `macro_entry.batchId` + XOR check); Zod
  schemas (`batchCreateSchema`, `batchPatchSchema`, `batchViewSchema` with derived
  status); repo (`createBatch` with active-name-match check, `listBatches`
  active-first, `getBatchById` with derived consumption, finish-guard in
  `createEntry`/`createEntries`/`patchEntry`); routes; OpenAPI fragment registered in
  `scripts/build-openapi.ts` + `npm run openapi:build`.
- **Skill client (CC):** the five methods above in manage-macros + `batch_id` on the
  log path; re-upload noted to Curtis when the zip is ready.
- **Migration (CC + Curtis):** inventory → confirm → migrate script → verify counts.
- **Docs:** this brief finalized; `macro-model.md` updated with the table +
  `batchId`; BACKLOG updated.
