import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { ok } from "@/lib/http/responses";
import { weeklyStats } from "@/lib/rides/repo";

/**
 * GET /api/rides/weekly — the rollup: per ISO week (Monday start), ride count / distance /
 * moving time / ascent / avg power, newest week first. Weeks with no rides are omitted.
 *  - `weeks` — max buckets returned (default 8, clamped 1–104)
 *  - `sport` — defaults to `cycling` (rides-first, per the module signature); pass `all` for
 *              every activity, or any Garmin sport string verbatim.
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const rawWeeks = Number.parseInt(sp.get("weeks") ?? "8", 10);
  const weeks = Number.isNaN(rawWeeks) ? 8 : Math.min(104, Math.max(1, rawWeeks));
  const sportParam = sp.get("sport") ?? "cycling";
  const sport = sportParam === "all" ? undefined : sportParam;

  return ok(await weeklyStats({ weeks, sport }));
}
