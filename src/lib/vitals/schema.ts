import * as z from "zod";
import { isoInstant } from "@/lib/http/view-schemas";

/**
 * Vitals module — Zod schemas. Single source of truth for validation (docs/vitals-model.md).
 *
 * The module's principle is **measurements, not verdicts**: every field here is something the
 * watch measured, never something it decided. Scores (training readiness, Body Battery, stress,
 * VO2max, FTP, race predictions, sleep grades) are deliberately absent — they survive only inside
 * `rawPayload`, which nothing reads. See the model doc for the evidence table.
 *
 * There is exactly ONE writer: the Garmin daemon, via `POST /api/vitals`. There is no human write
 * path — you cannot hand-enter an HRV — so there is no patch schema, only an upsert.
 */

const calendarDate = z.iso.date(); // 'YYYY-MM-DD', strict — never a datetime

/**
 * Every measurement is optional AND nullable, and that is the honest shape: a day with no watch
 * worn, a night with no sleep recorded, a device that never synced. `null` means NOT MEASURED and
 * the UI must say so — it never renders as 0.
 */
const seconds = z.number().int().nonnegative().nullish();
const bpm = z.number().int().min(20).max(250).nullish();
const ms = z.number().int().positive().max(1000).nullish();
const percent = z.number().min(0).max(100).nullish();
const rate = z.number().min(0).max(120).nullish(); // breaths/min
const count = z.number().int().nonnegative().nullish();

export const vitalsDaySchema = z
  .object({
    measuredOn: calendarDate,

    // --- sleep. Stage seconds are Garmin's CLASSIFICATION over movement + heart rate, not a
    // direct measurement (docs/vitals-model.md § "The one kept exception"). They are kept because
    // they are self-describing durations; Garmin's GRADING of them (sleepScores, avgSleepStress)
    // is not stored. Deliberately NOT rebalanced to sum to sleepTotalSeconds: if Garmin's own
    // numbers disagree, we store what it said. Inventing consistency would be a verdict.
    sleepTotalSeconds: seconds,
    sleepDeepSeconds: seconds,
    sleepLightSeconds: seconds,
    sleepRemSeconds: seconds,
    sleepAwakeSeconds: seconds,
    napSeconds: seconds,
    sleepStartAt: z.iso.datetime({ offset: true }).nullish(),
    sleepEndAt: z.iso.datetime({ offset: true }).nullish(),
    sleepSpo2Avg: percent,
    sleepSpo2Low: percent,
    sleepRespirationAvg: rate,

    // --- heart-rate variability, in MILLISECONDS (measured, not a score).
    hrvLastNightMs: ms,
    hrvLastNight5MinHighMs: ms,

    // --- heart rate.
    restingHeartRate: bpm,
    minHeartRate: bpm,
    maxHeartRate: bpm,

    // --- blood oxygen + respiration (all-day).
    spo2Avg: percent,
    spo2Low: percent,
    respirationWakingAvg: rate,
    respirationLow: rate,
    respirationHigh: rate,

    // --- movement. Steps and floors are measured (accelerometer, barometer). Distance is NOT
    // stored: it is steps x an estimated stride length. Intensity minutes are minutes counted
    // inside configured HR-zone boundaries — the same "measurement plus a published boundary"
    // reasoning that keeps the rides HR-zone histogram.
    steps: count,
    floorsAscended: z.number().nonnegative().nullish(),
    intensityMinutesModerate: count,
    intensityMinutesVigorous: count,

    // --- the lossless source. Verbatim Garmin responses for the day, so a field we chose not to
    // surface today can be back-filled across all history WITHOUT re-polling Garmin (which
    // rate-limits hard, and whose history we cannot re-derive from anything we own).
    rawPayload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type VitalsDayInput = z.infer<typeof vitalsDaySchema>;

/**
 * What the daemon actually POSTs: a date plus Garmin's responses VERBATIM.
 *
 * The daemon is a dumb pipe by design (docs/garmin-daemon.md § "What the daemon may NOT do") — it
 * does not decide what a field means. The server normalizes (`normalizeGarminDay`) and then parses
 * with `vitalsDaySchema`, the same shape rides uses: `decode(bytes) -> schema.parse -> repo`. That
 * also makes reprocess exact, because it replays the identical normalizer over the stored payload.
 */
export const vitalsIngestSchema = z
  .object({
    measuredOn: calendarDate,
    raw: z.record(z.string(), z.unknown()),
  })
  .strict();

export type VitalsIngest = z.infer<typeof vitalsIngestSchema>;

// --- Response views (the JSON the routes send; OpenAPI + the contract test read these) ---

/**
 * The ONE view shared by list and detail (issue #40: list endpoints must not silently omit fields
 * that exist on detail objects). `rawPayload` is excluded from both — it is the archive, not the
 * contract — and is reachable only via reprocess. Every measurement is present, `null` when the
 * watch didn't measure it.
 */
const {
  rawPayload: _raw,
  measuredOn: _on,
  sleepStartAt: _start,
  sleepEndAt: _end,
  ...measurements
} = vitalsDaySchema.shape;
export const vitalsDayViewSchema = z
  .object(measurements)
  .required() // nullish on write → always present (null = not measured) on read
  .extend({
    id: z.uuid(),
    measuredOn: calendarDate,
    sleepStartAt: isoInstant.nullable(),
    sleepEndAt: isoInstant.nullable(),
    createdAt: isoInstant,
    updatedAt: isoInstant,
  });

/** A point in a derived series. `value` is null on days with no measurement — never zero. */
export const vitalsPointSchema = z.object({ date: calendarDate, value: z.number().nullable(), avg: z.number().nullable() });

/** One derived metric's trend. Deltas compare 7-day averages, never day-over-day (which is noise). */
export const vitalsTrendSchema = z.object({
  current: z.number().nullable(),
  currentAvg: z.number().nullable(),
  deltaPerWeek: z.number().nullable(),
  series: z.array(vitalsPointSchema),
});

/**
 * `gaps` is the only additive layer: factual absences, stated as observations, never judgments
 * (CONVENTIONS §9). A missing day is a missing day, not a failure.
 */
export const vitalsRollupSchema = z.object({
  window: z.number().int(),
  from: calendarDate,
  to: calendarDate,
  restingHeartRate: vitalsTrendSchema,
  hrvLastNightMs: vitalsTrendSchema,
  sleepTotalSeconds: vitalsTrendSchema,
  gaps: z.array(z.object({ date: calendarDate, reason: z.enum(["no_row", "no_measurements"]) })),
});
