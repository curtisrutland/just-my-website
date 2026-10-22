import * as z from "zod";
import { calendarDate, isoInstant, paginatedSchema } from "@/lib/http/view-schemas";

/**
 * Lifting module — Zod schemas + normalization. The SINGLE SOURCE OF TRUTH for validation
 * (CONVENTIONS §1, §5). Two families live here:
 *
 *  1. INGESTION — parse a Hevy workout payload (`GET /v1/workouts/{id}`) into our normalized
 *     shape. The facts originate in Hevy and are effectively read-only once ingested; there is
 *     deliberately NO `liftingSessionCreateSchema` (sessions are never authored, only pulled).
 *  2. ANNOTATION — the ONLY surface write (`lifting_session_note`). Every field optional (PATCH),
 *     `.strict()`. Both write surfaces (token API, web server action) call this before the repo.
 *
 * Weights are canonical kg as plain numbers (CONVENTIONS §6 — "lb" is a display concern).
 * See docs/lifting-model.md; it wins on any conflict.
 */

// --- Annotation enum (the closed vocabulary) ---

/**
 * `focus` — a single coarse tag Claude sets so sessions are filterable. NOT a body-part taxonomy;
 * deliberately small. `other` is the escape hatch so a write is never blocked on modeling.
 */
export const liftingFocus = z.enum(["push", "pull", "upper", "lower", "full", "accessory", "other"]);
export type LiftingFocus = z.infer<typeof liftingFocus>;

// --- Ingestion: the Hevy workout payload (subset we model; extra keys ignored, raw kept) ---

/**
 * A single Hevy set. ANY of weight/reps/rpe/distance/duration can be null — a timed cardio set
 * (Elliptical, Warm Up) carries only `duration_seconds`; RPE is unused in Curtis's history and is
 * always null. Only `type: "normal"` counts as a working set downstream. Unknown `type` values
 * degrade to `"normal"` via `.catch` rather than rejecting the whole workout.
 */
export const hevySetSchema = z.object({
  index: z.number().int(),
  type: z.enum(["normal", "warmup", "failure", "dropset"]).catch("normal"),
  weight_kg: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().nullable().optional(),
  rpe: z.number().nullable().optional(),
  distance_meters: z.number().nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
});

export const hevyExerciseSchema = z.object({
  index: z.number().int(),
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  exercise_template_id: z.string().nullable().optional(),
  superset_id: z.number().int().nullable().optional(),
  sets: z.array(hevySetSchema),
});

/**
 * A full Hevy workout. Timestamps arrive in mixed formats (`+00:00` offset and `Z` with millis) —
 * `z.coerce.date()` absorbs both. Extra top-level keys (routine_id, created_at, …) are ignored by
 * the parse but preserved verbatim in `rawPayload` at normalize time.
 */
export const hevyWorkoutSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  start_time: z.coerce.date(),
  end_time: z.coerce.date().nullable().optional(),
  updated_at: z.coerce.date().nullable().optional(),
  exercises: z.array(hevyExerciseSchema),
});

export type HevyWorkout = z.infer<typeof hevyWorkoutSchema>;

// --- Normalized shape (snake_case → our camelCase rows; the input to the repo upsert) ---

export type NormalizedSet = {
  index: number;
  setType: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

export type NormalizedExercise = {
  index: number;
  exerciseTemplateId: string | null;
  title: string;
  notes: string | null;
  supersetGroup: number | null;
  sets: NormalizedSet[];
};

export type NormalizedSession = {
  hevyId: string;
  title: string | null;
  startedAt: Date;
  endedAt: Date | null;
  description: string | null;
  hevyUpdatedAt: Date | null;
  /** The verbatim Hevy workout JSON, stored losslessly so skipped fields can be re-derived later. */
  rawPayload: unknown;
  exercises: NormalizedExercise[];
};

/**
 * Map a parsed Hevy workout into the normalized session the repo upserts. `raw` is the untouched
 * input, kept verbatim as `rawPayload` (never the re-serialized parse — timestamps etc. stay exact).
 */
export function normalizeWorkout(parsed: HevyWorkout, raw: unknown): NormalizedSession {
  return {
    hevyId: parsed.id,
    title: parsed.title ?? null,
    startedAt: parsed.start_time,
    endedAt: parsed.end_time ?? null,
    description: parsed.description ?? null,
    hevyUpdatedAt: parsed.updated_at ?? null,
    rawPayload: raw,
    exercises: parsed.exercises.map((ex) => ({
      index: ex.index,
      exerciseTemplateId: ex.exercise_template_id ?? null,
      title: ex.title,
      notes: ex.notes ?? null,
      supersetGroup: ex.superset_id ?? null,
      sets: ex.sets.map((set) => ({
        index: set.index,
        setType: set.type,
        weightKg: set.weight_kg ?? null,
        reps: set.reps ?? null,
        rpe: set.rpe ?? null,
        distanceMeters: set.distance_meters ?? null,
        durationSeconds: set.duration_seconds ?? null,
      })),
    })),
  };
}

// --- Annotation: the ONLY surface write. Every field optional (PATCH), `.strict()` ---

/**
 * The annotation PATCH — `session_notes`/`quality` are Curtis's (web), `interpretation`/`focus` are
 * Claude's (skill). Ownership is a convention, not enforced here: either surface may write any field
 * through this schema (CONVENTIONS §1). The repo stamps `interpretedAt = now()` whenever
 * `interpretation` is present. `.strict()` rejects unknown keys so a typo'd field is a 400, not a
 * silent no-op (matches the skill-client parity rule).
 */
export const liftingAnnotationPatchSchema = z
  .object({
    sessionNotes: z.string().trim().max(4000).nullable(),
    interpretation: z.string().trim().max(8000).nullable(),
    focus: liftingFocus.nullable(),
    quality: z.number().int().min(1).max(5).nullable(),
  })
  .partial()
  .strict();

export type LiftingAnnotationPatch = z.infer<typeof liftingAnnotationPatchSchema>;

// --- Goal statement: the module-level write (both surfaces) ---

/**
 * The goal statement — prose describing what the training is FOR right now. Deliberately
 * UNSTRUCTURED: one required `statement`, no horizon/target-lift/priority fields. The value is in
 * Curtis saying it in his own words and Claude reading it; a taxonomy here would be a schema to
 * maintain and an invitation to scope creep (docs/lifting-model.md, "the anti-scope").
 *
 * `effectiveFrom` defaults to today at the repo boundary (not here — the schema stays pure, and the
 * default is Curtis's timezone, which `todayISO()` owns). Setting it forward post-dates a planned
 * block change; setting it back corrects when a goal actually started.
 */
const goalShape = {
  statement: z.string().trim().min(1).max(4000),
  effectiveFrom: z.iso.date().optional(),
};

export const liftingGoalCreateSchema = z.object(goalShape).strict();

/** Edit an existing dated goal in place (fix the wording, or re-date it). */
export const liftingGoalPatchSchema = z.object(goalShape).partial().strict();

export type LiftingGoalCreate = z.infer<typeof liftingGoalCreateSchema>;
export type LiftingGoalPatch = z.infer<typeof liftingGoalPatchSchema>;

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---
// Instants are ISO strings, weights canonical kg, and the audit columns are dropped
// (docs/lifting-model.md, read shape).

/** A PR is per lift identity (`exerciseTemplateId`); two kinds — top working weight, or best e1RM. */
export const prKindSchema = z.enum(["weight", "e1rm"]);
export const prFlagSchema = z.object({
  /** The exercise title as Hevy renders it, for display ("Bench Press (Barbell)"). */
  lift: z.string(),
  templateId: z.string().nullable(),
  kind: prKindSchema,
  /** The value that set the PR (kg for `weight`, kg for `e1rm`), rounded to 1 dp. */
  value: z.number(),
});

/** The derived headline stats for a session — all computed in the repo, never stored. */
export const sessionDerivedSchema = z.object({
  tonnageKg: z.number(),
  workingSets: z.number().int(),
  totalReps: z.number().int(),
  exerciseCount: z.number().int(),
  /** Best e1RM across the session's exercises (kg), null if no working set has weight+reps. */
  topE1rmKg: z.number().nullable(),
  /** Session duration in minutes (endedAt − startedAt), null when endedAt is missing. */
  durationMin: z.number().nullable(),
  prs: z.array(prFlagSchema),
});

/** The annotation layer projected for read. `interpreted` = `interpretedAt` is set. */
export const sessionAnnotationSchema = z.object({
  sessionNotes: z.string().nullable(),
  quality: z.number().int().nullable(),
  focus: liftingFocus.nullable(),
  interpretation: z.string().nullable(),
  interpreted: z.boolean(),
});

/** One set, as read. `pr` marks the set that achieved a PR (weight or e1RM) for its lift. */
export const setViewSchema = z.object({
  index: z.number().int(),
  setType: z.string(),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  rpe: z.number().nullable(),
  distanceMeters: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  pr: z.boolean(),
});

/** One exercise instance, as read, with its per-exercise derived e1RM. */
export const exerciseViewSchema = z.object({
  index: z.number().int(),
  title: z.string(),
  exerciseTemplateId: z.string().nullable(),
  notes: z.string().nullable(),
  supersetGroup: z.number().int().nullable(),
  /** Best Epley e1RM over working sets (kg), null when none is computable. */
  e1rmKg: z.number().nullable(),
  /** True when the best set's reps > 12 (Epley degrades at high reps) — render muted, not trusted. */
  e1rmUnreliable: z.boolean(),
  sets: z.array(setViewSchema),
});

/** The goal statement as read — what the training is FOR. `effectiveFrom` is the only time on it. */
export const goalViewSchema = z.object({
  id: z.uuid(),
  effectiveFrom: calendarDate,
  statement: z.string(),
});

/** A session summary — the journal-card shape (no exercises). */
export const sessionSummarySchema = z.object({
  id: z.uuid(),
  hevyId: z.string(),
  title: z.string().nullable(),
  startedAt: isoInstant,
  endedAt: isoInstant.nullable(),
  /** Hevy's own workout-level note (distinct from our `sessionNotes`). */
  description: z.string().nullable(),
  derived: sessionDerivedSchema,
  annotation: sessionAnnotationSchema,
});

/**
 * A full session — summary plus the exercise → set tree, plus the goal in force ON THIS SESSION'S
 * DATE (not necessarily today's), so an interpretation can never be written goal-blind. Null when no
 * goal was set by then.
 */
export const sessionDetailSchema = sessionSummarySchema.extend({
  exercises: z.array(exerciseViewSchema),
  goal: goalViewSchema.nullable(),
});

/** `GET /api/lifting/sessions`: the page of summaries plus today's goal. */
export const sessionListSchema = paginatedSchema(sessionSummarySchema).extend({ goal: goalViewSchema.nullable() });

/** One point in a lift's progression series. */
export const liftProgressionPointSchema = z.object({
  sessionId: z.uuid(),
  startedAt: isoInstant,
  e1rmKg: z.number().nullable(),
  topSetKg: z.number().nullable(),
});

/** The progression series for one lift identity (`exerciseTemplateId`), oldest → newest. */
export const liftProgressionSchema = z.object({
  templateId: z.string(),
  /** The lift's most recent title. */
  title: z.string().nullable(),
  points: z.array(liftProgressionPointSchema),
});
