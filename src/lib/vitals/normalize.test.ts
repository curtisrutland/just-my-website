import { describe, expect, it } from "vitest";
import raw from "./fixtures/garmin-day-2026-08-24.json";
import { normalizeGarminDay } from "./normalize";
import { vitalsDaySchema } from "./schema";

/**
 * The real payload Garmin returned for 2026-08-24, captured from Curtis's account on 2026-08-25
 * (get_user_summary + get_sleep_data + get_hrv_data, verbatim). This is the module's equivalent of
 * the rides FIT fixture: the parser is tested against what the API actually sends, not a mock of it.
 */
const day = raw as Record<string, unknown>;

describe("normalizeGarminDay — against the real captured payload", () => {
  const v = normalizeGarminDay("2026-08-24", day);

  it("produces a body that passes the write schema", () => {
    expect(() => vitalsDaySchema.parse(v)).not.toThrow();
  });

  it("reads the measurements Garmin actually returned", () => {
    expect(v).toMatchObject({
      measuredOn: "2026-08-24",
      sleepTotalSeconds: 22560,
      sleepDeepSeconds: 3240,
      sleepLightSeconds: 15780,
      sleepRemSeconds: 3540,
      sleepAwakeSeconds: 2520,
      napSeconds: 0,
      sleepSpo2Avg: 95,
      sleepSpo2Low: 85,
      sleepRespirationAvg: 13,
      hrvLastNightMs: 60,
      hrvLastNight5MinHighMs: 111,
      restingHeartRate: 45,
      minHeartRate: 44,
      maxHeartRate: 119,
      spo2Avg: 94,
      spo2Low: 85,
      respirationWakingAvg: 16,
      respirationLow: 7,
      respirationHigh: 26,
      steps: 4435,
      intensityMinutesModerate: 0,
      intensityMinutesVigorous: 1,
    });
    expect(v.floorsAscended).toBeCloseTo(7.26115, 4);
  });

  it("converts sleep timestamps from the GMT epoch, not the shifted Local one", () => {
    // sleepStartTimestampGMT = 1787549289000; the Local variant is the same moment minus the
    // offset, and storing it would put a fake instant in a timestamptz column.
    expect(v.sleepStartAt).toBe(new Date(1787549289000).toISOString());
    expect(v.sleepEndAt).toBe(new Date(1787574369000).toISOString());
  });

  it("keeps the whole payload verbatim as the lossless archive", () => {
    expect(v.rawPayload).toBe(day);
    // The scores we refuse to model are still IN the archive — that is the point of keeping it.
    const summary = (day.userSummary ?? {}) as Record<string, unknown>;
    expect(summary.bodyBatteryHighestValue).toBe(95);
    expect(summary.averageStressLevel).toBe(27);
  });

  it("surfaces no verdict as a column", () => {
    // Whatever Garmin sends, the normalized body carries only measurements.
    for (const banned of ["trainingReadiness", "bodyBattery", "stress", "vo2Max", "sleepScore", "fitnessAge", "dailyStepGoal", "calories", "totalDistanceMeters"]) {
      expect(Object.keys(v)).not.toContain(banned);
    }
  });

  it("does not store Garmin's own rolling averages — the repo derives those", () => {
    const summary = day.userSummary as Record<string, unknown>;
    expect(summary.lastSevenDaysAvgRestingHeartRate).toBe(48); // present in the payload...
    expect(Object.keys(v)).not.toContain("lastSevenDaysAvgRestingHeartRate"); // ...and not a column
  });

  it("treats an empty or partial payload as 'not measured', never as zero", () => {
    const empty = normalizeGarminDay("2026-08-24", {});
    expect(empty.steps).toBeNull();
    expect(empty.restingHeartRate).toBeNull();
    expect(empty.sleepTotalSeconds).toBeNull();
    expect(() => vitalsDaySchema.parse(empty)).not.toThrow();

    const partial = normalizeGarminDay("2026-08-24", { userSummary: { totalSteps: 900 } });
    expect(partial.steps).toBe(900);
    expect(partial.hrvLastNightMs).toBeNull();
  });
});
