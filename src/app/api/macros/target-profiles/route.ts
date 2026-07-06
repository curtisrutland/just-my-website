import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { createTargetProfile, listTargetProfiles } from "@/lib/macros/repo";
import { targetProfileCreateSchema } from "@/lib/macros/schema";

export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const kind = request.nextUrl.searchParams.get("kind") ?? undefined;
  const { items, count } = await listTargetProfiles({ limit, offset, kind });
  return ok(paginated(items, count, limit, offset));
}

export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, targetProfileCreateSchema);
  if (!parsed.ok) return parsed.response;
  const profile = await createTargetProfile(parsed.data);
  return created(profile, `/api/macros/target-profiles/${profile.id}`);
}
