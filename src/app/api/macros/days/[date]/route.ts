import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { isValidDate } from "@/lib/http/params";
import { getDayRollup } from "@/lib/macros/repo";

type Ctx = { params: Promise<{ date: string }> };

/** The day-rollup (HANDOFF-CODE): totals, estimation, resolved target(s), and the day's entries. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) {
    return errorResponse(400, "validation_error", "date must be a YYYY-MM-DD calendar date", {
      date: ["Invalid ISO date"],
    });
  }
  return ok(await getDayRollup(date));
}
