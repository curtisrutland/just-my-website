import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { garageWrite } from "@/lib/garage/http";
import { createBike, listBikes } from "@/lib/garage/repo";
import { bikeCreateSchema, bikeWindowSchema } from "@/lib/garage/schema";
import { parseJson, validationError } from "@/lib/http/errors";
import { created, ok } from "@/lib/http/responses";

/**
 * GET — every live bike with its profiles and derived totals; `?includeRetired=true` adds retired
 * ones; `?from=&to=` (local dates, inclusive) totals only the rides in that window.
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const window = bikeWindowSchema.safeParse({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  if (!window.success) return validationError(window.error);
  const includeRetired = sp.get("includeRetired") === "true";
  return ok({ items: await listBikes({ includeRetired, ...window.data }) });
}

/** POST — add a bike (nickname defaults to the model) with its profile rules. */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, bikeCreateSchema);
  if (!parsed.ok) return parsed.response;
  return garageWrite(async () => {
    const bike = await createBike(parsed.data);
    return created(bike, `/api/garage/bikes/${bike.id}`);
  });
}
