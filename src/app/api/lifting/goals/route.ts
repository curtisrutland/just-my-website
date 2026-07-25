import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { ok } from "@/lib/http/responses";
import { listGoals } from "@/lib/lifting/repo";

/**
 * GET /api/lifting/goals — the goal history, newest first. Superseded goals are kept, so a reading
 * of an old block can be judged against the goal that actually applied at the time. Writes go
 * through `POST /api/lifting/goal` (upsert by date) or `PATCH /api/lifting/goals/{id}`.
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const { items, count } = await listGoals({ limit, offset });
  return ok(paginated(items, count, limit, offset));
}
