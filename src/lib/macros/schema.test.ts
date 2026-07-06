import { describe, expect, it } from "vitest";
import {
  dayTagCreateSchema,
  entryCreateSchema,
  entryPatchSchema,
  foodCreateSchema,
  foodPatchSchema,
  targetProfileCreateSchema,
} from "./schema";

describe("nutrition numeric contract", () => {
  it("rejects unit-strings for macros", () => {
    const r = foodCreateSchema.safeParse({ name: "whey", source: "custom", calories: "22 g" });
    expect(r.success).toBe(false);
  });
  it("accepts bare numbers for macros", () => {
    const r = foodCreateSchema.safeParse({ name: "whey", source: "custom", calories: 380, proteinContent: 24 });
    expect(r.success).toBe(true);
  });
  it("rejects negative macros", () => {
    const r = foodCreateSchema.safeParse({ name: "whey", source: "custom", calories: -1 });
    expect(r.success).toBe(false);
  });
});

describe("food source / fdcId invariant", () => {
  it("usda requires an fdcId", () => {
    expect(foodCreateSchema.safeParse({ name: "chicken", source: "usda" }).success).toBe(false);
    expect(foodCreateSchema.safeParse({ name: "chicken", source: "usda", fdcId: 172854 }).success).toBe(true);
  });
  it("custom must not carry an fdcId", () => {
    expect(foodCreateSchema.safeParse({ name: "bar", source: "custom", fdcId: 1 }).success).toBe(false);
    expect(foodCreateSchema.safeParse({ name: "bar", source: "custom" }).success).toBe(true);
  });
});

describe("calendar dates", () => {
  it("accepts YYYY-MM-DD, rejects datetimes", () => {
    expect(dayTagCreateSchema.safeParse({ day: "2026-07-05", kind: "training" }).success).toBe(true);
    expect(dayTagCreateSchema.safeParse({ day: "2026-07-05T00:00:00Z", kind: "training" }).success).toBe(false);
  });
});

describe("enums", () => {
  it("rejects unknown confidence / kind", () => {
    expect(
      entryCreateSchema.safeParse({ consumedOn: "2026-07-05", quantityGrams: 10, confidence: "guessed" }).success
    ).toBe(false);
    expect(dayTagCreateSchema.safeParse({ day: "2026-07-05", kind: "recovery" }).success).toBe(false);
  });
});

describe("entry", () => {
  it("requires a positive quantity", () => {
    expect(
      entryCreateSchema.safeParse({ consumedOn: "2026-07-05", quantityGrams: 0, confidence: "measured" }).success
    ).toBe(false);
  });
  it("accepts an ad-hoc estimate with a note and absolute macros", () => {
    const r = entryCreateSchema.safeParse({
      consumedOn: "2026-07-05",
      quantityGrams: 200,
      confidence: "estimated",
      calories: 380,
      proteinContent: 52,
      note: "one big thigh, eyeballed",
    });
    expect(r.success).toBe(true);
  });
});

describe("strictness & normalization", () => {
  it("rejects unknown keys", () => {
    expect(
      foodCreateSchema.safeParse({ name: "whey", source: "custom", bogus: true }).success
    ).toBe(false);
  });
  it("trims names", () => {
    const r = foodCreateSchema.parse({ name: "  unflavored whey  ", source: "custom" });
    expect(r.name).toBe("unflavored whey");
  });
});

describe("patch schemas allow partial input", () => {
  it("food patch accepts a single field", () => {
    expect(foodPatchSchema.safeParse({ name: "renamed" }).success).toBe(true);
  });
  it("entry patch accepts correcting one macro", () => {
    expect(entryPatchSchema.safeParse({ proteinContent: 50 }).success).toBe(true);
  });
  it("target profile create validates", () => {
    expect(
      targetProfileCreateSchema.safeParse({ kind: "training", effectiveFrom: "2026-01-01", calories: 2800 }).success
    ).toBe(true);
  });
});
