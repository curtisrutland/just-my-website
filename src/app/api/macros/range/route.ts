import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { isValidDate } from "@/lib/http/params";
import { addDays } from "@/lib/date";
import { getRange } from "@/lib/macros/repo";

const MAX_SPAN_DAYS = 366;

/** Per-day four-macro totals across an inclusive [start, end] span — one row per day (empty days
 *  zeroed, never missing), each with the day's kind and applicable target(s). For trend reasoning. */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const start = request.nextUrl.searchParams.get("start") ?? "";
  const end = request.nextUrl.searchParams.get("end") ?? "";
  if (!isValidDate(start) || !isValidDate(end)) {
    return errorResponse(400, "validation_error", "start and end must be YYYY-MM-DD calendar dates", {
      ...(isValidDate(start) ? {} : { start: ["Invalid ISO date"] }),
      ...(isValidDate(end) ? {} : { end: ["Invalid ISO date"] }),
    });
  }
  if (start > end) {
    return errorResponse(400, "validation_error", "start must be on or before end", { start: ["after end"] });
  }
  if (end > addDays(start, MAX_SPAN_DAYS - 1)) {
    return errorResponse(400, "validation_error", `range may span at most ${MAX_SPAN_DAYS} days`, {
      end: [`more than ${MAX_SPAN_DAYS} days after start`],
    });
  }
  return ok(await getRange(start, end));
}
