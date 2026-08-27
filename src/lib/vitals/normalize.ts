import type { VitalsDayInput } from "./schema";

/**
 * Vitals module — the Garmin decode step.
 *
 * The kernel rule is `schema.parse() → repo` on every write; this module puts a normalization step
 * in front of it, exactly as rides puts `decodeFitRide` in front of `fitRideSchema.parse`. The
 * daemon posts Garmin's responses VERBATIM and does no interpretation of its own — so this file is
 * the single place that decides what a Garmin field means, and `POST /api/vitals` and
 * `POST /api/vitals/{date}/reprocess` both go through it. Two paths, one meaning, no drift.
 *
 * Everything it cannot find becomes `null` ("not measured"), never `0`.
 *
 * Field paths verified against Curtis's real account on 2026-08-25 — see docs/vitals-model.md.
 */

/** Garmin's day payload: the three responses the daemon collects, merged under stable keys. */
export type GarminDayRaw = {
  userSummary?: Record<string, unknown> | null;
  sleep?: Record<string, unknown> | null;
  hrv?: Record<string, unknown> | null;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A finite number or null. Garmin returns nulls, absent keys, and occasional strings. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** An integer or null — Garmin sends `95.0` where the column is an int (e.g. SpO2 lows). */
function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** Epoch milliseconds → ISO instant. Always the GMT variant: the `Local` fields are the same
 *  moment shifted by the offset, which would store a fake instant. */
function instant(v: unknown): string | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Project one day of Garmin responses onto the module's measurement columns.
 *
 * What is deliberately NOT read here is as load-bearing as what is: no training readiness, Body
 * Battery, stress, VO2max, FTP, race prediction, fitness age, or sleep score — and no
 * `dailyStepGoal` (Garmin adapts it daily, so it is a verdict wearing a target's clothing), no
 * `totalDistanceMeters` (steps x an estimated stride), no calories (BMR is computed from the
 * profile; active calories are modeled from heart rate), and none of Garmin's own rolling averages
 * (`lastSevenDaysAvgRestingHeartRate`, `hrvSummary.weeklyAvg`) — those are derived in the repo so
 * they cannot drift. All of it survives verbatim in `rawPayload`.
 */
export function normalizeGarminDay(measuredOn: string, raw: Record<string, unknown>): VitalsDayInput {
  const r = raw as GarminDayRaw;
  const summary = obj(r.userSummary) ?? {};
  const sleep = obj(obj(r.sleep)?.dailySleepDTO) ?? {};
  const hrv = obj(obj(r.hrv)?.hrvSummary) ?? {};

  return {
    measuredOn,

    sleepTotalSeconds: int(sleep.sleepTimeSeconds),
    sleepDeepSeconds: int(sleep.deepSleepSeconds),
    sleepLightSeconds: int(sleep.lightSleepSeconds),
    sleepRemSeconds: int(sleep.remSleepSeconds),
    sleepAwakeSeconds: int(sleep.awakeSleepSeconds),
    napSeconds: int(sleep.napTimeSeconds),
    sleepStartAt: instant(sleep.sleepStartTimestampGMT),
    sleepEndAt: instant(sleep.sleepEndTimestampGMT),
    sleepSpo2Avg: num(sleep.averageSpO2Value),
    sleepSpo2Low: num(sleep.lowestSpO2Value),
    sleepRespirationAvg: num(sleep.averageRespirationValue),

    hrvLastNightMs: int(hrv.lastNightAvg),
    hrvLastNight5MinHighMs: int(hrv.lastNight5MinHigh),

    restingHeartRate: int(summary.restingHeartRate),
    minHeartRate: int(summary.minHeartRate),
    maxHeartRate: int(summary.maxHeartRate),

    spo2Avg: num(summary.averageSpo2),
    spo2Low: num(summary.lowestSpo2),
    respirationWakingAvg: num(summary.avgWakingRespirationValue),
    respirationLow: num(summary.lowestRespirationValue),
    respirationHigh: num(summary.highestRespirationValue),

    steps: int(summary.totalSteps),
    floorsAscended: num(summary.floorsAscended),
    intensityMinutesModerate: int(summary.moderateIntensityMinutes),
    intensityMinutesVigorous: int(summary.vigorousIntensityMinutes),

    rawPayload: raw,
  };
}
