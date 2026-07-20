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

/**
 * `device_tokens` — panel & service credentials (panel-contract §3). DISTINCT, by design, from the
 * skill API's static env tokens (`JMW_API_KEY`/`JMW_AGENT_TOKEN`): those keep guarding `/api/**`;
 * these — hashed, scoped, individually revocable — guard `/api/panel/**` only (two token systems,
 * see AGENTS.md). The raw token is shown once at creation and NEVER stored; only its sha256 hash is.
 * `revoked_at IS NOT NULL` ⇒ inactive (401), independent of the soft-delete `deleted_at`.
 */
export const deviceToken = pgTable(
  "device_tokens",
  {
    ...auditColumns(),
    // 'kitchen-panel' (panel:read + panel:write:shopping|daytype) | 'justmy-recipes' (panel:write:recipe).
    name: text("name").notNull(),
    // sha256(raw token) as hex. Looked up directly; the raw token never touches the database.
    tokenHash: text("token_hash").notNull(),
    // Granted scopes, e.g. {panel:read,panel:write:shopping}. Allowed values enforced by PANEL_SCOPES.
    scopes: text("scopes").array().notNull(),
    // Best-effort "last used" stamp. NEVER written on the version-poll path (would defeat autosuspend).
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // null = active. Set to revoke a device without deleting its audit row.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("device_tokens_token_hash_idx").on(t.tokenHash)]
);

/**
 * `panel_state` — the panel's single active recipe (panel-contract §6.2). Deliberately NOT the usual
 * `auditColumns` shape: it's a SINGLETON config row (`id` int, default 1), not an entry table. No
 * uuid, no soft-delete — the empty state is `active_recipe IS NULL`, not a deleted row. A second
 * panel would add a `panel_id` column (contract §10), not a second table.
 *
 * `active_recipe` is the RAW payload exactly as received (unknown JSON-LD + `notes`) — fields the
 * viewer doesn't render yet (e.g. `image`) ride along untouched. `active_recipe_norm` is the flat,
 * viewer-ready shape (contract §6.4), computed once on receive so the panel never branches on
 * schema.org raggedness. Snapshot semantics: what was sent is what's cooked until re-sent.
 */
export const panelState = pgTable("panel_state", {
  id: integer("id").primaryKey().default(1),
  activeRecipe: jsonb("active_recipe"), // raw payload as received, unmodified; null = nothing sent
  activeRecipeNorm: jsonb("active_recipe_norm"), // normalized view the panel renders (§6.4); null if none
  sourceUrl: text("source_url"),
  setAt: timestamp("set_at", { withTimezone: true }), // when the active recipe was last set; null if none
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * `lifting_session` — one row per Hevy workout (lifting module, the first INGESTION module). The
 * facts originate in Hevy and arrive over the webhook + API pull; `hevyId` is the natural key.
 * `rawPayload` keeps the verbatim workout JSON so skipped fields can be re-derived later. This row
 * is STABLE across re-pulls (upserted by `hevyId`, never deleted by a re-pull) — which is why the
 * annotation note (below) can hold a plain FK to it. See docs/lifting-model.md.
 */
export const liftingSession = pgTable(
  "lifting_session",
  {
    ...auditColumns(),
    // The Hevy workout id + natural key. Partial-unique among live rows (upsert, never duplicate).
    hevyId: text("hevy_id").notNull(),
    title: text("title"),
    // Session start — the journal sort key. Duration is derived (endedAt − startedAt), never stored.
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Hevy's own workout-level note — DISTINCT from our `session_notes` annotation (that's ours).
    description: text("description"),
    // Hevy's `updated_at`; lets a re-pull skip the child rebuild when it hasn't advanced.
    hevyUpdatedAt: timestamp("hevy_updated_at", { withTimezone: true }),
    // The verbatim Hevy workout JSON, stored losslessly.
    rawPayload: jsonb("raw_payload").notNull(),
  },
  (t) => [
    index("lifting_session_started_at_idx").on(t.startedAt),
    uniqueIndex("lifting_session_hevy_id_key")
      .on(t.hevyId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `lifting_exercise` — one row per exercise instance within a session. A NORMALIZED PROJECTION of
 * `rawPayload`, rebuilt wholesale on re-pull (delete+reinsert inside the upsert batch) — so it
 * carries NO soft-delete of its own: `id` + `createdAt` only. Cascades from the session.
 */
export const liftingExercise = pgTable(
  "lifting_exercise",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liftingSession.id, { onDelete: "cascade" }),
    // Order within the session.
    index: integer("index").notNull(),
    // Hevy's STABLE exercise id — what threads a lift across sessions (progression & PRs). Nullable
    // only defensively; the API supplies it on every exercise.
    exerciseTemplateId: text("exercise_template_id"),
    title: text("title").notNull(),
    notes: text("notes"),
    // Hevy's superset grouping id (co-performed exercises).
    supersetGroup: integer("superset_group"),
  },
  (t) => [
    index("lifting_exercise_session_id_index_idx").on(t.sessionId, t.index),
    index("lifting_exercise_template_id_idx").on(t.exerciseTemplateId),
  ]
);

/**
 * `lifting_set` — one row per set. Same rebuilt-projection rules as `lifting_exercise` (no
 * soft-delete). `sessionId` is denormalized so per-session volume is a single-table scan. Only
 * `set_type = 'normal'` counts as a working set for volume/e1RM/PRs. Any of weight/reps/rpe/
 * distance/duration may be null (a timed cardio set carries only `duration_seconds`).
 */
export const liftingSet = pgTable(
  "lifting_set",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => liftingExercise.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liftingSession.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    // 'normal' | 'warmup' | 'failure' | 'dropset' (Hevy `type`). Enforced by Zod, not a DB enum.
    setType: text("set_type").notNull(),
    weightKg: real("weight_kg"),
    reps: integer("reps"),
    rpe: real("rpe"),
    distanceMeters: real("distance_meters"),
    durationSeconds: integer("duration_seconds"),
  },
  (t) => [index("lifting_set_exercise_id_idx").on(t.exerciseId)]
);

/**
 * `lifting_session_note` — the annotation layer: the ONLY table this module writes to from a
 * surface, and untouched by a re-pull. Full audit columns (this is OUR data — soft-delete +
 * updatedAt). 1:1 with a session (partial-unique on `session_id`). `session_notes`/`quality` are
 * Curtis's; `interpretation`/`focus` are Claude's; `interpretedAt` drives the un-interpreted queue.
 * Ownership is a CONVENTION (CONVENTIONS §1), not a DB constraint.
 */
export const liftingSessionNote = pgTable(
  "lifting_session_note",
  {
    ...auditColumns(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liftingSession.id, { onDelete: "cascade" }),
    sessionNotes: text("session_notes"),
    interpretation: text("interpretation"),
    // Set whenever `interpretation` is written; its presence is the `interpreted` flag.
    interpretedAt: timestamp("interpreted_at", { withTimezone: true }),
    // A `liftingFocus` value; allowed values enforced by Zod.
    focus: text("focus"),
    // Curtis's subjective 1..5 score; enforced by Zod.
    quality: integer("quality"),
  },
  (t) => [
    uniqueIndex("lifting_session_note_session_id_key")
      .on(t.sessionId)
      .where(sql`${t.deletedAt} is null`),
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
export type DeviceToken = typeof deviceToken.$inferSelect;
export type NewDeviceToken = typeof deviceToken.$inferInsert;
export type PanelState = typeof panelState.$inferSelect;
export type NewPanelState = typeof panelState.$inferInsert;
export type LiftingSession = typeof liftingSession.$inferSelect;
export type NewLiftingSession = typeof liftingSession.$inferInsert;
export type LiftingExercise = typeof liftingExercise.$inferSelect;
export type NewLiftingExercise = typeof liftingExercise.$inferInsert;
export type LiftingSet = typeof liftingSet.$inferSelect;
export type NewLiftingSet = typeof liftingSet.$inferInsert;
export type LiftingSessionNote = typeof liftingSessionNote.$inferSelect;
export type NewLiftingSessionNote = typeof liftingSessionNote.$inferInsert;
