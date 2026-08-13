# Macro module — data model spec

CC implements this as `src/lib/db/schema.ts` (Drizzle, Postgres). The model is **closed**
— it's the output of a long design process and each decision has a reason. Implement it
as specified; if you think something is wrong, flag it, don't silently change it.

Core principle threaded through every table: **this is Curtis telling Claude what he ate
and Claude logging it. Input is often fuzzy and estimated. The schema is honest about
precision — it never presents a guess with the authority of a fact.**

Conventions that apply to every table: all timestamps are `timestamptz`; every table has
`id` (uuid, default random), `createdAt`, `updatedAt`, and a nullable `deletedAt` for
soft-delete (reads exclude soft-deleted rows by default). Nutrition fields follow the
numeric contract in CONVENTIONS.md §6 — numbers, grams for mass macros, kcal for energy,
schema.org names (`calories`, `proteinContent`, `fatContent`, `carbohydrateContent`,
`fiberContent`, `sugarContent`, `sodiumContent`, `saturatedFatContent`).

---

## Table: `macro_food` — the food catalog

A convenience for future logging, seeded from USDA (cached on first resolve) plus custom
foods. It is NOT the source of truth for what was eaten — entries are (see below).

- `name` (text, required) — human name as Curtis would say it.
- `source` (text, required) — `'usda'` (resolved from FoodData Central and cached here,
  `fdcId` set) or `'custom'` (Curtis-defined: unflavored whey, a specific bar).
- `fdcId` (integer, nullable) — USDA FoodData Central id when `source='usda'`, for dedupe
  and re-resolution. Unique index on `fdcId`.
- **Storage basis is always per-100g.** Macros below are per-100g values.
- `servingLabel` (text, nullable), `servingGrams` (real, nullable) — an optional household
  serving ("1 scoop" → grams) so Curtis can log in human units without gram math. This is
  INPUT SUGAR ONLY — it never changes the per-100g storage basis; the repo converts.
- Per-100g macros, each `real` and individually nullable (a food may know calories +
  protein but not fiber): the eight schema.org nutrition fields.
- Index on `name`.

**Why per-100g and not per-serving:** normalizing to one basis makes quantity math a
single code path. USDA is per-100g natively. The rounding cost on back-computed
per-serving foods is calorie-level noise, irrelevant at Curtis's precision (hitting a
band and a ~160g protein target, not competition-cutting).

## Table: `macro_batch` — a cooked batch: an instance, not a fact sheet

Added 2026-07-28 per the approved `docs/archive/batches-brief.md`. A cooked/prepared batch of food
("taco chicken") with **pinned per-100g macros** and an honest **lifecycle** — which is why it
is NOT a `macro_food` row: a catalog food is a timeless fact; a batch is made on a date, drawn
against, finished, and then never usable again (though history keeps pointing at it).

- `name` (text, required) — as Curtis says it. NOT unique: generations of the same name are
  separate rows, related by name + dates only (no `previousBatchId` chain).
- `madeOn` (date, required) — local calendar date cooked; orders generations.
- `finishedOn` (date, nullable) — null = ACTIVE; set = finished that date. **Status is derived
  from this, never stored.** Finished ≠ deleted: soft-delete remains for "shouldn't exist."
- `initialGrams` (real, nullable) — total cooked weight. Remaining = initialGrams − Σ(live
  entries' quantityGrams against the batch), derived, and **advisory** (family draws aren't
  logged).
- Per-100g macros — the eight schema.org fields, same floor as registration demands elsewhere:
  the four targeted macros are REQUIRED on create (a batch exists to pin numbers).
- `basis` (jsonb, nullable) — the derivation captured VERBATIM ({ totalCookedGrams,
  components: [...] }), the batch-level analog of `labelBasis`. Pure audit: never recomputed,
  components not FK-validated, NOT a recipe system.
- `note` (text, nullable).
- Indexes: `name`; (`finishedOn`, `madeOn`) for the active-first listing.

**Lifecycle rule (the honest part):** a finished batch rejects new draws — except entries with
`consumedOn <= finishedOn` (late logging must not force an unfinish/refinish dance). An entry
dated after the finish date is a contradiction → 409. Registering a same-name batch while one
is active doesn't block; the response surfaces the active match (`activeNameMatches`) so the
agent can ask "finish the old one?".

## Table: `macro_entry` — an immutable historical fact

The source of truth for what was consumed. **Macros are snapshotted at log time** (as
absolute values, quantity already applied) so later edits to the food catalog never
silently rewrite past days.

- `consumedOn` (date, required) — a **local calendar date, NOT a timestamp**. "What I ate
  on 2026-07-05" is a date question; timestamp+timezone math is how a late dinner lands on
  the wrong day. **No entry time is stored** — intra-day distribution is deliberately out
  of scope (no meal slots, no timestamps).
- `foodId` (uuid, nullable, FK → `macro_food.id`) — reference for "log that again." Nullable
  because an ad-hoc estimate may not correspond to any cataloged food.
- `batchId` (uuid, nullable, FK → `macro_batch.id`) — a draw against a cooked batch, parallel
  to `foodId` and **mutually exclusive with it** (DB check + Zod refine): an entry drew from
  the catalog, or from a batch, or from neither — never both. Snapshotting works identically
  (batch per-100g × grams at log time).
- `quantityGrams` (real, required).
- `confidence` (text, required) — **the schema's honesty about fuzziness.** Three COARSE
  buckets, deliberately not a 1–10 scale (the only decision it informs is "trust today's
  total or go tighten something," which is coarse):
  - `'measured'` — weighed, or a packaged/known serving
  - `'estimated'` — Claude inferred grams from Curtis's description
  - `'logged_serving'` — Curtis gave a household unit, converted to grams
- Snapshotted **absolute** macros for this entry (quantity applied): the eight nutrition
  fields, each `real`, nullable.
- `note` (text, nullable) — **load-bearing for estimated entries.** Captures what Curtis
  actually said ("couple handfuls almonds, big chicken thigh") so the estimate is auditable
  and re-estimable. On an estimate this is not decoration; it's the source of truth for why
  the numbers are what they are.
- Index on `consumedOn`.

**Why snapshot (the redundancy is deliberate):** a food log is a historical record and
history must be immutable. If entries only referenced the food, correcting a food's macros
later would retroactively rewrite every past day that used it, making daily totals
non-reproducible. Snapshotting freezes each entry as a fact; `foodId` survives only to
re-log. Correcting a specific bad entry is done via entry-level PATCH, deliberately, not by
editing the food.

## Table: `macro_day_tag` — RETIRED (day-type deprecation)

This table selected which calorie target applied to a day (`'training'` / `'rest'`, with
absence meaning unspecified). **It is retired.** Nothing reads or writes it: no schema, no
repo function, no route, no UI. The table and its rows remain purely as history — do not
wire it back up.

**Why it went:** it existed to drive calorie cycling, and calorie cycling was dropped —
both target profiles have held identical numbers since 2026-07-14. That left the field
answering only "did training happen that day," which the **lifting** and **rides** modules
now answer from the actual record. Those modules are reactive: they are asked, and nothing
pushes training days back into macros.

## Table: `macro_target_profile` — dated target records

Targets change over time without needing to edit every past/future day. **One target applies
to every day** — the latest profile with `effectiveFrom <= day` wins outright.

- `kind` (text, required) — RETIRED with day-type. Legacy rows carry `'training'`/`'rest'`;
  new rows carry a constant. Resolution ignores it entirely. Kept for history.
- `effectiveFrom` (date, required).
- Target macros: `calories`, `proteinContent`, `fatContent`, `carbohydrateContent` (real,
  nullable). `meta` (jsonb, nullable) for anything target-ish not yet modeled.
- Index on (`kind`, `effectiveFrom`).

**Why dated profiles instead of numbers-on-the-day:** if a day stored raw target numbers,
changing the target from 2800 to 2750 would mean editing every past day by hand. A day
points at the profile in effect on that date (latest `effectiveFrom <= day`); change the
profile once and every day from then on follows.

**Legacy rows share an `effectiveFrom`.** The old training/rest pairs mean two live rows can
tie on date; resolution breaks the tie by `createdAt` desc so it is deterministic. For days
on/after 2026-07-14 the tied rows are identical, so the resolved numbers are unambiguous.
For days *before* that, the pair differed (2800 vs 2200) and the resolved historical target
is now whichever row is newest — a deliberate consequence of collapsing to one target.
