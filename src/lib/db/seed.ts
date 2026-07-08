import "./load-env"; // must be first — sets DATABASE_URL before ./index is evaluated
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { macroDayTag, macroEntry, macroFood, macroTargetProfile } from "./schema";

const DAY = "2026-07-05";
const EFFECTIVE = "2026-01-01";

const WEEK: Array<{ date: string; kind: "training" | "rest" | "unspecified" }> = [
  { date: "2026-06-29", kind: "rest" },
  { date: "2026-06-30", kind: "training" },
  { date: "2026-07-01", kind: "training" },
  { date: "2026-07-02", kind: "rest" },
  { date: "2026-07-03", kind: "unspecified" },
  { date: "2026-07-04", kind: "training" },
  { date: "2026-07-05", kind: "unspecified" },
];

type SeedEntry = {
  food: string;
  quantityGrams: number;
  confidence: "measured" | "estimated" | "logged_serving";
  note: string | null;
  calories: number;
  proteinContent: number;
  fatContent: number;
  carbohydrateContent: number;
};

const ENTRIES: SeedEntry[] = [
  { food: "Oatmeal, cooked", quantityGrams: 350, confidence: "measured", note: null, calories: 330, proteinContent: 12, fatContent: 6, carbohydrateContent: 59 },
  { food: "Whey protein", quantityGrams: 68, confidence: "logged_serving", note: null, calories: 266, proteinContent: 54, fatContent: 2, carbohydrateContent: 6 },
  { food: "Banana", quantityGrams: 120, confidence: "logged_serving", note: null, calories: 105, proteinContent: 1, fatContent: 0, carbohydrateContent: 27 },
  { food: "Chicken thigh, cooked", quantityGrams: 180, confidence: "estimated", note: "one big thigh, eyeballed", calories: 342, proteinContent: 47, fatContent: 17, carbohydrateContent: 0 },
  { food: "Almonds", quantityGrams: 40, confidence: "estimated", note: "a couple handfuls", calories: 232, proteinContent: 8, fatContent: 20, carbohydrateContent: 8 },
  { food: "Greek yogurt", quantityGrams: 250, confidence: "measured", note: null, calories: 163, proteinContent: 25, fatContent: 5, carbohydrateContent: 10 },
  { food: "White rice, cooked", quantityGrams: 380, confidence: "logged_serving", note: null, calories: 494, proteinContent: 10, fatContent: 1, carbohydrateContent: 107 },
  { food: "Olive oil", quantityGrams: 15, confidence: "estimated", note: "a glug on the salad", calories: 133, proteinContent: 0, fatContent: 15, carbohydrateContent: 0 },
  { food: "Dark chocolate", quantityGrams: 28, confidence: "estimated", note: "a few squares", calories: 167, proteinContent: 2, fatContent: 11, carbohydrateContent: 14 },
];

const foodNames = [...new Set(ENTRIES.map((e) => e.food))];
const weekDates = WEEK.map((w) => w.date);

async function main() {
  // Idempotent: clear prior seed (entries before foods, to respect the FK).
  await db.delete(macroEntry).where(inArray(macroEntry.consumedOn, weekDates));
  await db.delete(macroFood).where(inArray(macroFood.name, foodNames));
  await db.delete(macroDayTag).where(inArray(macroDayTag.day, weekDates));
  await db.delete(macroTargetProfile).where(eq(macroTargetProfile.effectiveFrom, EFFECTIVE));

  await db.insert(macroTargetProfile).values([
    { kind: "training", effectiveFrom: EFFECTIVE, calories: 2800, proteinContent: 160, fatContent: 90, carbohydrateContent: 300 },
    { kind: "rest", effectiveFrom: EFFECTIVE, calories: 2200, proteinContent: 160, fatContent: 70, carbohydrateContent: 200 },
  ]);

  // Only training/rest days get a tag; unspecified days have no row (absence = unspecified).
  const tagged = WEEK.filter((w) => w.kind !== "unspecified");
  if (tagged.length) {
    await db.insert(macroDayTag).values(tagged.map((w) => ({ day: w.date, kind: w.kind })));
  }

  // Placeholder foods exist so entries show a name. Entries snapshot absolute macros regardless.
  // Seeded as source 'estimated' (no label) + category 'other' — the honest values for throwaway
  // placeholders (see the ingredient-registry provenance expansion; 'custom' is retired).
  const foods = await db
    .insert(macroFood)
    .values(foodNames.map((name) => ({ name, source: "estimated", category: "other" })))
    .returning({ id: macroFood.id, name: macroFood.name });
  const idByName = new Map(foods.map((f) => [f.name, f.id]));

  await db.insert(macroEntry).values(
    ENTRIES.map((e) => ({
      consumedOn: DAY,
      foodId: idByName.get(e.food) ?? null,
      quantityGrams: e.quantityGrams,
      confidence: e.confidence,
      note: e.note,
      calories: e.calories,
      proteinContent: e.proteinContent,
      fatContent: e.fatContent,
      carbohydrateContent: e.carbohydrateContent,
    }))
  );

  console.log(`Seeded: 2 target profiles, ${tagged.length} day tags, ${foods.length} foods, ${ENTRIES.length} entries on ${DAY}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
