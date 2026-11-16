import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { garageWrite } from "@/lib/garage/http";
import { getBike, hardDeleteBike, patchBike, softDeleteBike } from "@/lib/garage/repo";
import { bikePatchSchema, bikeWindowSchema } from "@/lib/garage/schema";
import { notFound, parseJson, validationError } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const window = bikeWindowSchema.safeParse({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  if (!window.success) return validationError(window.error);
  const bike = await getBike((await params).id, window.data);
  return bike ? ok(bike) : notFound("Bike not found");
}

/** PATCH — edit a bike. `profiles` replaces its rule set; `retiredOn` retires it (dropping its rules). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, bikePatchSchema);
  if (!parsed.ok) return parsed.response;
  const id = (await params).id;
  return garageWrite(async () => {
    const bike = await patchBike(id, parsed.data);
    return bike ? ok(bike) : notFound("Bike not found");
  });
}

/** DELETE — soft by default (with its profiles and ride tags); `?hard=true` requires the primary key. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteBike(id) : await softDeleteBike(id);
  return done ? noContent() : notFound("Bike not found");
}
