import { describe, expect, it } from "vitest";
import { ridePatchSchema, rideStreamSchema } from "./schema";

describe("ridePatchSchema — the human layer, and nothing else", () => {
  it("accepts name and note, both clearable", () => {
    expect(ridePatchSchema.parse({ name: "Big climb loop" })).toEqual({ name: "Big climb loop" });
    expect(ridePatchSchema.parse({ note: null })).toEqual({ note: null });
    expect(ridePatchSchema.parse({})).toEqual({});
  });

  it("rejects any measured field — facts are immutable from the surfaces", () => {
    // .strict() is the mechanism that keeps the immutability stance honest: a well-meaning
    // correction to a fact must be a 400, not a silent write.
    expect(ridePatchSchema.safeParse({ avgPowerWatts: 250 }).success).toBe(false);
    expect(ridePatchSchema.safeParse({ distanceMeters: 1 }).success).toBe(false);
    expect(ridePatchSchema.safeParse({ sport: "running" }).success).toBe(false);
    expect(ridePatchSchema.safeParse({ localDate: "2026-01-01" }).success).toBe(false);
  });

  it("rejects an empty name (clear via null, not empty string)", () => {
    expect(ridePatchSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("rideStreamSchema — aligned arrays", () => {
  it("accepts aligned channels with null gaps", () => {
    const parsed = rideStreamSchema.parse({
      resolutionSeconds: 10,
      data: { t: [0, 10, 20], heartRate: [100, null, 140] },
    });
    expect(parsed.data.heartRate).toEqual([100, null, 140]);
  });

  it("requires the t channel", () => {
    expect(rideStreamSchema.safeParse({ resolutionSeconds: 10, data: { heartRate: [1] } }).success).toBe(false);
  });

  it("rejects a channel misaligned with t", () => {
    expect(
      rideStreamSchema.safeParse({ resolutionSeconds: 10, data: { t: [0, 10], heartRate: [100] } }).success
    ).toBe(false);
  });
});
