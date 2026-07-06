import type { DayRollupData, MacroSet, RollupEntry, WeekDay } from "./types";

/**
 * Mock day for the dev preview (UI-CONTRACT §4 shape). The canonical Jul 5 day: unspecified,
 * total calories inside the rest→training corridor (the "in range" hero state), ~39% of calories
 * from estimated entries. Totals/estimation are derived from the entries, mirroring the real repo.
 */
const entries: RollupEntry[] = [
  { id: "e1", consumedOn: "2026-07-05", foodName: "Oatmeal, cooked", quantityGrams: 350, confidence: "measured", note: null, calories: 330, proteinContent: 12, fatContent: 6, carbohydrateContent: 59 },
  { id: "e2", consumedOn: "2026-07-05", foodName: "Whey protein", quantityGrams: 68, confidence: "logged_serving", note: null, calories: 266, proteinContent: 54, fatContent: 2, carbohydrateContent: 6 },
  { id: "e3", consumedOn: "2026-07-05", foodName: "Banana", quantityGrams: 120, confidence: "logged_serving", note: null, calories: 105, proteinContent: 1, fatContent: 0, carbohydrateContent: 27 },
  { id: "e4", consumedOn: "2026-07-05", foodName: "Chicken thigh, cooked", quantityGrams: 180, confidence: "estimated", note: "one big thigh, eyeballed", calories: 342, proteinContent: 47, fatContent: 17, carbohydrateContent: 0 },
  { id: "e5", consumedOn: "2026-07-05", foodName: "Almonds", quantityGrams: 40, confidence: "estimated", note: "a couple handfuls", calories: 232, proteinContent: 8, fatContent: 20, carbohydrateContent: 8 },
  { id: "e6", consumedOn: "2026-07-05", foodName: "Greek yogurt", quantityGrams: 250, confidence: "measured", note: null, calories: 163, proteinContent: 25, fatContent: 5, carbohydrateContent: 10 },
  { id: "e7", consumedOn: "2026-07-05", foodName: "White rice, cooked", quantityGrams: 380, confidence: "logged_serving", note: null, calories: 494, proteinContent: 10, fatContent: 1, carbohydrateContent: 107 },
  { id: "e8", consumedOn: "2026-07-05", foodName: "Olive oil", quantityGrams: 15, confidence: "estimated", note: "a glug on the salad", calories: 133, proteinContent: 0, fatContent: 15, carbohydrateContent: 0 },
  { id: "e9", consumedOn: "2026-07-05", foodName: "Dark chocolate", quantityGrams: 28, confidence: "estimated", note: "a few squares", calories: 167, proteinContent: 2, fatContent: 11, carbohydrateContent: 14 },
];

const sum = (k: keyof MacroSet) => entries.reduce((acc, e) => acc + (e[k] ?? 0), 0);
const totalCalories = sum("calories");
const estimatedCalories = entries
  .filter((e) => e.confidence === "estimated")
  .reduce((acc, e) => acc + (e.calories ?? 0), 0);

export const mockRollup: DayRollupData = {
  day: { date: "2026-07-05", kind: "unspecified" },
  totals: {
    calories: totalCalories,
    proteinContent: sum("proteinContent"),
    fatContent: sum("fatContent"),
    carbohydrateContent: sum("carbohydrateContent"),
  },
  estimation: {
    estimatedFraction: totalCalories > 0 ? estimatedCalories / totalCalories : 0,
    entryCount: entries.length,
    estimatedCount: entries.filter((e) => e.confidence === "estimated").length,
  },
  targets: {
    training: { calories: 2800, proteinContent: 160, fatContent: 90, carbohydrateContent: 300 },
    rest: { calories: 2200, proteinContent: 160, fatContent: 70, carbohydrateContent: 200 },
  },
  entries,
};

/** A 7-day window (Jun 29 – Jul 5) mixing kinds so every day-chip state is visible. */
export const mockWeek: WeekDay[] = [
  { date: "2026-06-29", kind: "rest" },
  { date: "2026-06-30", kind: "training" },
  { date: "2026-07-01", kind: "training" },
  { date: "2026-07-02", kind: "rest" },
  { date: "2026-07-03", kind: "unspecified" },
  { date: "2026-07-04", kind: "training" },
  { date: "2026-07-05", kind: "unspecified" },
];
