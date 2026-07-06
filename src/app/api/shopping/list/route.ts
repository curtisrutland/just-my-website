import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { ok } from "@/lib/http/responses";
import { getList } from "@/lib/shopping/repo";

/** The two-section list view: active (grouped by category) + recentlyBought + activeCount.
 *  Optional `?boughtWithinDays=` (default 7) widens/narrows the recently-bought window. */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;

  const raw = request.nextUrl.searchParams.get("boughtWithinDays");
  let boughtWithinDays: number | undefined;
  if (raw !== null) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) boughtWithinDays = Math.min(Math.max(n, 1), 365);
  }
  return ok(await getList({ boughtWithinDays }));
}
