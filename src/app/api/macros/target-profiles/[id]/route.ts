import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import {
  hardDeleteTargetProfile,
  patchTargetProfile,
  softDeleteTargetProfile,
} from "@/lib/macros/repo";
import { targetProfilePatchSchema } from "@/lib/macros/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, targetProfilePatchSchema);
  if (!parsed.ok) return parsed.response;
  const profile = await patchTargetProfile((await params).id, parsed.data);
  return profile ? ok(profile) : notFound("Target profile not found");
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteTargetProfile(id) : await softDeleteTargetProfile(id);
  return done ? noContent() : notFound("Target profile not found");
}
