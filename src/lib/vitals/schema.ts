import * as z from "zod";

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
