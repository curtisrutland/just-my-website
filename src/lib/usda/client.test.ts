import { describe, expect, it } from "vitest";
import { foodCreateSchema } from "@/lib/macros/schema";
import { mapToFoodCreate, type FdcFood } from "./client";

// Shaped after a real FDC food-detail response (SR Legacy, per-100g).
const food: FdcFood = {
  fdcId: 172854,
  description: "Chicken, cooked",
  dataType: "SR Legacy",
  foodNutrients: [
    { nutrient: { number: "951", name: "Proximates", unitName: "G" } }, // grouping row, no amount
    { nutrient: { number: "208", name: "Energy", unitName: "KCAL" }, amount: 443 },
    { nutrient: { number: "268", name: "Energy", unitName: "kJ" }, amount: 1855 }, // kJ — must be ignored
    { nutrient: { number: "203", name: "Protein", unitName: "G" }, amount: 14.61 },
    { nutrient: { number: "204", name: "Total lipid (fat)", unitName: "G" }, amount: 42.76 },
    { nutrient: { number: "205", name: "Carbohydrate, by difference", unitName: "G" }, amount: 0 },
    { nutrient: { number: "307", name: "Sodium, Na", unitName: "MG" }, amount: 90 }, // mg -> 0.09 g
    // fiber / sugar / saturated fat absent -> null
  ],
};

describe("mapToFoodCreate", () => {
  const r = mapToFoodCreate(food);

  it("picks the kcal energy row, not kJ", () => {
    expect(r.calories).toBe(443);
  });
  it("maps mass macros in grams", () => {
    expect(r.proteinContent).toBe(14.61);
    expect(r.fatContent).toBe(42.76);
    expect(r.carbohydrateContent).toBe(0);
  });
  it("converts sodium from mg to grams", () => {
    expect(r.sodiumContent).toBeCloseTo(0.09, 6);
  });
  it("nulls nutrients the food does not report", () => {
    expect(r.fiberContent).toBeNull();
    expect(r.sugarContent).toBeNull();
    expect(r.saturatedFatContent).toBeNull();
  });
  it("sets usda source, fdcId, and name", () => {
    expect(r.source).toBe("usda");
    expect(r.fdcId).toBe(172854);
    expect(r.name).toBe("Chicken, cooked");
  });
  it("produces output that passes foodCreateSchema", () => {
    expect(foodCreateSchema.safeParse(r).success).toBe(true);
  });
});

// Shaped after a real Foundation food-detail response (fdcId 2646170, chicken breast raw):
// Foundation foods carry NO #208 — energy exists only as the Atwater rows #957/#958. This is the
// exact shape that used to pin with null calories.
const foundationFood: FdcFood = {
  fdcId: 2646170,
  description: "Chicken, breast, boneless, skinless, raw",
  dataType: "Foundation",
  foodNutrients: [
    { nutrient: { number: "957", name: "Energy (Atwater General Factors)", unitName: "KCAL" }, amount: 106.034 },
    { nutrient: { number: "958", name: "Energy (Atwater Specific Factors)", unitName: "KCAL" }, amount: 112.20227 },
    { nutrient: { number: "203", name: "Protein", unitName: "G" }, amount: 22.525 },
    { nutrient: { number: "204", name: "Total lipid (fat)", unitName: "G" }, amount: 1.934 },
    { nutrient: { number: "205", name: "Carbohydrate, by difference", unitName: "G" }, amount: 0 },
  ],
};

describe("mapToFoodCreate energy cascade (Foundation foods)", () => {
  it("falls back to Atwater General (#957) when #208 is absent", () => {
    expect(mapToFoodCreate(foundationFood).calories).toBe(106.034);
  });

  it("falls back to Atwater Specific (#958) when #208 and #957 are absent", () => {
    const only958: FdcFood = {
      ...foundationFood,
      foodNutrients: foundationFood.foodNutrients!.filter((n) => n.nutrient?.number !== "957"),
    };
    expect(mapToFoodCreate(only958).calories).toBe(112.20227);
  });

  it("prefers #208 over the Atwater rows when both exist", () => {
    const with208: FdcFood = {
      ...foundationFood,
      foodNutrients: [
        { nutrient: { number: "208", name: "Energy", unitName: "KCAL" }, amount: 110 },
        ...foundationFood.foodNutrients!,
      ],
    };
    expect(mapToFoodCreate(with208).calories).toBe(110);
  });

  it("nulls calories when no kcal energy row exists at all", () => {
    const noEnergy: FdcFood = {
      ...foundationFood,
      foodNutrients: foundationFood.foodNutrients!.filter((n) => !["957", "958"].includes(n.nutrient?.number ?? "")),
    };
    expect(mapToFoodCreate(noEnergy).calories).toBeNull();
  });

  it("still passes foodCreateSchema", () => {
    expect(foodCreateSchema.safeParse(mapToFoodCreate(foundationFood)).success).toBe(true);
  });
});
