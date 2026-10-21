import * as z from "zod";
import { auditView, calendarDate as viewDate } from "@/lib/http/view-schemas";

/**
 * Weight module — Zod schemas. Single source of truth for validation; both write surfaces (web
 * server action, token API) call these. Weight is a plain number in pounds ("lb" is display-only).
 */

const calendarDate = z.iso.date(); // 'YYYY-MM-DD', strict — never a datetime

export const weightCreateSchema = z
  .object({
    measuredOn: calendarDate,
    weight: z.number().finite().positive(),
    note: z.string().trim().min(1).nullish(),
  })
  .strict();

export const weightPatchSchema = weightCreateSchema.partial();

export type WeightCreate = z.infer<typeof weightCreateSchema>;
export type WeightPatch = z.infer<typeof weightPatchSchema>;

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---

/** One weigh-in as every read and the upsert return it: the row, audit columns included. */
export const weightEntryViewSchema = z.object({
  ...auditView,
  measuredOn: viewDate,
  weight: z.number(),
  note: z.string().nullable(),
});

/** The derived summary + series returned by the rollup (UI-facing). */
export const weightPointSchema = z.object({ date: viewDate, weight: z.number().nullable(), avg: z.number().nullable() });
export const weightSummarySchema = z.object({
  currentAvg: z.number().nullable(),
  current: z.number().nullable(),
  trendPerWeek: z.number().nullable(),
  range: z.object({ min: z.number(), max: z.number() }).nullable(),
  window: z.number().int(),
});
export const weightRollupSchema = z.object({ summary: weightSummarySchema, series: z.array(weightPointSchema) });

export type WeightPoint = z.infer<typeof weightPointSchema>;
export type WeightSummary = z.infer<typeof weightSummarySchema>;
export type WeightRollup = z.infer<typeof weightRollupSchema>;
