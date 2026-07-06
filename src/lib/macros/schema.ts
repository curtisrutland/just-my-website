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

/** 'usda' (resolved from FoodData Central + cached) or 'custom' (Curtis-defined). */
export const foodSource = z.enum(["usda", "custom"]);
/** The schema's honesty about fuzziness — three coarse buckets, not a 1-10 scale. */
export const entryConfidence = z.enum(["measured", "estimated", "logged_serving"]);
/** Which calorie target applies. Extensible (e.g. 'big_training') via a future migration. */
export const dayKind = z.enum(["training", "rest"]);

// --- Shared primitives ---

/** A LOCAL calendar date 'YYYY-MM-DD'. Strict ISO date — never a datetime, never coerced. */
const calendarDate = z.iso.date();

/** A non-empty, trimmed human string. */
const name = z.string().trim().min(1);

/** A stored macro value: a finite, non-negative number, or null/absent when unknown. */
const macro = z.number().finite().nonnegative().nullish();

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

const foodBase = z
  .object({
    name,
    source: foodSource,
    fdcId: z.int().positive().nullish(),
    // Optional household serving (input sugar only; never changes the per-100g storage basis).
    servingLabel: z.string().trim().min(1).nullish(),
    servingGrams: z.number().finite().positive().nullish(),
    ...nutritionShape, // per-100g
  })
  .strict();

/**
 * Create a catalog food. A USDA-sourced food must carry its `fdcId` (for dedupe/re-resolution);
 * a custom food must not.
 */
export const foodCreateSchema = foodBase
  .refine((d) => d.source !== "usda" || d.fdcId != null, {
    error: "usda foods require an fdcId",
    path: ["fdcId"],
  })
  .refine((d) => d.source !== "custom" || d.fdcId == null, {
    error: "custom foods must not carry an fdcId",
    path: ["fdcId"],
  });

/** Partial update. Cross-field invariants aren't re-checked here — the DB holds the rest. */
export const foodPatchSchema = foodBase.partial();

// --- Entry (an immutable historical fact) ---

/**
 * Log a consumed food. Macros are the ABSOLUTE snapshot for this entry (quantity already
 * applied). They may be supplied directly (an ad-hoc estimate) or left absent for the repo to
 * snapshot from `foodId`'s per-100g values × quantity. `note` is load-bearing on estimates.
 */
export const entryCreateSchema = z
  .object({
    // A concise display label for what was eaten. The `note` stays for the fuzziness/reasoning.
    name: name.nullish(),
    consumedOn: calendarDate,
    foodId: z.uuid().nullish(),
    quantityGrams: z.number().finite().positive(),
    confidence: entryConfidence,
    ...nutritionShape, // absolute (quantity applied)
    note: z.string().trim().min(1).nullish(),
  })
  .strict();

export const entryPatchSchema = entryCreateSchema.partial();

// --- Day tag (three-valued by design; absence = unspecified) ---

/** Tag a day's kind. Upsert semantics: one live tag per day (partial-unique in the DB). */
export const dayTagCreateSchema = z
  .object({
    day: calendarDate,
    kind: dayKind,
  })
  .strict();

export const dayTagPatchSchema = dayTagCreateSchema.partial();

// --- Target profile (dated target records) ---

export const targetProfileCreateSchema = z
  .object({
    kind: dayKind,
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
export type EntryCreate = z.infer<typeof entryCreateSchema>;
export type EntryPatch = z.infer<typeof entryPatchSchema>;
export type DayTagCreate = z.infer<typeof dayTagCreateSchema>;
export type DayTagPatch = z.infer<typeof dayTagPatchSchema>;
export type TargetProfileCreate = z.infer<typeof targetProfileCreateSchema>;
export type TargetProfilePatch = z.infer<typeof targetProfilePatchSchema>;
export type MacroSet = {
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};
