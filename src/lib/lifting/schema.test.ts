import { describe, expect, it } from "vitest";
import { hevyWorkoutSchema, liftingAnnotationPatchSchema, normalizeWorkout } from "./schema";

const rawWorkout = {
  id: "hevy-123",
  title: "Push Day A",
  description: "felt strong",
  start_time: "2026-07-15T17:02:00+00:00",
  end_time: "2026-07-15T18:10:00Z",
  updated_at: "2026-07-15T18:11:00.123Z",
  routine_id: "r-1", // extra top-level key — ignored by parse, preserved in rawPayload
  exercises: [
    {
      index: 0,
      title: "Bench Press (Barbell)",
      exercise_template_id: "tmpl-bench",
      superset_id: null,
      notes: null,
      sets: [
        { index: 0, type: "warmup", weight_kg: 60, reps: 8, rpe: null, distance_meters: null, duration_seconds: null },
        { index: 1, type: "normal", weight_kg: 100, reps: 5, rpe: 8, distance_meters: null, duration_seconds: null },
      ],
    },
    {
      index: 1,
      title: "Elliptical",
      exercise_template_id: "tmpl-ell",
      sets: [{ index: 0, type: "unknown-hevy-type", weight_kg: null, reps: null, rpe: null, distance_meters: null, duration_seconds: 600 }],
    },
  ],
};

describe("hevyWorkoutSchema", () => {
  it("coerces mixed timestamp formats (offset and Z-with-millis)", () => {
    const parsed = hevyWorkoutSchema.parse(rawWorkout);
    expect(parsed.start_time).toBeInstanceOf(Date);
    expect(parsed.end_time?.toISOString()).toBe("2026-07-15T18:10:00.000Z");
  });
  it("degrades an unknown set type to 'normal' rather than rejecting the workout", () => {
    const parsed = hevyWorkoutSchema.parse(rawWorkout);
    expect(parsed.exercises[1].sets[0].type).toBe("normal");
  });
  it("tolerates null-carrying sets (a timed cardio set has only duration)", () => {
    const parsed = hevyWorkoutSchema.parse(rawWorkout);
    const cardio = parsed.exercises[1].sets[0];
    expect(cardio.weight_kg).toBeNull();
    expect(cardio.duration_seconds).toBe(600);
  });
});

describe("normalizeWorkout", () => {
  it("maps snake_case → camelCase and keeps the raw payload verbatim", () => {
    const parsed = hevyWorkoutSchema.parse(rawWorkout);
    const n = normalizeWorkout(parsed, rawWorkout);
    expect(n.hevyId).toBe("hevy-123");
    expect(n.title).toBe("Push Day A");
    expect(n.rawPayload).toBe(rawWorkout); // identity — the untouched input, not a re-serialization
    expect(n.exercises[0].exerciseTemplateId).toBe("tmpl-bench");
    expect(n.exercises[0].supersetGroup).toBeNull();
    const workingSet = n.exercises[0].sets[1];
    expect(workingSet.setType).toBe("normal");
    expect(workingSet.weightKg).toBe(100);
    expect(workingSet.durationSeconds).toBeNull();
    expect(n.exercises[1].sets[0].durationSeconds).toBe(600);
  });
});

describe("liftingAnnotationPatchSchema", () => {
  it("accepts a partial patch", () => {
    expect(liftingAnnotationPatchSchema.safeParse({ sessionNotes: "slept badly" }).success).toBe(true);
    expect(liftingAnnotationPatchSchema.safeParse({}).success).toBe(true);
  });
  it("rejects unknown keys (strict) so a typo'd field is a 400, not a silent no-op", () => {
    expect(liftingAnnotationPatchSchema.safeParse({ sessionNote: "typo" }).success).toBe(false);
  });
  it("enforces quality 1..5 and the focus vocabulary", () => {
    expect(liftingAnnotationPatchSchema.safeParse({ quality: 0 }).success).toBe(false);
    expect(liftingAnnotationPatchSchema.safeParse({ quality: 6 }).success).toBe(false);
    expect(liftingAnnotationPatchSchema.safeParse({ quality: 3 }).success).toBe(true);
    expect(liftingAnnotationPatchSchema.safeParse({ focus: "push" }).success).toBe(true);
    expect(liftingAnnotationPatchSchema.safeParse({ focus: "lower" }).success).toBe(true);
    expect(liftingAnnotationPatchSchema.safeParse({ focus: "cardio" }).success).toBe(false);
    expect(liftingAnnotationPatchSchema.safeParse({ focus: "legs" }).success).toBe(false); // dropped from the vocab
  });
  it("allows explicit nulls (clearing a field)", () => {
    expect(liftingAnnotationPatchSchema.safeParse({ interpretation: null, focus: null }).success).toBe(true);
  });
});
