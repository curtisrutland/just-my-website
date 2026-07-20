import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { ok } from "@/lib/http/responses";
import { catchUp } from "@/lib/lifting/repo";

/**
 * POST /api/lifting/pull — the JMW-token pull. Pages `GET /v1/workouts` and ingests any workout we
 * don't have (or whose Hevy `updated_at` advanced), idempotently. One endpoint, two jobs:
 *  - the one-time initial BACKFILL — pass `?pages=N` large enough to reach the first workout;
 *  - the ongoing CATCH-UP for a missed webhook — default `pages=1` (most recent page).
 */

const MAX_PAGES = 1000;

export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const raw = request.nextUrl.searchParams.get("pages");
  const parsed = raw != null ? Number.parseInt(raw, 10) : 1;
  const pages = Number.isNaN(parsed) ? 1 : Math.min(MAX_PAGES, Math.max(1, parsed));

  return ok(await catchUp({ pages }));
}
