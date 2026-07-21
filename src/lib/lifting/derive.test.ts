import { describe, expect, it } from "vitest";
import { epley, exerciseE1rm, tonnage, topWorkingWeight, volumeCounts, walkPrs, type WalkSession } from "./derive";

const set = (setType: string, weightKg: number | null, reps: number | null) => ({ setType, weightKg, reps });

describe("epley", () => {
  it("computes weight × (1 + reps/30)", () => {
    expect(epley(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley(60, 1)).toBeCloseTo(62, 5);
  });
  it("is null when weight or reps is missing or reps <= 0", () => {
    expect(epley(null, 5)).toBeNull();
    expect(epley(100, null)).toBeNull();
    expect(epley(100, 0)).toBeNull();
  });
  it("is null for a 0 (unloaded/bodyweight) weight — no 1RM to estimate, never a spurious 0", () => {
    expect(epley(0, 10)).toBeNull();
    expect(exerciseE1rm([set("normal", 0, 10)]).e1rmKg).toBeNull();
  });
});

describe("exerciseE1rm", () => {
  it("takes the max over WORKING sets only (warmups excluded)", () => {
    const e = exerciseE1rm([set("warmup", 200, 1), set("normal", 100, 5), set("normal", 102.5, 3)]);
    // best working = max(116.67, 112.75) = 116.67 → rounded 116.7
    expect(e.e1rmKg).toBe(116.7);
    expect(e.unreliable).toBe(false);
  });
  it("flags unreliable by the BEST set's rep count, not any set's", () => {
    // 100x3 → e1rm 110 (best, reps 3, reliable); 50x15 → e1rm 75 (reps 15 but not the best)
    const e = exerciseE1rm([set("normal", 100, 3), set("normal", 50, 15)]);
    expect(e.e1rmKg).toBe(110);
    expect(e.unreliable).toBe(false);
  });
  it("flags unreliable when the best set itself is high-rep (>12)", () => {
    const e = exerciseE1rm([set("normal", 50, 15)]);
    expect(e.unreliable).toBe(true);
  });
  it("is null when no working set has both weight and reps", () => {
    expect(exerciseE1rm([set("normal", null, null), set("warmup", 100, 5)]).e1rmKg).toBeNull();
  });
});

describe("tonnage / counts", () => {
  it("sums weight×reps over working sets that have both; skips null-carrying and non-working", () => {
    const sets = [
      set("warmup", 60, 8), // excluded (warmup)
      set("normal", 100, 5), // 500
      set("normal", 102.5, 4), // 410
      set("normal", null, 3), // skipped (no weight — e.g. bodyweight)
      set("normal", 50, null), // skipped (no reps — e.g. timed)
    ];
    expect(tonnage(sets)).toBeCloseTo(910, 5);
    expect(topWorkingWeight(sets)).toBe(102.5);
    const { workingSets, totalReps } = volumeCounts(sets);
    expect(workingSets).toBe(4); // the four 'normal' sets
    expect(totalReps).toBe(12); // 5 + 4 + 3 (the null-reps set contributes 0)
  });
});

describe("walkPrs", () => {
  const bench = (sessionId: string, sets: { setId: string; setType: string; weightKg: number | null; reps: number | null }[]): WalkSession => ({
    sessionId,
    exercises: [{ templateId: "bench", title: "Bench Press (Barbell)", sets }],
  });

  it("does NOT flag the first-ever appearance of a lift (debut is a baseline, not a PR)", () => {
    const { prsBySession, prSetIds } = walkPrs([bench("s1", [{ setId: "a", setType: "normal", weightKg: 100, reps: 5 }])]);
    expect(prsBySession.size).toBe(0);
    expect(prSetIds.size).toBe(0);
  });

  it("flags a weight PR when a later session beats the running max weight", () => {
    const { prsBySession, prSetIds } = walkPrs([
      bench("s1", [{ setId: "a", setType: "normal", weightKg: 100, reps: 5 }]),
      bench("s2", [{ setId: "b", setType: "normal", weightKg: 105, reps: 1 }]), // 105 > 100 weight PR; e1rm 108.5 < 116.67 no e1rm PR
    ]);
    const s2 = prsBySession.get("s2") ?? [];
    expect(s2.map((p) => p.kind).sort()).toEqual(["weight"]);
    expect(s2[0].value).toBe(105);
    expect(prSetIds.has("b")).toBe(true);
  });

  it("flags both a weight and an e1RM PR when a session beats both running maxes", () => {
    const { prsBySession } = walkPrs([
      bench("s1", [{ setId: "a", setType: "normal", weightKg: 100, reps: 5 }]),
      bench("s3", [{ setId: "c", setType: "normal", weightKg: 110, reps: 5 }]), // weight 110>100, e1rm 128.3>116.67
    ]);
    expect((prsBySession.get("s3") ?? []).map((p) => p.kind).sort()).toEqual(["e1rm", "weight"]);
  });

  it("never flags a lift with no templateId (can't be threaded across sessions)", () => {
    const s: WalkSession = {
      sessionId: "s1",
      exercises: [{ templateId: null, title: "Mystery", sets: [{ setId: "a", setType: "normal", weightKg: 500, reps: 1 }] }],
    };
    const s2: WalkSession = {
      sessionId: "s2",
      exercises: [{ templateId: null, title: "Mystery", sets: [{ setId: "b", setType: "normal", weightKg: 999, reps: 1 }] }],
    };
    expect(walkPrs([s, s2]).prsBySession.size).toBe(0);
  });

  it("excludes warmups from PR consideration", () => {
    const { prsBySession } = walkPrs([
      bench("s1", [{ setId: "a", setType: "normal", weightKg: 100, reps: 5 }]),
      bench("s2", [{ setId: "b", setType: "warmup", weightKg: 500, reps: 1 }]), // huge but a warmup — no PR
    ]);
    expect(prsBySession.has("s2")).toBe(false);
  });
});
