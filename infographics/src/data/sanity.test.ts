import { describe, expect, it } from "vitest";
import { questionableRides, settleQuestionableRides } from "./sanity";

const mph = (v: number) => v / 2.2369363;
const ride = (id: string, topMph: number | null) => ({ id, localDate: "2026-09-26", sportProfileName: "MTB", maxSpeedMps: topMph == null ? null : mph(topMph) });
const rides = [ride("a", 18.2), ride("b", 51.3), ride("c", 26.6), ride("d", 45.4), ride("e", null)];

describe("questionableRides", () => {
  it("flags only rides whose top speed is over 30 mph", () => {
    expect(questionableRides(rides).map((r) => r.id)).toEqual(["b", "d"]);
  });
  it("does not flag a ride at exactly the limit, or one with no top speed", () => {
    expect(questionableRides([ride("x", 30), ride("y", null)])).toEqual([]);
  });
  it("takes another limit when a piece needs one", () => {
    expect(questionableRides(rides, 25).map((r) => r.id)).toEqual(["b", "c", "d"]);
  });
});

describe("settleQuestionableRides", () => {
  it("stops, naming every questionable ride that has no decision", () => {
    const attempt = () => settleQuestionableRides(rides, { b: { action: "exclude", why: "drove off with the watch running" } });
    expect(attempt).toThrow(/1 ride has a top speed over 30 mph/);
    expect(attempt).toThrow(/45\.4 mph\s+id d/);
    expect(attempt).not.toThrow(/id b/);
  });
  it("leaves out excluded rides and reports them with the reason", () => {
    const result = settleQuestionableRides(rides, {
      b: { action: "exclude", why: "drove off with the watch running" },
      d: { action: "include", why: "a real descent" },
    });
    expect(result.rides.map((r) => r.id)).toEqual(["a", "c", "d", "e"]);
    expect(result.excluded).toEqual([{ ride: rides[1], why: "drove off with the watch running" }]);
  });
  it("passes everything through when nothing is questionable", () => {
    const calm = [ride("a", 18), ride("c", 26.6)];
    expect(settleQuestionableRides(calm, {})).toEqual({ rides: calm, excluded: [] });
  });
  it("ignores a decision about a ride that is not questionable", () => {
    const result = settleQuestionableRides([ride("a", 18)], { a: { action: "exclude", why: "stale" } });
    expect(result.rides.map((r) => r.id)).toEqual(["a"]);
  });
});
