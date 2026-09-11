import type { NextRequest } from "next/server";
import { requireDisplayToken } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { isValidDate } from "@/lib/http/params";
import { getDayRollup } from "@/lib/macros/repo";

type Ctx = { params: Promise<{ date: string }> };

/**
 * The day-rollup (HANDOFF-CODE): totals, estimation, the resolved target, and the day's entries.
 * AUTH: the one route that accepts `JMW_DISPLAY_TOKEN` (the ESP32 display), via `requireDisplayToken`.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireDisplayToken(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) {
    return errorResponse(400, "validation_error", "date must be a YYYY-MM-DD calendar date", {
      date: ["Invalid ISO date"],
    });
  }
  return ok(await getDayRollup(date));
}
