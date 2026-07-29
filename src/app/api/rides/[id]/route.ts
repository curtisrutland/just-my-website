import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { deleteRideFile } from "@/lib/rides/blob";
import { getRide, hardDeleteRide, patchRide, softDeleteRide } from "@/lib/rides/repo";
import { ridePatchSchema } from "@/lib/rides/schema";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the full ride. `?streams=1` includes the downsampled arrays (heavy; off by default —
 *  the agent wants the summary, not 1,800-point arrays). */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const includeStream = request.nextUrl.searchParams.get("streams") === "1";
  const ride = await getRide((await params).id, { includeStream });
  return ride ? ok(ride) : notFound("Ride not found");
}

/**
 * PATCH — the human layer ONLY (`name`, `note`; both clearable). Every measured column is
 * immutable from the surfaces — `.strict()` turns `{ avgPowerWatts: 250 }` into a 400.
 * Corrections to facts happen via POST /api/rides/{id}/reprocess.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, ridePatchSchema);
  if (!parsed.ok) return parsed.response;
  const ride = await patchRide((await params).id, parsed.data);
  return ride ? ok(ride) : notFound("Ride not found");
}

/**
 * DELETE — soft by default (agent token allowed; the blob stays). `?hard=true` requires the
 * primary key, cascades to the stream, and removes the raw file from Blob storage too.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  if (!hard) {
    return (await softDeleteRide(id)) ? noContent() : notFound("Ride not found");
  }
  const row = await hardDeleteRide(id);
  if (!row) return notFound("Ride not found");
  await deleteRideFile(row.blobKey);
  return noContent();
}
