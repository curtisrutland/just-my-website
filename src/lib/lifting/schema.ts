import * as z from "zod";

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
export const liftingFocus = z.enum(["push", "pull", "legs", "upper", "lower", "full", "accessory", "other"]);
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
