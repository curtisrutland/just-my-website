import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { macroDayTag, macroEntry, macroFood, macroTargetProfile } from "@/lib/db/schema";
import {
  createEntry,
  createFood,
  createTargetProfile,
  getDayRollup,
  setDayTag,
} from "./repo";

/**
 * Integration test against the live Neon dev database. Seeds rows on a far-future sentinel
 * date (no collision with real data), exercises the day-rollup, and hard-deletes everything
 * it created afterward. Requires DATABASE_URL (loaded from .env.local by vitest.setup.ts).
 */

const DAY = "2999-03-15";
const EFFECTIVE = "2999-01-01";
const createdFoodIds: string[] = [];

async function cleanup() {
  await db.delete(macroEntry).where(eq(macroEntry.consumedOn, DAY));
  await db.delete(macroDayTag).where(eq(macroDayTag.day, DAY));
  await db.delete(macroTargetProfile).where(eq(macroTargetProfile.effectiveFrom, EFFECTIVE));
  for (const id of createdFoodIds) await db.delete(macroFood).where(eq(macroFood.id, id));
}

beforeAll(async () => {
  await cleanup(); // idempotent: clear any leftovers from a prior interrupted run.
  // Targets in effect on DAY.
  await createTargetProfile({ kind: "training", effectiveFrom: EFFECTIVE, calories: 2800, proteinContent: 160, fatContent: 90, carbohydrateContent: 300 });
  await createTargetProfile({ kind: "rest", effectiveFrom: EFFECTIVE, calories: 2200, proteinContent: 160, fatContent: 70, carbohydrateContent: 200 });

  // A measured entry with absolute macros supplied directly.
  await createEntry({ consumedOn: DAY, quantityGrams: 300, confidence: "measured", calories: 1000, proteinContent: 100, fatContent: 30, carbohydrateContent: 50 });
  // An ad-hoc estimated entry.
  await createEntry({ consumedOn: DAY, quantityGrams: 40, confidence: "estimated", calories: 400, proteinContent: 8, fatContent: 36, carbohydrateContent: 8, note: "couple handfuls almonds" });
});

afterAll(async () => {
  await db.delete(macroEntry).where(eq(macroEntry.consumedOn, DAY));
  await db.delete(macroDayTag).where(eq(macroDayTag.day, DAY));
  await db.delete(macroTargetProfile).where(eq(macroTargetProfile.effectiveFrom, EFFECTIVE));
  for (const id of createdFoodIds) await db.delete(macroFood).where(eq(macroFood.id, id));
});

describe("day rollup", () => {
  it("sums totals and computes the estimated-calorie fraction", async () => {
    const r = await getDayRollup(DAY);
    expect(r.totals.calories).toBe(1400);
    expect(r.totals.proteinContent).toBe(108);
    expect(r.estimation.entryCount).toBe(2);
    expect(r.estimation.estimatedCount).toBe(1);
    // 400 estimated kcal of 1400 total.
    expect(r.estimation.estimatedFraction).toBeCloseTo(400 / 1400, 6);
  });

  it("returns BOTH targets on an unspecified day", async () => {
    const r = await getDayRollup(DAY);
    expect(r.day.kind).toBe("unspecified");
    expect(r.targets.training?.calories).toBe(2800);
    expect(r.targets.rest?.calories).toBe(2200);
  });

  it("returns a single target once the day is tagged", async () => {
    await setDayTag({ day: DAY, kind: "training" });
    const r = await getDayRollup(DAY);
    expect(r.day.kind).toBe("training");
    expect(r.targets.training?.calories).toBe(2800);
    expect(r.targets.rest).toBeUndefined();
  });
});

describe("entry macro snapshotting", () => {
  it("derives absolute macros from the food's per-100g values × quantity", async () => {
    const food = await createFood({ name: "test whey (per-100g)", source: "custom", calories: 100, proteinContent: 20 });
    createdFoodIds.push(food.id);
    const entry = await createEntry({ consumedOn: DAY, foodId: food.id, quantityGrams: 250, confidence: "logged_serving" });
    // 250g at 100 kcal/100g -> 250 kcal; 20g protein/100g -> 50g.
    expect(entry.calories).toBe(250);
    expect(entry.proteinContent).toBe(50);
    expect(entry.foodId).toBe(food.id);
  });
});
