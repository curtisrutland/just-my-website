import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { macroEntry, macroFood, macroTargetProfile } from "@/lib/db/schema";
import {
  createEntry,
  createFood,
  createTargetProfile,
  getDayRollup,
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
  await db.delete(macroTargetProfile).where(eq(macroTargetProfile.effectiveFrom, EFFECTIVE));
  for (const id of createdFoodIds) await db.delete(macroFood).where(eq(macroFood.id, id));
}

beforeAll(async () => {
  await cleanup(); // idempotent: clear any leftovers from a prior interrupted run.
  // Targets in effect on DAY.
  await createTargetProfile({ effectiveFrom: EFFECTIVE, calories: 2300, proteinContent: 160, fatContent: 75, carbohydrateContent: 220 });

  // A measured entry with absolute macros supplied directly.
  await createEntry({ consumedOn: DAY, quantityGrams: 300, confidence: "measured", calories: 1000, proteinContent: 100, fatContent: 30, carbohydrateContent: 50 });
  // An ad-hoc estimated entry.
  await createEntry({ consumedOn: DAY, quantityGrams: 40, confidence: "estimated", calories: 400, proteinContent: 8, fatContent: 36, carbohydrateContent: 8, note: "couple handfuls almonds" });
});

afterAll(async () => {
  await db.delete(macroEntry).where(eq(macroEntry.consumedOn, DAY));
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

  it("resolves the one target in effect on the day", async () => {
    const r = await getDayRollup(DAY);
    expect(r.target?.calories).toBe(2300);
    expect(r.target?.proteinContent).toBe(160);
  });
});

describe("entry macro snapshotting", () => {
  it("derives absolute macros from the food's per-100g values × quantity", async () => {
    const food = await createFood({ name: "test whey (per-100g)", source: "estimated", category: "protein-powder", calories: 100, proteinContent: 20 });
    createdFoodIds.push(food.id);
    const entry = await createEntry({ consumedOn: DAY, foodId: food.id, quantityGrams: 250, confidence: "logged_serving" });
    // 250g at 100 kcal/100g -> 250 kcal; 20g protein/100g -> 50g.
    expect(entry.calories).toBe(250);
    expect(entry.proteinContent).toBe(50);
    expect(entry.foodId).toBe(food.id);
  });
});

// Serialization guards for the two 2026-07 bug reports (both were consumer reads of keys that don't
// exist on the payload). Every entry must serialize its macros under the schema.org names,
// consistent with the day totals. The sum==totals check is the one the report says would catch Bug 2.
// The day-type keys (`day.kind`, `day_kind`) are retired and must NOT come back.
describe("day-rollup response shape", () => {
  const MACRO_KEYS = [
    "calories",
    "proteinContent",
    "fatContent",
    "carbohydrateContent",
    "fiberContent",
    "sugarContent",
    "sodiumContent",
    "saturatedFatContent",
  ] as const;

  it("carries per-entry macros and no day-type keys (no day.kind/day_kind, no short/`foodName` keys)", async () => {
    const r = await getDayRollup(DAY);
    expect(r.entries.length).toBeGreaterThan(0);

    // Day-type is retired: neither the nested nor the top-level key may reappear.
    expect("kind" in r.day).toBe(false);
    expect("day_kind" in r).toBe(false);

    for (const e of r.entries) {
      // Every macro key is present (value may be null) under its schema.org name.
      for (const k of MACRO_KEYS) expect(k in e).toBe(true);
      // The keys the bug reports guessed do NOT exist.
      expect("protein" in e).toBe(false);
      expect("fat" in e).toBe(false);
      expect("carbs" in e).toBe(false);
      expect("foodName" in e).toBe(false);
    }

    // Per-entry macros are consistent with the day totals (the Bug 2 regression guard).
    const sum = (k: (typeof MACRO_KEYS)[number]) => r.entries.reduce((a, e) => a + ((e[k] as number | null) ?? 0), 0);
    expect(sum("proteinContent")).toBeCloseTo(r.totals.proteinContent ?? 0, 6);
    expect(sum("fatContent")).toBeCloseTo(r.totals.fatContent ?? 0, 6);
    expect(sum("carbohydrateContent")).toBeCloseTo(r.totals.carbohydrateContent ?? 0, 6);

    // And the values genuinely exist (not just the keys) — at least one entry has real macros.
    expect(r.entries.some((e) => e.proteinContent != null && e.proteinContent > 0)).toBe(true);
  });
});
