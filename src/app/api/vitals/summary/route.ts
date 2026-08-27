import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { isValidDate } from "@/lib/http/params";
import { ok } from "@/lib/http/responses";
import { getRollup } from "@/lib/vitals/repo";

/**
 * GET — the derived rollup: 7-day trailing averages and week-over-week deltas for resting HR, HRV
 * and sleep, plus the honest `gaps` list. Everything here is computed in the repo and never stored,
 * so it cannot drift from the measurements it summarizes.
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const windowParam = Number(sp.get("window"));
  const end = sp.get("end");
  const rollup = await getRollup({
    window: Number.isFinite(windowParam) && windowParam > 0 ? Math.min(windowParam, 365) : undefined,
    end: end && isValidDate(end) ? end : undefined,
  });
  return ok(rollup);
}
