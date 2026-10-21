import type * as z from "zod";
import type { vitalsDayViewSchema, vitalsPointSchema, vitalsRollupSchema, vitalsTrendSchema } from "./schema";

/**
 * Vitals module — domain + response-contract types, shared by `repo` AND the UI (CONVENTIONS §8:
 * UI imports from lib, never the reverse). Inferred from the view schemas in `schema.ts`, so the
 * repo's builders are type-checked against the published contract.
 */

/** The ONE view shared by list and detail (#40); `rawPayload` is excluded from both. */
export type VitalsDayView = z.infer<typeof vitalsDayViewSchema>;
export type VitalsPoint = z.infer<typeof vitalsPointSchema>;
export type VitalsTrend = z.infer<typeof vitalsTrendSchema>;
export type VitalsRollup = z.infer<typeof vitalsRollupSchema>;
