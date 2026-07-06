import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { getItemById, hardDeleteItem, patchItem, softDeleteItem } from "@/lib/shopping/repo";
import { shoppingPatchSchema } from "@/lib/shopping/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const item = await getItemById((await params).id);
  return item ? ok(item) : notFound("Shopping item not found");
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, shoppingPatchSchema);
  if (!parsed.ok) return parsed.response;
  const item = await patchItem((await params).id, parsed.data);
  return item ? ok(item) : notFound("Shopping item not found");
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteItem(id) : await softDeleteItem(id);
  return done ? noContent() : notFound("Shopping item not found");
}
