import type * as z from "zod";
import type {
  exerciseViewSchema,
  goalViewSchema,
  liftProgressionPointSchema,
  liftProgressionSchema,
  prFlagSchema,
  prKindSchema,
  sessionAnnotationSchema,
  sessionDerivedSchema,
  sessionDetailSchema,
  sessionSummarySchema,
  setViewSchema,
} from "./schema";

/**
 * Lifting module — domain + response-contract types. Shared by `repo.ts` (which builds them) and
 * the UI (which renders them); per the layering rule these live in `lib`, never in components.
 * Inferred from the view schemas in `schema.ts` (where each field is documented), so the repo's
 * builders are type-checked against the published contract.
 */

export type PrKind = z.infer<typeof prKindSchema>;
export type PrFlag = z.infer<typeof prFlagSchema>;
export type SessionDerived = z.infer<typeof sessionDerivedSchema>;
export type SessionAnnotation = z.infer<typeof sessionAnnotationSchema>;
export type SetView = z.infer<typeof setViewSchema>;
export type ExerciseView = z.infer<typeof exerciseViewSchema>;
export type GoalView = z.infer<typeof goalViewSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type LiftProgressionPoint = z.infer<typeof liftProgressionPointSchema>;
export type LiftProgression = z.infer<typeof liftProgressionSchema>;
