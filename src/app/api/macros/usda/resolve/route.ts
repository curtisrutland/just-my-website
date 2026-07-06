import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { resolveUsdaFood } from "@/lib/usda/resolve";

const resolveSchema = z.object({ fdcId: z.int().positive() }).strict();

/**
 * Resolve a USDA food by fdcId and cache it into `macro_food` (cache-on-first-resolve). Idempotent:
 * a subsequent resolve of the same fdcId is a local lookup. Returns the cached-or-created food.
 */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, resolveSchema);
  if (!parsed.ok) return parsed.response;
  const food = await resolveUsdaFood(parsed.data.fdcId);
  return ok(food, { headers: { Location: `/api/macros/foods/${food.id}` } });
}
