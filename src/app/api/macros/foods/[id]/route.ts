import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { getFoodById, hardDeleteFood, patchFood, softDeleteFood } from "@/lib/macros/repo";
import { foodPatchSchema } from "@/lib/macros/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const food = await getFoodById((await params).id);
  return food ? ok(food) : notFound("Food not found");
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, foodPatchSchema);
  if (!parsed.ok) return parsed.response;
  const food = await patchFood((await params).id, parsed.data);
  return food ? ok(food) : notFound("Food not found");
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  // Soft-delete by default (either token); hard delete (?hard=true) requires the primary key.
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteFood(id) : await softDeleteFood(id);
  return done ? noContent() : notFound("Food not found");
}
