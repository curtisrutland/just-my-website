import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { garageWrite } from "@/lib/garage/http";
import { hardDeleteRideTag, patchRideTag, softDeleteRideTag } from "@/lib/garage/repo";
import { rideTagPatchSchema } from "@/lib/garage/schema";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — move a tagged ride to another bike; it becomes a manual tag. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, rideTagPatchSchema);
  if (!parsed.ok) return parsed.response;
  const id = (await params).id;
  return garageWrite(async () => {
    const tag = await patchRideTag(id, parsed.data);
    return tag ? ok(tag) : notFound("Ride tag not found");
  });
}

/** DELETE — untag (soft); `?hard=true` requires the primary key. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteRideTag(id) : await softDeleteRideTag(id);
  return done ? noContent() : notFound("Ride tag not found");
}
