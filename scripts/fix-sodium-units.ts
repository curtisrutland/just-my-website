import "../src/lib/db/load-env"; // must be first — sets DATABASE_URL before the db client evaluates
import { and, isNotNull, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { macroBatch, macroEntry, macroFood } from "../src/lib/db/schema";
import { patchBatch, patchEntry, patchFood } from "../src/lib/macros/repo";
import { batchPatchSchema, entryPatchSchema, foodPatchSchema } from "../src/lib/macros/schema";

/**
 * One-off data fix for #93: label-pinned foods stored sodium in mg (the label's unit) where
 * CONVENTIONS stores grams, and every entry snapshotted from them inherited it. Divides the mg
 * values by 1000 through the module's own write path (schema.parse → repo patch).
 *
 *   npx tsx scripts/fix-sodium-units.ts           # dry run: what would change
 *   npx tsx scripts/fix-sodium-units.ts --apply   # write it
 *
 * Detection is re-derived on every run and matches nothing once fixed, so a second run is a no-op.
 *  - foods/batches: non-USDA per-100g sodium > 5. Real foods top out near 5.5 g/100g (soy sauce,
 *    which is USDA); the mg rows start at 16.7. USDA rows are always grams.
 *  - entries: linked to a food/batch above; or sodium ≥ 10% of the entry's weight (impossible in
 *    grams short of salt) and over 10; or ≥ 20× its linked food's per-100g (an old mg estimate on a
 *    since-fixed food: the H-E-B strawberries).
 * `labelBasis` is untouched: it's the label verbatim, and the label prints mg.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const live = <T extends typeof macroFood | typeof macroBatch | typeof macroEntry>(t: T) =>
    and(isNotNull(t.sodiumContent), isNull(t.deletedAt));
  const foods = await db.select().from(macroFood).where(live(macroFood));
  const batches = await db.select().from(macroBatch).where(live(macroBatch));
  const entries = await db.select().from(macroEntry).where(live(macroEntry));

  const badFoods = foods.filter((f) => f.source !== "usda" && f.sodiumContent! > 5);
  const badBatches = batches.filter((b) => b.sodiumContent! > 5);
  const badFoodIds = new Set(badFoods.map((f) => f.id));
  const badBatchIds = new Set(badBatches.map((b) => b.id));
  const foodPer100 = new Map(foods.map((f) => [f.id, f.sodiumContent!]));

  const why = (e: (typeof entries)[number]): string | null => {
    if (e.foodId && badFoodIds.has(e.foodId)) return "food";
    if (e.batchId && badBatchIds.has(e.batchId)) return "batch";
    // The > 10 keeps a corrected entry with a bogus quantity (a 1 g "Chili's burger" at 2.6 g) from
    // matching again: no real entry carries 10 g of sodium, and every mg row caught here was ≥ 24.
    if (e.quantityGrams > 0 && e.sodiumContent! / e.quantityGrams >= 0.1 && e.sodiumContent! > 10) return "ratio";
    const f = e.foodId ? foodPer100.get(e.foodId) : undefined;
    if (f !== undefined && e.quantityGrams > 0 && (e.sodiumContent! / e.quantityGrams) * 100 > 20 * f + 0.05) return "vs-food";
    return null;
  };
  const badEntries = entries.map((e) => ({ e, why: why(e) })).filter((x) => x.why);
  const byWhy = badEntries.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.why!]: (acc[x.why!] ?? 0) + 1 }), {});

  console.log(`${apply ? "APPLYING" : "DRY RUN"} — sodium mg → g (#93)`);
  console.log(`  foods:   ${badFoods.length}`);
  for (const f of badFoods) console.log(`    ${f.name}: ${f.sodiumContent} → ${f.sodiumContent! / 1000}`);
  console.log(`  batches: ${badBatches.length}`);
  for (const b of badBatches) console.log(`    ${b.name} (${b.madeOn}): ${b.sodiumContent} → ${b.sodiumContent! / 1000}`);
  console.log(`  entries: ${badEntries.length}`, byWhy);
  if (!apply) return;

  for (const f of badFoods) await patchFood(f.id, foodPatchSchema.parse({ sodiumContent: f.sodiumContent! / 1000 }));
  for (const b of badBatches) await patchBatch(b.id, batchPatchSchema.parse({ sodiumContent: b.sodiumContent! / 1000 }));
  for (const { e } of badEntries) await patchEntry(e.id, entryPatchSchema.parse({ sodiumContent: e.sodiumContent! / 1000 }));
  console.log("done");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
