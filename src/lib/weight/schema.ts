import * as z from "zod";

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

/** The derived summary + series returned by the rollup (UI-facing). */
export type WeightPoint = { date: string; weight: number | null; avg: number | null };
export type WeightSummary = {
  currentAvg: number | null;
  current: number | null;
  trendPerWeek: number | null;
  range: { min: number; max: number } | null;
  window: number;
};
export type WeightRollup = {
  summary: WeightSummary;
  series: WeightPoint[];
};
