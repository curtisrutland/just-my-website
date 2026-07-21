import type { LiftingFocus } from "./schema";

/**
 * Lifting module — domain + response-contract types. Shared by `repo.ts` (which builds them) and
 * the UI (which renders them); per the layering rule these live in `lib`, never in components.
 * These mirror the API read shape in docs/lifting-model.md: instants are ISO strings (never JS
 * `Date`), weights are canonical kg numbers, and the audit columns are dropped.
 */

/** A PR is per lift identity (`exerciseTemplateId`); two kinds — top working weight, or best e1RM. */
export type PrKind = "weight" | "e1rm";
export type PrFlag = {
  /** The exercise title as Hevy renders it, for display ("Bench Press (Barbell)"). */
  lift: string;
  templateId: string | null;
  kind: PrKind;
  /** The value that set the PR (kg for `weight`, kg for `e1rm`), rounded to 1 dp. */
  value: number;
};

/** The derived headline stats for a session — all computed in the repo, never stored. */
export type SessionDerived = {
  tonnageKg: number;
  workingSets: number;
  totalReps: number;
  exerciseCount: number;
  /** Best e1RM across the session's exercises (kg), null if no working set has weight+reps. */
  topE1rmKg: number | null;
  /** Session duration in minutes (endedAt − startedAt), null when endedAt is missing. */
  durationMin: number | null;
  prs: PrFlag[];
};

/** The annotation layer projected for read. `interpreted` = `interpretedAt` is set. */
export type SessionAnnotation = {
  sessionNotes: string | null;
  quality: number | null;
  focus: LiftingFocus | null;
  interpretation: string | null;
  interpreted: boolean;
};

/** One set, as read. `pr` marks the set that achieved a PR (weight or e1RM) for its lift. */
export type SetView = {
  index: number;
  setType: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  pr: boolean;
};

/** One exercise instance, as read, with its per-exercise derived e1RM. */
export type ExerciseView = {
  index: number;
  title: string;
  exerciseTemplateId: string | null;
  notes: string | null;
  supersetGroup: number | null;
  /** Best Epley e1RM over working sets (kg), null when none is computable. */
  e1rmKg: number | null;
  /** True when the best set's reps > 12 (Epley degrades at high reps) — render muted, not trusted. */
  e1rmUnreliable: boolean;
  sets: SetView[];
};

/** A session summary — the journal-card shape (no exercises). */
export type SessionSummary = {
  id: string;
  hevyId: string;
  title: string | null;
  /** ISO 8601 instant. */
  startedAt: string;
  endedAt: string | null;
  /** Hevy's own workout-level note (distinct from our `sessionNotes`). */
  description: string | null;
  derived: SessionDerived;
  annotation: SessionAnnotation;
};

/** A full session — summary plus the exercise → set tree. The session-detail shape. */
export type SessionDetail = SessionSummary & {
  exercises: ExerciseView[];
};

/** One point in a lift's progression series. */
export type LiftProgressionPoint = {
  sessionId: string;
  startedAt: string;
  e1rmKg: number | null;
  topSetKg: number | null;
};

/** The progression series for one lift identity (`exerciseTemplateId`), oldest → newest. */
export type LiftProgression = {
  templateId: string;
  /** The lift's most recent title. */
  title: string | null;
  points: LiftProgressionPoint[];
};
