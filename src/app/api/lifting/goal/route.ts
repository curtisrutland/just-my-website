import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse, parseJson } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { getGoalOn, setGoal } from "@/lib/lifting/repo";
import { liftingGoalCreateSchema } from "@/lib/lifting/schema";

/**
 * GET /api/lifting/goal — the goal statement in force today (or on `?on=YYYY-MM-DD`), or `null` if
 * none was ever set. This is the frame every session read is meant to be judged against; the same
 * goal also rides along on the session reads themselves so it can't be missed.
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const on = request.nextUrl.searchParams.get("on") ?? undefined;
  if (on != null && !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return errorResponse(400, "validation_error", "on must be a YYYY-MM-DD calendar date", {
      on: ["expected YYYY-MM-DD"],
    });
  }

  return ok(await getGoalOn(on));
}

/**
 * POST /api/lifting/goal — set the goal. One live goal per `effectiveFrom` date (default today), so
 * this is an upsert on that date: restating today's goal rewords it, a new date supersedes without
 * touching history. 200 + Location, not 201 (CONVENTIONS §7 — set/replace, not fresh creation).
 */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, liftingGoalCreateSchema);
  if (!parsed.ok) return parsed.response;
  const goal = await setGoal(parsed.data);
  return ok(goal, { headers: { Location: `/api/lifting/goals/${goal.id}` } });
}
