import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Macro module — Drizzle schema. Implements docs/macro-model.md (a CLOSED spec).
 *
 * Conventions applied to every table (macro-model.md preamble):
 *  - id (uuid, random default), createdAt, updatedAt, nullable deletedAt (soft-delete).
 *  - All instant timestamps are `timestamptz`.
 *  - Calendar dates (`consumedOn`, `day`, `effectiveFrom`) are Postgres `date` in STRING
 *    mode — they are LOCAL calendar dates, never timestamps. Storing/returning a plain
 *    'YYYY-MM-DD' string keeps them out of any JS Date/timezone math, which is the whole
 *    point of the date-not-timestamp decision in the spec.
 *  - Nutrition fields follow CONVENTIONS §6: numbers (`real`), grams/kcal, schema.org names.
 *
 * Column builders are wrapped in factory functions so each table gets fresh builder
 * instances (Drizzle builders are stateful; sharing one instance across tables is a footgun).
 */

/** id + audit/soft-delete columns shared by every table. */
const auditColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * The eight schema.org NutritionInformation fields, each `real` and individually nullable
 * (a food may know calories + protein but not fiber). Reused by `macro_food` (per-100g) and
 * `macro_entry` (absolute, quantity applied).
 */
const nutritionColumns = () => ({
  calories: real("calories"),
  proteinContent: real("protein_content"),
  fatContent: real("fat_content"),
  carbohydrateContent: real("carbohydrate_content"),
  fiberContent: real("fiber_content"),
  sugarContent: real("sugar_content"),
  sodiumContent: real("sodium_content"),
  saturatedFatContent: real("saturated_fat_content"),
});

/**
 * `macro_food` — the food catalog / ingredient registry. Seeded from USDA (cached on first
 * resolve) plus branded/label-scanned and estimated foods. NOT the source of truth for what
 * was eaten (that's `macro_entry`, which snapshots from here). Storage basis is always
 * per-100g; `servingLabel`/`servingGrams` are input sugar only. See docs/ingredient-registry-brief.md.
 */
export const macroFood = pgTable(
  "macro_food",
  {
    ...auditColumns(),
    name: text("name").notNull(),
    // PROVENANCE / trust, one axis: 'usda' (resolved from FoodData Central) | 'scanned' (from a
    // real label) | 'proxy' (a deliberate stand-in, e.g. Greek yogurt for skyr — visibly a guess)
    // | 'estimated' (Claude's memory, no label). Stored as text; allowed values enforced by Zod.
    source: text("source").notNull(),
    // USDA FoodData Central id when source='usda', for dedupe and re-resolution.
    fdcId: integer("fdc_id"),
    // Brand — groups product variants ("Ripple" over sweetened/unsweetened) and drives dedupe.
    brand: text("brand"),
    // Category — narrows matching so "yogurt" doesn't collide across brands. A small closed
    // vocabulary enforced by Zod; REQUIRED on new writes but nullable in the DB for legacy rows.
    category: text("category"),
    // Freeform tags for Curtis's own later querying — deliberately NOT a controlled vocabulary.
    tags: text("tags").array(),
    // The printed label, stored verbatim for audit: { servingLabel, servingGrams, calories,
    // proteinContent, ... } AS PRINTED. Lets every per-100g value trace back to its source scan.
    labelBasis: jsonb("label_basis"),
    // Optional household serving so Curtis can log in human units; the repo converts to grams.
    // INPUT SUGAR ONLY — never changes the per-100g storage basis.
    servingLabel: text("serving_label"),
    servingGrams: real("serving_grams"),
    // Per-100g macros.
    ...nutritionColumns(),
  },
  (t) => [
    index("macro_food_name_idx").on(t.name),
    // Narrows dedupe/search scans to a brand+category cohort.
    index("macro_food_category_brand_idx").on(t.category, t.brand),
    // Unique among live rows only, so a soft-deleted USDA food can be re-cached.
    uniqueIndex("macro_food_fdc_id_key")
      .on(t.fdcId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `macro_entry` — an immutable historical fact: the source of truth for what was consumed.
 * Macros are SNAPSHOTTED at log time as absolute values (quantity already applied) so later
 * edits to the food catalog never silently rewrite past days.
 */
export const macroEntry = pgTable(
  "macro_entry",
  {
    ...auditColumns(),
    // A short display label for the entry ("grilled chicken breast", "3 large eggs"). Makes an
    // entry self-describing even with no linked food; falls back to the food's name in the rollup.
    name: text("name"),
    // A LOCAL calendar date, not a timestamp. No entry time is stored (no meal slots).
    consumedOn: date("consumed_on", { mode: "string" }).notNull(),
    // Reference for "log that again". Nullable: an ad-hoc estimate may match no cataloged food.
    foodId: uuid("food_id").references(() => macroFood.id),
    quantityGrams: real("quantity_grams").notNull(),
    // The schema's honesty about fuzziness — three coarse buckets:
    // 'measured' | 'estimated' | 'logged_serving'. Enforced by the Zod schema.
    confidence: text("confidence").notNull(),
    // Snapshotted ABSOLUTE macros for this entry (quantity applied).
    ...nutritionColumns(),
    // Load-bearing for estimated entries: captures what Curtis actually said, so the estimate
    // is auditable and re-estimable. On an estimate this is the source of truth for the numbers.
    note: text("note"),
  },
  (t) => [index("macro_entry_consumed_on_idx").on(t.consumedOn)]
);

/**
 * `macro_day_tag` — selects which calorie target applies to a day. A macro input (which
 * target), NOT a workout record. A row means the day's kind is KNOWN; ABSENCE means
 * UNSPECIFIED, not "rest" — these are different states and the rollup treats them differently.
 */
export const macroDayTag = pgTable(
  "macro_day_tag",
  {
    ...auditColumns(),
    day: date("day", { mode: "string" }).notNull(),
    // 'training' | 'rest'. Extensible (e.g. 'big_training'); never a continuous adjustment.
    kind: text("kind").notNull(),
  },
  (t) => [
    // One live tag per day; partial so a day can be re-tagged after a soft-delete.
    uniqueIndex("macro_day_tag_day_key")
      .on(t.day)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `macro_target_profile` — dated target records. A day's `kind` points at the profile of that
 * kind in effect on that date (latest effectiveFrom <= day); change the profile once and all
 * days of that kind follow, without editing any day.
 */
export const macroTargetProfile = pgTable(
  "macro_target_profile",
  {
    ...auditColumns(),
    kind: text("kind").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    calories: real("calories"),
    proteinContent: real("protein_content"),
    fatContent: real("fat_content"),
    carbohydrateContent: real("carbohydrate_content"),
    // For anything target-ish not yet modeled.
    meta: jsonb("meta"),
  },
  (t) => [
    index("macro_target_profile_kind_effective_from_idx").on(t.kind, t.effectiveFrom),
  ]
);

/**
 * `weight_entry` — one body-weight measurement per day (weight module). A day's weight is noise;
 * the trend (a rolling average) is the truth — the average is derived in the repo, never stored.
 */
export const weightEntry = pgTable(
  "weight_entry",
  {
    ...auditColumns(),
    // Local calendar date of the weigh-in. One live weight per day (partial-unique below).
    measuredOn: date("measured_on", { mode: "string" }).notNull(),
    // Body weight in POUNDS, stored as a plain number ("lb" is display-only).
    weight: real("weight").notNull(),
    note: text("note"),
  },
  (t) => [
    index("weight_entry_measured_on_idx").on(t.measuredOn),
    uniqueIndex("weight_entry_measured_on_key")
      .on(t.measuredOn)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `shopping_item` — the single flat shopping list (shopping module). One grouping level:
 * `category` is a FREEFORM STRING, never an entity — grouping happens at read time. No quantity
 * column (the `text` line carries "2 dozen eggs"); no normalization, so deliberately NO uniqueness
 * constraint — an item is not an identity ("milk" may legitimately appear twice). Removal is the
 * standard `deletedAt` soft-delete, NOT a status value: `status` answers "where on the list?",
 * `deletedAt` answers "does this record exist?".
 */
export const shoppingItem = pgTable(
  "shopping_item",
  {
    ...auditColumns(),
    // Freeform group label ("Produce", "Frozen"). Grouped + sorted case-insensitively at read time.
    category: text("category").notNull(),
    // The freeform item line, carrying its own quantity detail ("2 dozen eggs"). No quantity column.
    text: text("text").notNull(),
    // 'needed' | 'bought'. Stored as text; the allowed values are enforced by the Zod schema.
    status: text("status").notNull().default("needed"),
    // Set to now() when checked off (needed -> bought); cleared on un-check. Drives the 7-day window.
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [
    // Active-list read: live + needed, grouped/ordered by category then text.
    index("shopping_item_active_idx")
      .on(t.category, t.text)
      .where(sql`${t.deletedAt} is null and ${t.status} = 'needed'`),
    // Recently-bought read: live + bought, windowed + ordered by checkedAt.
    index("shopping_item_bought_idx")
      .on(t.checkedAt)
      .where(sql`${t.deletedAt} is null and ${t.status} = 'bought'`),
  ]
);

export type MacroFood = typeof macroFood.$inferSelect;
export type NewMacroFood = typeof macroFood.$inferInsert;
export type MacroEntry = typeof macroEntry.$inferSelect;
export type NewMacroEntry = typeof macroEntry.$inferInsert;
export type MacroDayTag = typeof macroDayTag.$inferSelect;
export type NewMacroDayTag = typeof macroDayTag.$inferInsert;
export type MacroTargetProfile = typeof macroTargetProfile.$inferSelect;
export type NewMacroTargetProfile = typeof macroTargetProfile.$inferInsert;
export type WeightEntry = typeof weightEntry.$inferSelect;
export type NewWeightEntry = typeof weightEntry.$inferInsert;
export type ShoppingItem = typeof shoppingItem.$inferSelect;
export type NewShoppingItem = typeof shoppingItem.$inferInsert;
