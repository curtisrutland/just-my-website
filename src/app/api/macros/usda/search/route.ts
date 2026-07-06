import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { searchFoods } from "@/lib/usda/client";

/** Search USDA FoodData Central. A discovery call — not a write; nothing is cached here. */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const q = request.nextUrl.searchParams.get("q");
  if (!q) {
    return errorResponse(400, "validation_error", "q is required", { q: ["Required"] });
  }
  const items = await searchFoods(q, { pageSize: 10 });
  return ok({ items });
}
