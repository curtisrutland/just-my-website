import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse } from "@/lib/http/errors";
import { isValidDate } from "@/lib/http/params";
import { ok } from "@/lib/http/responses";
import { getRollup } from "@/lib/weight/repo";

/** The trend rollup: per-day series (raw + 7-day average) + summary stats. `?window=` `?end=`. */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const windowRaw = Number.parseInt(sp.get("window") ?? "90", 10);
  const window = Number.isNaN(windowRaw) ? 90 : Math.min(Math.max(windowRaw, 7), 3650);

  const end = sp.get("end") ?? undefined;
  if (end && !isValidDate(end)) {
    return errorResponse(400, "validation_error", "end must be a YYYY-MM-DD date", { end: ["Invalid ISO date"] });
  }
  return ok(await getRollup({ window, end }));
}
