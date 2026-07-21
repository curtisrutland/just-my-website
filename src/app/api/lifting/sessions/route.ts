import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { ok } from "@/lib/http/responses";
import { listSessions } from "@/lib/lifting/repo";
import { liftingFocus, type LiftingFocus } from "@/lib/lifting/schema";

/**
 * GET /api/lifting/sessions — the journal list. Paginated session summaries (derived headline +
 * annotation + PR flags), newest first. Filters: `interpreted` (true|false — drives Claude's
 * un-read queue), `focus` (a liftingFocus value), and `from`/`to` (inclusive ISO bounds on the
 * session start).
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const { limit, offset } = parsePagination(sp);

  let interpreted: boolean | undefined;
  const interpretedParam = sp.get("interpreted");
  if (interpretedParam === "true") interpreted = true;
  else if (interpretedParam === "false") interpreted = false;
  else if (interpretedParam != null) {
    return errorResponse(400, "validation_error", "interpreted must be 'true' or 'false'", {
      interpreted: ["expected 'true' or 'false'"],
    });
  }

  let focus: LiftingFocus | undefined;
  const focusParam = sp.get("focus");
  if (focusParam != null) {
    const result = liftingFocus.safeParse(focusParam);
    if (!result.success) {
      return errorResponse(400, "validation_error", "invalid focus", {
        focus: [`expected one of ${liftingFocus.options.join(", ")}`],
      });
    }
    focus = result.data;
  }

  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  if (from != null && Number.isNaN(Date.parse(from))) {
    return errorResponse(400, "validation_error", "from must be an ISO date or datetime", { from: ["unparseable"] });
  }
  if (to != null && Number.isNaN(Date.parse(to))) {
    return errorResponse(400, "validation_error", "to must be an ISO date or datetime", { to: ["unparseable"] });
  }

  const { items, count } = await listSessions({ limit, offset, interpreted, focus, from, to });
  return ok(paginated(items, count, limit, offset));
}
