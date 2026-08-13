import * as z from "zod";

/**
 * Macro module — Zod schemas + normalization. The SINGLE SOURCE OF TRUTH for validation.
 * Both write surfaces (token API route, web UI server action) call these before touching the
 * repo; the per-module OpenAPI fragment is generated from them. Nothing writes without passing
 * through here (CONVENTIONS §1, §5).
 *
 * Enforces the nutrition numeric contract (CONVENTIONS §6): every macro is a `z.number()`,
 * which structurally rejects unit-strings like "22 g" — units are a display concern, never
 * stored. Grams for mass macros, kcal for energy, schema.org field names.
 */

// --- Enums (the closed vocabularies) ---

/**
 * A food's PROVENANCE / trust, one axis (ingredient-registry, see docs/ingredient-registry-brief.md):
 *  - 'usda'      resolved from FoodData Central (carries an fdcId). High trust, generic.
 *  - 'scanned'   from a real label Curtis showed. Highest trust.
 *  - 'proxy'     a deliberate stand-in (e.g. Greek yogurt for skyr) — visibly a guess, upgradeable.
 *  - 'estimated' Claude's own knowledge, no label. Lowest trust.
 * Replaces the old 'usda'|'custom' pair; 'custom' rows migrated to 'estimated' (0004). There is NO
 * separate `confidence` field on foods — `source` carries trust (entry-level `confidence` is unrelated).
 */
export const foodSource = z.enum(["usda", "scanned", "proxy", "estimated"]);
/**
 * A small, closed category vocabulary — narrows matching so "yogurt" doesn't collide across brands.
 * REQUIRED on new food writes; `other` is the escape hatch so a write is never blocked on modeling.
 * Start small; add values only when a real ingredient genuinely doesn't fit.
 */
export const foodCategory = z.enum([
  "plant-milk",
  "dairy-milk",
  "yogurt",
  "protein-powder",
  "fruit",
  "vegetable",
  "nut-butter",
  "oil-fat",
  "grain",
  "meat",
  "seafood",
  "condiment",
  "sweetener",
  "egg",
  "legume",
  "beverage",
  "cheese",
  "other",
]);
/** The schema's honesty about ENTRY fuzziness — three coarse buckets, not a 1-10 scale. Distinct
 * from `foodSource`: this is per-logged-entry, that is per-catalog-food. */
export const entryConfidence = z.enum(["measured", "estimated", "logged_serving"]);

// --- Shared primitives ---

/** A LOCAL calendar date 'YYYY-MM-DD'. Strict ISO date — never a datetime, never coerced. */
const calendarDate = z.iso.date();

/** A non-empty, trimmed human string. */
const name = z.string().trim().min(1);

/** A stored macro value: a finite, non-negative number, or null/absent when unknown. */
const macro = z.number().finite().nonnegative().nullish();

/**
 * A macro value AS READ BACK: the same number, but the key is ALWAYS present — `null` when
 * unknown, never absent. Read shapes use this (not `macro`) so a consumer that asks for a field
 * gets an explicit `null`, not silent `undefined` from a missing key.
 */
const macroRead = z.number().finite().nonnegative().nullable();

/**
 * The eight schema.org NutritionInformation fields. Reused for `macro_food` (per-100g) and
 * `macro_entry` (absolute). Each is individually nullable — a food may know calories + protein
 * but not fiber.
 */
const nutritionShape = {
  calories: macro,
  proteinContent: macro,
  fatContent: macro,
  carbohydrateContent: macro,
  fiberContent: macro,
  sugarContent: macro,
  sodiumContent: macro,
  saturatedFatContent: macro,
};

// --- Food ---

/**
 * The printed label captured VERBATIM (as printed, per serving) so the per-100g values a food
 * stores stay auditable back to their source scan — a mis-scan can be caught later. Not normalized:
 * this is the raw label, not the storage basis. Every field optional (labels vary in completeness).
 */
export const labelBasisSchema = z
  .object({
    servingLabel: z.string().trim().min(1).nullish(),
    servingGrams: z.number().finite().positive().nullish(),
    ...nutritionShape, // AS PRINTED, per serving (not per-100g)
  })
  .strict();

const foodBase = z
  .object({
    name,
    source: foodSource,
    fdcId: z.int().positive().nullish(),
    // Groups product variants and drives dedupe (e.g. "Ripple" over sweetened/unsweetened).
    brand: z.string().trim().min(1).nullish(),
    // Narrows matching. Nullish in the base so USDA foods (matched by fdcId) and patches need not
    // carry one; the create refinement below requires it for every NON-usda food.
    category: foodCategory.nullish(),
    // Freeform, for Curtis's own querying later — NOT a matching key, NOT a controlled vocabulary.
    tags: z.array(z.string().trim().min(1)).nullish(),
    // The source label, kept for audit (see labelBasisSchema).
    labelBasis: labelBasisSchema.nullish(),
    // Optional household serving (input sugar only; never changes the per-100g storage basis).
    servingLabel: z.string().trim().min(1).nullish(),
    servingGrams: z.number().finite().positive().nullish(),
    ...nutritionShape, // per-100g
  })
  .strict();

/**
 * Create a catalog food / register an ingredient. Cross-field invariants:
 *  - a USDA food MUST carry its `fdcId` (for dedupe/re-resolution); any non-usda food must NOT;
 *  - every non-usda food MUST carry a `category` (it's the match-narrowing key — USDA foods are
 *    matched by fdcId instead, so category is optional there).
 */
export const foodCreateSchema = foodBase
  .refine((d) => d.source !== "usda" || d.fdcId != null, {
    error: "usda foods require an fdcId",
    path: ["fdcId"],
  })
  .refine((d) => d.source === "usda" || d.fdcId == null, {
    error: "non-usda foods must not carry an fdcId",
    path: ["fdcId"],
  })
  .refine((d) => d.source === "usda" || d.category != null, {
    error: "a category is required for non-usda foods",
    path: ["category"],
  });

/** Partial update. Cross-field invariants aren't re-checked here — the DB holds the rest. */
export const foodPatchSchema = foodBase.partial();

// --- Batch (an instance with a lifecycle, not a timeless catalog fact) ---

/**
 * How a batch's per-100g numbers were derived, captured VERBATIM at cook time — the batch-level
 * analog of `labelBasis`. Pure audit: components are informational (foodId not FK-validated),
 * never recomputed, never reusable as a template. NOT a recipe system (batches-brief anti-scope).
 * Component macros are ABSOLUTE (as summed into the batch), not per-100g.
 */
export const batchBasisSchema = z
  .object({
    totalCookedGrams: z.number().finite().positive().nullish(),
    components: z
      .array(
        z
          .object({
            name,
            foodId: z.uuid().nullish(),
            grams: z.number().finite().positive().nullish(),
            ...nutritionShape, // absolute, as summed
          })
          .strict()
      )
      .nullish(),
  })
  .strict();

const batchBase = z
  .object({
    // As Curtis says it ("taco chicken"). Generations of the same name are separate rows.
    name,
    // Local calendar date cooked — orders generations.
    madeOn: calendarDate,
    // null/absent = ACTIVE. Set = finished on that date; finished ≠ deleted.
    finishedOn: calendarDate.nullish(),
    // Total cooked weight; enables advisory remaining-tracking. Optional — without it a batch
    // simply has no gauge.
    initialGrams: z.number().finite().positive().nullish(),
    basis: batchBasisSchema.nullish(),
    note: z.string().trim().min(1).nullish(),
    ...nutritionShape, // per-100g
  })
  .strict();

/**
 * Register a batch. Invariants:
 *  - the four targeted macros are the registration floor — a batch exists to pin numbers, so a
 *    batch without them is a bug, not a partial fact (unlike catalog foods);
 *  - a batch can't finish before it was made.
 */
export const batchCreateSchema = batchBase
  .refine(
    (d) =>
      d.calories != null && d.proteinContent != null && d.fatContent != null && d.carbohydrateContent != null,
    { error: "a batch requires calories, proteinContent, fatContent, and carbohydrateContent (per-100g)" }
  )
  .refine((d) => d.finishedOn == null || d.finishedOn >= d.madeOn, {
    error: "finishedOn must be on or after madeOn",
    path: ["finishedOn"],
  });

/** Partial update (finish = { finishedOn }, undo = { finishedOn: null }). The finishedOn>=madeOn
 *  cross-check needs the stored row, so it lives in the repo. */
export const batchPatchSchema = batchBase.partial();

/** A batch as READ BACK: every key present, plus `status` DERIVED from finishedOn so the agent
 *  never has to infer staleness from null-ness. Shared by list items and the detail view. */
export const batchViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(["active", "finished"]),
    madeOn: calendarDate,
    finishedOn: calendarDate.nullable(),
    initialGrams: z.number().finite().positive().nullable(),
    basis: batchBasisSchema.nullable(),
    note: z.string().nullable(),
    calories: macroRead,
    proteinContent: macroRead,
    fatContent: macroRead,
    carbohydrateContent: macroRead,
    fiberContent: macroRead,
    sugarContent: macroRead,
    sodiumContent: macroRead,
    saturatedFatContent: macroRead,
  })
  .strict();

/** The detail view (GET /batches/[id]): the row plus derived consumption. `remainingGrams` is
 *  ADVISORY (family draws aren't logged) and null unless the batch recorded initialGrams. */
export const batchDetailViewSchema = batchViewSchema
  .extend({
    consumedGrams: z.number().finite().nonnegative(),
    remainingGrams: z.number().finite().nullable(),
    drawCount: z.int().nonnegative(),
  })
  .strict();

// --- Entry (an immutable historical fact) ---

/**
 * Log a consumed food. Macros are the ABSOLUTE snapshot for this entry (quantity already
 * applied). They may be supplied directly (an ad-hoc estimate) or left absent for the repo to
 * snapshot from the linked food's — or batch's — per-100g values × quantity. `note` is
 * load-bearing on estimates.
 */
const entryBase = z
  .object({
    // A concise display label for what was eaten. The `note` stays for the fuzziness/reasoning.
    name: name.nullish(),
    consumedOn: calendarDate,
    foodId: z.uuid().nullish(),
    // A draw against a cooked batch — parallel to foodId, mutually exclusive with it.
    batchId: z.uuid().nullish(),
    quantityGrams: z.number().finite().positive(),
    confidence: entryConfidence,
    ...nutritionShape, // absolute (quantity applied)
    note: z.string().trim().min(1).nullish(),
  })
  .strict();

export const entryCreateSchema = entryBase.refine((d) => d.foodId == null || d.batchId == null, {
  error: "an entry links to a food or a batch, never both",
  path: ["batchId"],
});

/** Partial update. The food-XOR-batch invariant isn't re-checked here — the DB check holds. */
export const entryPatchSchema = entryBase.partial();

/**
 * Batch log: an array of the SAME per-entry payloads `entryCreateSchema` accepts. Validated as a
 * whole up front — if any element fails, the request is rejected before a single row is written
 * (the repo then inserts the lot in one atomic statement). Capped so a batch stays a "meal", not a
 * bulk import.
 */
export const entryCreateBatchSchema = z.array(entryCreateSchema).min(1).max(100);

/**
 * The canonical READ shape for a logged entry — IDENTICAL across every read endpoint
 * (`GET /entries` items and the day-rollup `entries`). One entry schema, one set of keys, so
 * knowledge of a field name transfers between endpoints (this is the fix for the get_day/
 * list_entries `foodName`-vs-`name` split). `name` is the resolved label: the entry's own label,
 * falling back to the linked food's name. Every macro key is always present (null when unknown).
 */
export const entryViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    consumedOn: calendarDate,
    foodId: z.uuid().nullable(),
    batchId: z.uuid().nullable(),
    quantityGrams: z.number().finite().positive(),
    confidence: entryConfidence,
    note: z.string().nullable(),
    calories: macroRead,
    proteinContent: macroRead,
    fatContent: macroRead,
    carbohydrateContent: macroRead,
    fiberContent: macroRead,
    sugarContent: macroRead,
    sodiumContent: macroRead,
    saturatedFatContent: macroRead,
  })
  .strict();

// --- Target profile (dated target records) ---

/** One target applies to every day. Day-type/calorie-cycling was retired: the `kind` column still
 *  exists in the DB (history is kept) but is no longer part of the write contract or resolution. */
export const targetProfileCreateSchema = z
  .object({
    effectiveFrom: calendarDate,
    calories: macro,
    proteinContent: macro,
    fatContent: macro,
    carbohydrateContent: macro,
    // For anything target-ish not yet modeled.
    meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

export const targetProfilePatchSchema = targetProfileCreateSchema.partial();

// --- Inferred input types ---

export type FoodCreate = z.infer<typeof foodCreateSchema>;
export type FoodPatch = z.infer<typeof foodPatchSchema>;
export type BatchCreate = z.infer<typeof batchCreateSchema>;
export type BatchPatch = z.infer<typeof batchPatchSchema>;
export type BatchBasis = z.infer<typeof batchBasisSchema>;
export type BatchView = z.infer<typeof batchViewSchema>;
export type BatchDetailView = z.infer<typeof batchDetailViewSchema>;
export type FoodCategory = z.infer<typeof foodCategory>;
export type FoodSource = z.infer<typeof foodSource>;
export type LabelBasis = z.infer<typeof labelBasisSchema>;
export type EntryCreate = z.infer<typeof entryCreateSchema>;
export type EntryPatch = z.infer<typeof entryPatchSchema>;
export type EntryView = z.infer<typeof entryViewSchema>;
export type EntryCreateBatch = z.infer<typeof entryCreateBatchSchema>;
export type TargetProfileCreate = z.infer<typeof targetProfileCreateSchema>;
export type TargetProfilePatch = z.infer<typeof targetProfilePatchSchema>;
export type MacroSet = {
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};
