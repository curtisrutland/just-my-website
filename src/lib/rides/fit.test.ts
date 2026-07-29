import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFitRide, downsampleRecords, FitDecodeError, STREAM_RESOLUTION_SECONDS } from "./fit";
import { fitRideSchema } from "./schema";

/**
 * Two tiers, per docs/rides-model.md:
 *  1. Pure downsampler tests on synthetic records — always run.
 *  2. Decode tests against a REAL fixture FIT file (the 2026-07-28 MTB ride) — the fixture
 *     contains a real GPS track and is gitignored until Curtis decides to commit it, so these
 *     skip gracefully when no *.fit is present in ./fixtures.
 */

const FIXTURES = join(__dirname, "fixtures");
const fixturePath = existsSync(FIXTURES)
  ? readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".fit"))
      .map((f) => join(FIXTURES, f))[0]
  : undefined;

// --- Tier 1: the downsampler (synthetic, always runs) ---

const t0 = new Date("2026-01-01T00:00:00Z");
const at = (s: number, fields: Record<string, number>) => ({
  timestamp: new Date(t0.getTime() + s * 1000),
  ...fields,
});

describe("downsampleRecords", () => {
  it("buckets by timestamp with mean for effort channels", () => {
    const records = [at(0, { heartRate: 100 }), at(4, { heartRate: 110 }), at(12, { heartRate: 130 })];
    const { data } = downsampleRecords(records, t0, 10);
    expect(data.t).toEqual([0, 10]);
    expect(data.heartRate).toEqual([105, 130]); // bucket 0: mean(100,110); bucket 1: 130
  });

  it("uses bucket-last for cumulative/positional channels", () => {
    const records = [at(0, { distance: 0 }), at(9, { distance: 55 }), at(11, { distance: 70 })];
    const { data } = downsampleRecords(records, t0, 10);
    expect(data.distance).toEqual([55, 70]);
  });

  it("leaves empty buckets null — smart-recording gaps stay gaps", () => {
    // Records at 0s and 35s: buckets 1 and 2 have no data.
    const records = [at(0, { heartRate: 100 }), at(35, { heartRate: 140 })];
    const { data } = downsampleRecords(records, t0, 10);
    expect(data.t).toEqual([0, 10, 20, 30]);
    expect(data.heartRate).toEqual([100, null, null, 140]);
  });

  it("omits channels that never appear (no power column for a watch ride)", () => {
    const records = [at(0, { heartRate: 100 })];
    const { data } = downsampleRecords(records, t0, 10);
    expect(data.power).toBeUndefined();
    expect(data.cadence).toBeUndefined();
  });

  it("converts semicircles to degrees for lat/lon", () => {
    const semicircles = 362673887;
    const { data } = downsampleRecords([at(0, { positionLat: semicircles, positionLong: -semicircles })], t0, 10);
    const degrees = semicircles * (180 / 2 ** 31);
    expect(data.lat![0]).toBeCloseTo(degrees, 6);
    expect(data.lon![0]).toBeCloseTo(-degrees, 6);
  });

  it("handles zero records", () => {
    const { data } = downsampleRecords([], t0, 10);
    expect(data.t).toEqual([]);
  });

  it("aligns every channel to t", () => {
    const records = [at(0, { heartRate: 100 }), at(25, { distance: 100, heartRate: 120 })];
    const { data } = downsampleRecords(records, t0, 10);
    for (const arr of Object.values(data)) expect(arr).toHaveLength(data.t.length);
  });
});

describe("decodeFitRide input guards", () => {
  it("rejects non-FIT bytes loudly", () => {
    expect(() => decodeFitRide(Buffer.from("definitely not a fit file"))).toThrow(FitDecodeError);
  });
});

// --- Tier 2: the real file (skips when the gitignored fixture is absent) ---

describe.skipIf(!fixturePath)("decodeFitRide (real fixture: 2026-07-28 MTB ride)", () => {
  const bytes = fixturePath ? readFileSync(fixturePath) : Buffer.alloc(0);
  const ride = fixturePath ? decodeFitRide(bytes) : null!;

  it("passes fitRideSchema — decode output IS the validated ingest shape", () => {
    expect(() => fitRideSchema.parse(ride)).not.toThrow();
  });

  it("extracts the verified session facts", () => {
    expect(ride.sport).toBe("cycling");
    expect(ride.subSport).toBe("mountain");
    expect(ride.sportProfileName).toBe("MTB");
    expect(ride.startedAt.toISOString()).toBe("2026-07-29T00:46:39.000Z");
    expect(ride.elapsedSeconds).toBeCloseTo(2621.506, 3);
    expect(ride.movingSeconds).toBeCloseTo(2621.506, 3);
    expect(ride.distanceMeters).toBeCloseTo(6053.13, 2);
    expect(ride.totalAscentMeters).toBe(88);
    expect(ride.totalDescentMeters).toBe(90);
    expect(ride.avgHeartRate).toBe(138);
    expect(ride.maxHeartRate).toBe(177);
    expect(ride.avgSpeedMps).toBeCloseTo(2.309, 3);
    expect(ride.maxSpeedMps).toBeCloseTo(8.118, 3);
    expect(ride.calories).toBe(616);
  });

  it("derives localDate from the file's own clock — NOT the UTC date", () => {
    // Started 2026-07-29T00:46:39Z, but 7:46 PM on the 28th local — the case that justifies
    // storing localDate.
    expect(ride.localDate).toBe("2026-07-28");
  });

  it("is honest about absent sensors (watch ride: no power, no cadence, no temperature)", () => {
    expect(ride.avgPowerWatts).toBeNull();
    expect(ride.maxPowerWatts).toBeNull();
    expect(ride.normalizedPowerWatts).toBeNull();
    expect(ride.avgCadence).toBeNull();
    expect(ride.avgTemperatureC).toBeNull();
    expect(ride.stream.data.power).toBeUndefined();
    expect(ride.stream.data.cadence).toBeUndefined();
  });

  it("identifies the device via the readable product string", () => {
    expect(ride.deviceManufacturer).toBe("garmin");
    expect(ride.deviceProduct).toBe("instinct3Amoled50mm");
    expect(ride.deviceSerial).toBe("3633191761");
  });

  it("keeps the session-referenced HR-zone histogram verbatim, boundaries included", () => {
    const z = ride.timeInHrZone as {
      timeInHrZone: number[];
      hrZoneHighBoundary: number[];
      referenceMesg: string;
    };
    expect(z.referenceMesg).toBe("session");
    expect(z.timeInHrZone).toHaveLength(7);
    expect(z.hrZoneHighBoundary).toEqual([90, 107, 125, 143, 161, 179]);
    expect(z.timeInHrZone[4]).toBeCloseTo(810.304, 2); // 13:30 in 143–161 — the honest-effort bucket
  });

  it("downsamples the smart-recorded stream at 10s with aligned channels", () => {
    const { resolutionSeconds, data } = ride.stream;
    expect(resolutionSeconds).toBe(STREAM_RESOLUTION_SECONDS);
    // 43:41 of riding → ~262 buckets.
    expect(data.t.length).toBeGreaterThan(250);
    expect(data.t.length).toBeLessThan(270);
    for (const channel of ["lat", "lon", "altitude", "speed", "distance", "heartRate", "grit", "flow"]) {
      expect(data[channel], channel).toBeDefined();
      expect(data[channel], channel).toHaveLength(data.t.length);
    }
    // Distance is cumulative: the last non-null value is the ride's total.
    const lastDistance = [...data.distance!].reverse().find((v) => v != null);
    expect(lastDistance).toBeCloseTo(6053.13, 0);
  });

  it("hashes the exact bytes (the dedupe identity)", () => {
    expect(ride.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(decodeFitRide(bytes).fileHash).toBe(ride.fileHash);
  });
});
