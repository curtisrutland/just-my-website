import type { MacroFood } from "@/lib/db/schema";
import { createFood, findLiveFoodByFdcId } from "@/lib/macros/repo";
import { foodCreateSchema } from "@/lib/macros/schema";
import { getFood, mapToFoodCreate } from "./client";

/**
 * Cache-on-first-resolve. The ONE place a live USDA call is allowed, and only on a cache miss:
 *  1. look for a live cached food by fdcId (a local DB read — the hot logging path);
 *  2. on miss, fetch from FDC once, map to per-100g, validate through the single validator
 *     (`foodCreateSchema`), and persist via the repo so the next resolve is a local lookup.
 * Keeps the live FDC request off the repeated-logging path (HANDOFF-CODE "USDA / food catalog").
 */
export async function resolveUsdaFood(fdcId: number): Promise<MacroFood> {
  const cached = await findLiveFoodByFdcId(fdcId);
  if (cached) return cached;

  const food = await getFood(fdcId);
  const parsed = foodCreateSchema.parse(mapToFoodCreate(food));
  return createFood(parsed);
}
