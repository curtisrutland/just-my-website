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
    const r = foodCreateSchema.safeParse({ name: "whey", source: "scanned", category: "protein-powder", calories: "22 g" });
    expect(r.success).toBe(false);
  });
  it("accepts bare numbers for macros", () => {
    const r = foodCreateSchema.safeParse({ name: "whey", source: "scanned", category: "protein-powder", calories: 380, proteinContent: 24 });
    expect(r.success).toBe(true);
  });
  it("rejects negative macros", () => {
    const r = foodCreateSchema.safeParse({ name: "whey", source: "scanned", category: "protein-powder", calories: -1 });
    expect(r.success).toBe(false);
  });
});

describe("food source / fdcId invariant", () => {
  it("usda requires an fdcId", () => {
    expect(foodCreateSchema.safeParse({ name: "chicken", source: "usda" }).success).toBe(false);
    expect(foodCreateSchema.safeParse({ name: "chicken", source: "usda", fdcId: 172854 }).success).toBe(true);
  });
  it("a non-usda food must not carry an fdcId", () => {
    expect(foodCreateSchema.safeParse({ name: "bar", source: "estimated", category: "other", fdcId: 1 }).success).toBe(false);
    expect(foodCreateSchema.safeParse({ name: "bar", source: "estimated", category: "other" }).success).toBe(true);
  });
});

describe("food provenance + category (ingredient registry)", () => {
  it("retires 'custom' from the source enum", () => {
    expect(foodCreateSchema.safeParse({ name: "bar", source: "custom", category: "other" }).success).toBe(false);
  });
  it("accepts the expanded provenance values", () => {
    for (const source of ["scanned", "proxy", "estimated"] as const) {
      expect(foodCreateSchema.safeParse({ name: "skyr", source, category: "yogurt" }).success).toBe(true);
    }
  });
  it("requires a category for non-usda foods", () => {
    expect(foodCreateSchema.safeParse({ name: "ripple", source: "scanned" }).success).toBe(false);
    expect(foodCreateSchema.safeParse({ name: "ripple", source: "scanned", category: "plant-milk" }).success).toBe(true);
  });
  it("does not require a category for usda foods", () => {
    expect(foodCreateSchema.safeParse({ name: "chicken", source: "usda", fdcId: 172854 }).success).toBe(true);
  });
  it("rejects an unknown category", () => {
    expect(foodCreateSchema.safeParse({ name: "x", source: "estimated", category: "smoothie" }).success).toBe(false);
  });
  it("accepts new whole-food categories added on review", () => {
    for (const category of ["egg", "legume", "beverage", "cheese"] as const) {
      expect(foodCreateSchema.safeParse({ name: "x", source: "estimated", category }).success).toBe(true);
    }
  });
  it("accepts brand, tags, and a verbatim labelBasis", () => {
    const r = foodCreateSchema.safeParse({
      name: "Ripple Unsweetened",
      source: "scanned",
      category: "plant-milk",
      brand: "Ripple",
      tags: ["low-fat", "liquid"],
      proteinContent: 8,
      labelBasis: { servingLabel: "1 cup", servingGrams: 240, calories: 100, proteinContent: 8 },
    });
    expect(r.success).toBe(true);
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
      foodCreateSchema.safeParse({ name: "whey", source: "estimated", category: "protein-powder", bogus: true }).success
    ).toBe(false);
  });
  it("trims names", () => {
    const r = foodCreateSchema.parse({ name: "  unflavored whey  ", source: "estimated", category: "protein-powder" });
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
