import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { createFood, listFoods } from "@/lib/macros/repo";
import { foodCreateSchema } from "@/lib/macros/schema";

export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const { items, count } = await listFoods({ limit, offset, q });
  return ok(paginated(items, count, limit, offset));
}

export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, foodCreateSchema);
  if (!parsed.ok) return parsed.response;
  const food = await createFood(parsed.data);
  return created(food, `/api/macros/foods/${food.id}`);
}
