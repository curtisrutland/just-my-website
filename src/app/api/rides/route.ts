import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { validationError } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { ok } from "@/lib/http/responses";
import { listRides } from "@/lib/rides/repo";
import { rideListQuerySchema } from "@/lib/rides/schema";

/**
 * GET /api/rides — the log read: summaries (never streams), newest first. Filters:
 *  - `sport`   — Garmin sport string, verbatim ("cycling", "running", …)
 *  - `from`/`to` — bound the LOCAL calendar date (the honest "what did I ride in July" axis)
 *  - `q`       — substring on name OR device profile name (unnamed rides are the norm; "MTB"
 *                should find them)
 * There is no POST here — rides are never authored, only ingested (see /api/rides/upload).
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const query = rideListQuerySchema.safeParse({
    sport: sp.get("sport") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    q: sp.get("q") ?? undefined,
  });
  if (!query.success) return validationError(query.error);

  const { limit, offset } = parsePagination(sp);
  const { items, count } = await listRides({ limit, offset, ...query.data });
  return ok(paginated(items, count, limit, offset));
}
