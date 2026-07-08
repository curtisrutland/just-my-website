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
// exist on the payload). The day-rollup response must carry the day's kind at `day.kind` (not a
// top-level `day_kind`), and every entry must serialize its macros under the schema.org names,
// consistent with the day totals. The sum==totals check is the one the report says would catch Bug 2.
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

  it("carries day.kind and per-entry macros (no day_kind, no short/`foodName` keys)", async () => {
    const r = await getDayRollup(DAY);
    expect(r.entries.length).toBeGreaterThan(0);

    // The day's kind is at `day.kind` (a non-empty string), NOT a top-level `day_kind`.
    expect(typeof r.day.kind).toBe("string");
    expect(r.day.kind.length).toBeGreaterThan(0);
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
