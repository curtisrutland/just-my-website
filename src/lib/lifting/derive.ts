import type { PrFlag } from "./types";

/**
 * Lifting module — pure derived-stat helpers (Epley e1RM, tonnage, PR walk). Isolated from the repo
 * so they carry no DB dependency and are unit-testable, and so the 1RM formula is a one-function
 * swap (Brzycki is a documented alternative — docs/lifting-model.md Open/deferred).
 *
 * The single discipline: everything reproducible is DERIVED, never stored, so it can't drift. All
 * computations consider WORKING sets only (`setType === "normal"`); warmups/failures/dropsets are
 * excluded from volume, e1RM, and PRs.
 */

/** Round to 1 decimal place (kg values); null passes through. */
export const round1 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10) / 10);

export const isWorkingSet = (s: { setType: string }): boolean => s.setType === "normal";

/** A set reduced to what the derived math needs. */
export type SetLike = { setType: string; weightKg: number | null; reps: number | null };

/** Epley estimated 1RM: `weight × (1 + reps/30)`. Null unless both weight and a positive rep count exist. */
export function epley(weightKg: number | null, reps: number | null): number | null {
  // weightKg <= 0 is a bodyweight/unloaded movement logged as 0 — there's no 1RM to estimate, so
  // null (not 0), which keeps a 0-weight set from rendering an e1RM of "0 lb" that reads as real.
  if (weightKg == null || weightKg <= 0 || reps == null || reps <= 0) return null;
  return weightKg * (1 + reps / 30);
}

/** Above this rep count Epley degrades — the estimate is flagged unreliable (UI renders it muted). */
const UNRELIABLE_REPS = 12;

/**
 * Best e1RM over an exercise's working sets, plus the `unreliable` flag (true when the BEST set's
 * reps exceed 12). Returns null e1RM when no working set has both weight and reps.
 */
export function exerciseE1rm(sets: SetLike[]): { e1rmKg: number | null; unreliable: boolean } {
  let best: { e1rm: number; reps: number } | null = null;
  for (const s of sets) {
    if (!isWorkingSet(s) || s.reps == null) continue;
    const e = epley(s.weightKg, s.reps);
    if (e == null) continue;
    if (!best || e > best.e1rm) best = { e1rm: e, reps: s.reps };
  }
  if (!best) return { e1rmKg: null, unreliable: false };
  return { e1rmKg: round1(best.e1rm), unreliable: best.reps > UNRELIABLE_REPS };
}

/** Max working-set weight (kg) over sets that carry a weight; null if none do. */
export function topWorkingWeight(sets: SetLike[]): number | null {
  let max: number | null = null;
  for (const s of sets) {
    if (!isWorkingSet(s) || s.weightKg == null) continue;
    if (max == null || s.weightKg > max) max = s.weightKg;
  }
  return max;
}

/** Session tonnage = Σ `weightKg × reps` over working sets that have BOTH (null-carrying sets skipped). */
export function tonnage(sets: SetLike[]): number {
  let total = 0;
  for (const s of sets) {
    if (!isWorkingSet(s) || s.weightKg == null || s.reps == null) continue;
    total += s.weightKg * s.reps;
  }
  return total;
}

/** Count of working sets, and total reps across them (working sets that carry a rep count). */
export function volumeCounts(sets: SetLike[]): { workingSets: number; totalReps: number } {
  let workingSets = 0;
  let totalReps = 0;
  for (const s of sets) {
    if (!isWorkingSet(s)) continue;
    workingSets += 1;
    if (s.reps != null) totalReps += s.reps;
  }
  return { workingSets, totalReps };
}

// -- PR walk ------------------------------------------------------------------

/** A set carrying its DB id, so the walk can mark the specific set that achieved a PR. */
export type WalkSet = SetLike & { setId: string };
export type WalkExercise = { templateId: string | null; title: string; sets: WalkSet[] };
/** A session for the PR walk. The input list MUST be ordered oldest → newest by `startedAt`. */
export type WalkSession = { sessionId: string; exercises: WalkExercise[] };

export type PrResult = {
  /** Per-session PR flags (only sessions that set at least one PR appear). */
  prsBySession: Map<string, PrFlag[]>;
  /** DB ids of the sets that achieved a PR (for the set-level `pr` mark). */
  prSetIds: Set<string>;
};

/**
 * Walk all sessions oldest → newest, tracking a running max working-set weight and a running best
 * e1RM per lift identity (`templateId`). A session flags a PR when it BEATS either running max.
 *
 * The FIRST time a lift appears it only establishes the baseline — a debut is not a PR (otherwise a
 * fresh backfill would flag every lift's first session, flooding the journal). Only a genuine
 * improvement over an existing baseline counts. Exercises with no `templateId` can't be threaded
 * across sessions, so they never PR.
 */
export function walkPrs(sessionsOldestFirst: WalkSession[]): PrResult {
  const bestWeight = new Map<string, number>();
  const bestE1rm = new Map<string, number>();
  const prsBySession = new Map<string, PrFlag[]>();
  const prSetIds = new Set<string>();

  for (const session of sessionsOldestFirst) {
    const flags: PrFlag[] = [];
    for (const ex of session.exercises) {
      const key = ex.templateId;
      if (key == null) continue;

      // This exercise's top working weight + best e1RM, with the set that achieved each.
      let topW: { v: number; setId: string } | null = null;
      let topE: { v: number; setId: string } | null = null;
      for (const s of ex.sets) {
        if (!isWorkingSet(s)) continue;
        if (s.weightKg != null && (topW == null || s.weightKg > topW.v)) topW = { v: s.weightKg, setId: s.setId };
        const e = epley(s.weightKg, s.reps);
        if (e != null && (topE == null || e > topE.v)) topE = { v: e, setId: s.setId };
      }

      const prevW = bestWeight.get(key);
      if (topW != null) {
        if (prevW != null && topW.v > prevW) {
          flags.push({ lift: ex.title, templateId: key, kind: "weight", value: round1(topW.v)! });
          prSetIds.add(topW.setId);
        }
        if (prevW == null || topW.v > prevW) bestWeight.set(key, topW.v);
      }

      const prevE = bestE1rm.get(key);
      if (topE != null) {
        if (prevE != null && topE.v > prevE) {
          flags.push({ lift: ex.title, templateId: key, kind: "e1rm", value: round1(topE.v)! });
          prSetIds.add(topE.setId);
        }
        if (prevE == null || topE.v > prevE) bestE1rm.set(key, topE.v);
      }
    }
    if (flags.length) prsBySession.set(session.sessionId, flags);
  }

  return { prsBySession, prSetIds };
}
