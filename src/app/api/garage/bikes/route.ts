import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { garageWrite } from "@/lib/garage/http";
import { createBike, listBikes } from "@/lib/garage/repo";
import { bikeCreateSchema } from "@/lib/garage/schema";
import { parseJson } from "@/lib/http/errors";
import { created, ok } from "@/lib/http/responses";

/** GET — every live bike with its profiles and derived totals; `?includeRetired=true` adds retired ones. */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const includeRetired = request.nextUrl.searchParams.get("includeRetired") === "true";
  return ok({ items: await listBikes({ includeRetired }) });
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
