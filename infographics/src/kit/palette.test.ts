import { describe, expect, it } from "vitest";
import { mix } from "./palette";

describe("mix", () => {
  it("returns the colour at 1 and the base at 0", () => {
    expect(mix("#3987e5", "#0a0d0f", 1)).toBe("#3987e5");
    expect(mix("#3987e5", "#0a0d0f", 0)).toBe("#0a0d0f");
  });
  it("blends each channel in between", () => {
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 0.25)).toBe("#4000bf");
  });
});
