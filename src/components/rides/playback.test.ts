import { describe, expect, it } from "vitest";
import { nearestIndex, positionAt } from "./playback";

/** 5 buckets at 10 s; a dropout between t=10 and t=40 (indices 2–3 unrecorded). */
const data = {
  t: [0, 10, 20, 30, 40],
  lat: [30.0, 30.1, null, null, 30.4],
  lon: [-97.0, -97.1, null, null, -97.4],
};

describe("nearestIndex", () => {
  it("maps playhead seconds to the nearest bucket, clamped", () => {
    expect(nearestIndex(data.t, 0)).toBe(0);
    expect(nearestIndex(data.t, 14)).toBe(1);
    expect(nearestIndex(data.t, 16)).toBe(2);
    expect(nearestIndex(data.t, 999)).toBe(4);
    expect(nearestIndex(data.t, -5)).toBe(0);
  });
});

describe("positionAt", () => {
  it("interpolates between adjacent recorded points — the marker glides", () => {
    const p = positionAt(data, 5, 10)!;
    expect(p.lat).toBeCloseTo(30.05, 10);
    expect(p.lon).toBeCloseTo(-97.05, 10);
    expect(p.stale).toBe(false);
  });

  it("sits exactly on a recorded point at its timestamp", () => {
    const p = positionAt(data, 10, 10)!;
    expect(p.lat).toBe(30.1);
    expect(p.stale).toBe(false);
  });

  it("holds and dims through a dropout — a gap is never bridged", () => {
    // t=25 falls in the 10→40 dropout (3 buckets wide): hold at the t=10 point, stale.
    const p = positionAt(data, 25, 10)!;
    expect(p.lat).toBe(30.1);
    expect(p.lon).toBe(-97.1);
    expect(p.stale).toBe(true);
  });

  it("clamps past the end to the last recorded point", () => {
    const p = positionAt(data, 999, 10)!;
    expect(p.lat).toBe(30.4);
    expect(p.stale).toBe(false);
  });

  it("returns null when the stream has no GPS", () => {
    expect(positionAt({ t: [0, 10], heartRate: [100, 110] }, 5, 10)).toBeNull();
  });

  it("holds stale at the first recorded point before recording starts", () => {
    const lateStart = { t: [0, 10, 20], lat: [null, null, 30.2], lon: [null, null, -97.2] };
    const p = positionAt(lateStart, 0, 10)!;
    expect(p.lat).toBe(30.2);
    expect(p.stale).toBe(true);
  });
});
