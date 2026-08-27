import type { VitalsDayInput } from "./schema";

/**
 * Vitals module — domain + response-contract types, shared by `repo` AND the UI (CONVENTIONS §8:
 * UI imports from lib, never the reverse).
 */

/**
 * The ONE view schema shared by list and detail (issue #40: list endpoints must not silently omit
 * fields that exist on detail objects). `rawPayload` is excluded from both — it is the archive,
 * not the contract — and is reachable only via reprocess.
 */
export type VitalsDayView = Omit<VitalsDayInput, "rawPayload"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/** A point in a derived series. `value` is null on days with no measurement — never zero. */
export type VitalsPoint = { date: string; value: number | null; avg: number | null };

/** One derived metric's trend. Deltas compare 7-day averages, never day-over-day (which is noise). */
export type VitalsTrend = {
  current: number | null;
  currentAvg: number | null;
  deltaPerWeek: number | null;
  series: VitalsPoint[];
};

/**
 * `gaps` is the only additive layer: factual absences, stated as observations, never judgments
 * (CONVENTIONS §9). A missing day is a missing day, not a failure.
 */
export type VitalsRollup = {
  window: number;
  from: string;
  to: string;
  restingHeartRate: VitalsTrend;
  hrvLastNightMs: VitalsTrend;
  sleepTotalSeconds: VitalsTrend;
  gaps: { date: string; reason: "no_row" | "no_measurements" }[];
};
