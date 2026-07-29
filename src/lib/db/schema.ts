import { sql } from "drizzle-orm";
import {
  check,
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
 * `macro_batch` — a cooked/prepared batch of food: an INSTANCE with a lifecycle, not a timeless
 * catalog fact (which is why it is not a `macro_food` row). Made on a date, drawn against via
 * entries, finished, then never usable again — but still pointed to by every entry that drew
 * from it. Storage basis is per-100g, same as the catalog. See docs/batches-brief.md.
 */
export const macroBatch = pgTable(
  "macro_batch",
  {
    ...auditColumns(),
    // As Curtis says it ("taco chicken"). NOT unique: generations of the same name are separate
    // rows, related by name + dates only.
    name: text("name").notNull(),
    // LOCAL calendar date cooked. Orders generations of the same name.
    madeOn: date("made_on", { mode: "string" }).notNull(),
    // null = ACTIVE; set = finished on that date. Status is DERIVED from this, never stored.
    // Finished ≠ deleted: a finished batch stays referenced by history; soft-delete remains
    // for "this row shouldn't exist".
    finishedOn: date("finished_on", { mode: "string" }),
    // Total cooked weight, for advisory remaining-tracking (remaining = this − Σ drawn entries).
    initialGrams: real("initial_grams"),
    // The derivation, VERBATIM: { totalCookedGrams, components: [...] } as-computed at cook time.
    // Pure audit, the batch-level analog of labelBasis — never recomputed, components not
    // FK-validated. NOT a recipe system.
    basis: jsonb("basis"),
    note: text("note"),
    // Per-100g macros.
    ...nutritionColumns(),
  },
  (t) => [
    index("macro_batch_name_idx").on(t.name),
    // Serves the active-first listing (finished_on nulls + made_on ordering).
    index("macro_batch_finished_made_idx").on(t.finishedOn, t.madeOn),
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
    // A draw against a cooked batch — parallel to foodId, mutually exclusive with it (an entry
    // drew from the catalog, or from a batch, or from neither; never both — see check below).
    batchId: uuid("batch_id").references(() => macroBatch.id),
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
  (t) => [
    index("macro_entry_consumed_on_idx").on(t.consumedOn),
    check("macro_entry_food_xor_batch", sql`${t.foodId} is null or ${t.batchId} is null`),
  ]
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

/**
 * `lifting_goal` — the module-level goal statement: prose describing what the training is FOR right
 * now. Not part of the annotation layer (that's per-session); this sits beside the sessions and is
 * the frame they're read against. Dated records, same pattern as `macro_target_profile`: the goal in
 * force on any date is the latest `effectiveFrom` on/before it, so superseding a goal never erases
 * what the previous block was aiming at — an old interpretation stays legible against the goal that
 * actually applied when it was written. One live goal per date (partial-unique), so re-stating the
 * goal the same day replaces rather than stacks. Written by BOTH surfaces (web + agent).
 */
export const liftingGoal = pgTable(
  "lifting_goal",
  {
    ...auditColumns(),
    // Local calendar date the goal takes effect. A future date post-dates a planned block change.
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    // The goal itself — freeform prose, deliberately unstructured (see docs/lifting-model.md).
    statement: text("statement").notNull(),
  },
  (t) => [
    index("lifting_goal_effective_from_idx").on(t.effectiveFrom),
    uniqueIndex("lifting_goal_effective_from_key")
      .on(t.effectiveFrom)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `ride` — one row per ingested Garmin FIT activity (rides module, the second ingestion module
 * and the first with a BINARY input). Every parsed column is an ingested fact — immutable from
 * the surfaces, rewritten only by reprocessing the raw file (kept forever in Vercel Blob at
 * `blobKey`). Exactly two columns are surface-writable: `name` and `note` (the human layer).
 * Named `ride` deliberately — any Garmin activity lands here (`sport` keeps it honest), but
 * riding is the module's reason for existing. See docs/rides-model.md.
 */
export const ride = pgTable(
  "ride",
  {
    ...auditColumns(),
    // sha256 of the FIT bytes — the primary dedupe key. Re-uploading the same file (the v2
    // daemon will, forever) is idempotent: return the existing row, never duplicate.
    fileHash: text("file_hash").notNull(),
    // Session start (UTC instant) — the sort key. With deviceSerial, the secondary dedupe:
    // the same activity re-exported with different bytes.
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    // The ride's LOCAL calendar date, from the file's own activity.localTimestamp (the device
    // knew where it was) — stored because it cannot be recomputed from startedAt without a
    // timezone guess. This is the log's grouping date ("Tuesday's ride").
    localDate: date("local_date", { mode: "string" }).notNull(),
    // Where the raw FIT lives in Vercel Blob: `rides/<fileHash>.fit` (deterministic → a
    // crashed ingest retries idempotently).
    blobKey: text("blob_key").notNull(),
    // Device identity, from fileIdMesgs. `deviceProduct` prefers the readable garminProduct
    // string ("instinct3Amoled50mm") over the numeric product code.
    deviceManufacturer: text("device_manufacturer"),
    deviceProduct: text("device_product"),
    deviceSerial: text("device_serial"),
    // Garmin's classification, verbatim ("cycling"/"mountain"), plus the device profile name
    // ("MTB") — the display fallback of choice for unnamed rides.
    sport: text("sport").notNull(),
    subSport: text("sub_sport"),
    sportProfileName: text("sport_profile_name"),
    // Durations are the only universally-present summary facts. Seconds, SI throughout —
    // display units (mi/ft/mph) are a UI concern, like lb in lifting.
    elapsedSeconds: real("elapsed_seconds").notNull(),
    movingSeconds: real("moving_seconds").notNull(),
    // Everything below is nullable — honesty about what a given device captured (a watch ride
    // has no power; a trainer ride has no GPS; a hike has neither).
    distanceMeters: real("distance_meters"),
    totalAscentMeters: real("total_ascent_meters"),
    totalDescentMeters: real("total_descent_meters"),
    avgPowerWatts: real("avg_power_watts"),
    maxPowerWatts: real("max_power_watts"),
    // Stored because the DEVICE computed it (an ingested fact); this module computes no power
    // model of its own.
    normalizedPowerWatts: real("normalized_power_watts"),
    avgHeartRate: integer("avg_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    avgCadence: real("avg_cadence"),
    maxCadence: real("max_cadence"),
    avgSpeedMps: real("avg_speed_mps"),
    maxSpeedMps: real("max_speed_mps"),
    // kcal — the same energy unit as macros.
    calories: integer("calories"),
    avgTemperatureC: real("avg_temperature_c"),
    // The session-referenced timeInZone message VERBATIM: seconds-per-zone plus the boundaries
    // it was computed with. Kept because it's a histogram of measurements (avgHeartRate with
    // shape), not a model score — and self-describing, so a later zone-config change never
    // falsifies old rides.
    timeInHrZone: jsonb("time_in_hr_zone"),
    // The decoded session message verbatim — where Garmin's training-load numbers, MTB
    // grit/flow totals, and the GPS bounding box deliberately stay: present in data, absent
    // from schema and UI. The Blob is the authoritative raw; this is convenience.
    rawSession: jsonb("raw_session"),
    // The human layer — the ONLY surface-writable columns.
    name: text("name"),
    note: text("note"),
  },
  (t) => [
    index("ride_started_at_idx").on(t.startedAt),
    index("ride_sport_idx").on(t.sport),
    // Unique among live rows so a soft-deleted bad upload can be re-ingested.
    uniqueIndex("ride_file_hash_key")
      .on(t.fileHash)
      .where(sql`${t.deletedAt} is null`),
    // Same activity, different bytes (a re-export). NULL serials never collide (Postgres
    // treats index NULLs as distinct) — fileHash still catches exact dupes for them.
    uniqueIndex("ride_started_at_device_serial_key")
      .on(t.startedAt, t.deviceSerial)
      .where(sql`${t.deletedAt} is null`),
  ]
);

/**
 * `ride_stream` — the downsampled time series, 1:1 with a ride. A PROJECTION of the raw file,
 * rebuilt wholesale on reprocess (like lifting's exercise/set children) — so `id` + `createdAt`
 * only, no soft-delete; cascades from the ride. `data` holds aligned arrays keyed by channel
 * (`t` = seconds from start; null = gap — Garmin smart recording is irregular, 1–12 s observed).
 */
export const rideStream = pgTable(
  "ride_stream",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => ride.id, { onDelete: "cascade" }),
    // The downsample bucket width — 10 s in v1.
    resolutionSeconds: integer("resolution_seconds").notNull(),
    // { t: [...], heartRate: [...], lat: [...], ... } — absent key = channel never recorded.
    data: jsonb("data").notNull(),
  },
  (t) => [uniqueIndex("ride_stream_ride_id_key").on(t.rideId)]
);

export type MacroFood = typeof macroFood.$inferSelect;
export type NewMacroFood = typeof macroFood.$inferInsert;
export type MacroEntry = typeof macroEntry.$inferSelect;
export type NewMacroEntry = typeof macroEntry.$inferInsert;
export type MacroBatch = typeof macroBatch.$inferSelect;
export type NewMacroBatch = typeof macroBatch.$inferInsert;
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
export type LiftingGoal = typeof liftingGoal.$inferSelect;
export type NewLiftingGoal = typeof liftingGoal.$inferInsert;
export type Ride = typeof ride.$inferSelect;
export type NewRide = typeof ride.$inferInsert;
export type RideStream = typeof rideStream.$inferSelect;
export type NewRideStream = typeof rideStream.$inferInsert;
