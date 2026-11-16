import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { garageWrite } from "@/lib/garage/http";
import { createRideTag, listRideTags } from "@/lib/garage/repo";
import { rideTagCreateSchema, rideTagListQuerySchema } from "@/lib/garage/schema";
import { parseJson, validationError } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";

/** GET — ride tags, newest ride first; filter by `bikeId`, `activityId`, `from`/`to` (local dates). */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const query = rideTagListQuerySchema.safeParse({
    bikeId: sp.get("bikeId") ?? undefined,
    activityId: sp.get("activityId") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  if (!query.success) return validationError(query.error);
  const { limit, offset } = parsePagination(sp);
  const { items, count } = await listRideTags(query.data, { limit, offset });
  return ok(paginated(items, count, limit, offset));
}

/**
 * POST — tag a ride by hand, with the ride's facts copied in. Already on this bike → 200 + the
 * existing tag (a replay); on another bike → 409 (move it with PATCH instead).
 */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, rideTagCreateSchema);
  if (!parsed.ok) return parsed.response;
  return garageWrite(async () => {
    const { tag, replay } = await createRideTag(parsed.data);
    const location = `/api/garage/rides/${tag.id}`;
    return replay ? ok(tag, { headers: { Location: location } }) : created(tag, location);
  });
}
