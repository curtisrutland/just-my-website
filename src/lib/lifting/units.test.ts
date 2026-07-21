import { describe, expect, it } from "vitest";
import { kgToLb } from "./units";

describe("kgToLb", () => {
  it("recovers the exact whole-lb weight from Hevy's noisy kg floats", () => {
    // real values from Curtis's history — each is a whole-lb entry stored as a converted kg float
    expect(kgToLb(18.143717)).toBe(40);
    expect(kgToLb(20.41168)).toBe(45);
    expect(kgToLb(13.607787)).toBe(30);
    expect(kgToLb(9.071858)).toBe(20);
    expect(kgToLb(27.215574)).toBe(60);
  });
  it("never returns a decimal (rounds an e1RM estimate to whole lb too)", () => {
    expect(Number.isInteger(kgToLb(24.2)!)).toBe(true); // 53.35… → 53
    expect(kgToLb(24.2)).toBe(53);
  });
  it("passes null/undefined through (bodyweight / timed sets have no weight)", () => {
    expect(kgToLb(null)).toBeNull();
    expect(kgToLb(undefined)).toBeNull();
  });
  it("handles heavier barbell loads", () => {
    expect(kgToLb(100)).toBe(220); // 220.46 → 220
  });
});
