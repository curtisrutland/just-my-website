import { describe, expect, it } from "vitest";
import { vitalsDaySchema } from "./schema";

/** The minimum a day needs: a date and the archive. Everything measured is optional. */
const base = { measuredOn: "2026-08-24", rawPayload: {} };

describe("vitalsDaySchema", () => {
  it("accepts a day with no measurements at all", () => {
    // A watch left on the nightstand is a real day, not a validation error.
    expect(vitalsDaySchema.parse(base).measuredOn).toBe("2026-08-24");
  });

  it("accepts the real Garmin day verified on 2026-08-25", () => {
    const r = vitalsDaySchema.parse({
      ...base,
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
      floorsAscended: 7.26115,
      intensityMinutesModerate: 0,
      intensityMinutesVigorous: 1,
    });
    expect(r.hrvLastNightMs).toBe(60);
    expect(r.steps).toBe(4435);
  });

  it("distinguishes null (not measured) from 0 (measured zero)", () => {
    const r = vitalsDaySchema.parse({ ...base, steps: 0, intensityMinutesModerate: null });
    expect(r.steps).toBe(0);
    expect(r.intensityMinutesModerate).toBeNull();
  });

  it("does NOT rebalance sleep stages to sum to the total", () => {
    // If Garmin's own numbers disagree we store what it said; inventing consistency is a verdict.
    const r = vitalsDaySchema.parse({
      ...base,
      sleepTotalSeconds: 22560,
      sleepDeepSeconds: 1,
      sleepLightSeconds: 1,
      sleepRemSeconds: 1,
      sleepAwakeSeconds: 1,
    });
    expect(r.sleepTotalSeconds).toBe(22560);
    expect(r.sleepDeepSeconds).toBe(1);
  });

  it("rejects scores — they have no field to land in", () => {
    // .strict() is what enforces "measurements, not verdicts" at the boundary: if the daemon ever
    // tries to push a readiness score or Body Battery, the write fails loudly instead of silently
    // growing the schema.
    for (const junk of [
      { trainingReadiness: 25 },
      { bodyBatteryHigh: 95 },
      { averageStressLevel: 27 },
      { vo2Max: 48 },
      { sleepScore: 66 },
    ]) {
      expect(() => vitalsDaySchema.parse({ ...base, ...junk })).toThrow();
    }
  });

  it("rejects out-of-range measurements", () => {
    expect(() => vitalsDaySchema.parse({ ...base, restingHeartRate: 400 })).toThrow();
    expect(() => vitalsDaySchema.parse({ ...base, spo2Avg: 130 })).toThrow();
    expect(() => vitalsDaySchema.parse({ ...base, steps: -1 })).toThrow();
    expect(() => vitalsDaySchema.parse({ ...base, sleepTotalSeconds: -60 })).toThrow();
  });

  it("requires a calendar date, never a datetime", () => {
    expect(() => vitalsDaySchema.parse({ ...base, measuredOn: "2026-08-24T00:00:00Z" })).toThrow();
  });

  it("requires rawPayload — the archive is not optional", () => {
    const { rawPayload: _drop, ...noRaw } = base;
    expect(() => vitalsDaySchema.parse(noRaw)).toThrow();
  });
});
