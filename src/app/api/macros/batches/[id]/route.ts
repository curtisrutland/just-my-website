import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { macroDomainErrorResponse } from "@/lib/macros/http";
import { getBatchById, hardDeleteBatch, patchBatch, softDeleteBatch } from "@/lib/macros/repo";
import { batchPatchSchema } from "@/lib/macros/schema";

type Ctx = { params: Promise<{ id: string }> };

/** The detail view: the row + derived status/consumption (`remainingGrams` is advisory). */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const batch = await getBatchById((await params).id);
  return batch ? ok(batch) : notFound("Batch not found");
}

/** Corrections, and the lifecycle verb: finish = { finishedOn }, undo = { finishedOn: null }. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, batchPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const batch = await patchBatch((await params).id, parsed.data);
    return batch ? ok(batch) : notFound("Batch not found");
  } catch (e) {
    const domain = macroDomainErrorResponse(e);
    if (domain) return domain;
    throw e;
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  // Soft-delete by default (either token); hard delete (?hard=true) requires the primary key.
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteBatch(id) : await softDeleteBatch(id);
  return done ? noContent() : notFound("Batch not found");
}
