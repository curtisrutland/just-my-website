import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { getEntryById, hardDeleteEntry, patchEntry, softDeleteEntry } from "@/lib/macros/repo";
import { entryPatchSchema } from "@/lib/macros/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const entry = await getEntryById((await params).id);
  return entry ? ok(entry) : notFound("Entry not found");
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, entryPatchSchema);
  if (!parsed.ok) return parsed.response;
  const entry = await patchEntry((await params).id, parsed.data);
  return entry ? ok(entry) : notFound("Entry not found");
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteEntry(id) : await softDeleteEntry(id);
  return done ? noContent() : notFound("Entry not found");
}
