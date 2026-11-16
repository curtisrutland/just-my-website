import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse, notFound } from "@/lib/http/errors";
import { openRideFile } from "@/lib/rides/blob";
import { getRideStorageRow } from "@/lib/rides/repo";

/**
 * GET /api/rides/{id}/fit — the ride's raw FIT file, byte for byte as the device wrote it. The
 * stream on the detail read is a 10 s downsample; this is the full-resolution source, for a
 * client that needs every sample (docs/rides-model.md, docs/infographics.md).
 *
 * Normal JMW tokens only — NOT the publisher token, and NOT a device token (off the iOS
 * allowlist). The response carries the bytes and nothing about where they are stored.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const row = await getRideStorageRow((await params).id);
  if (!row) return notFound("Ride not found");
  const file = await openRideFile(row.blobKey);
  if (!file) return errorResponse(409, "conflict", "The raw FIT file is missing from storage");
  return new Response(file.stream, {
    headers: {
      "content-type": "application/octet-stream",
      // Only when storage states it: a wrong length would truncate the download.
      ...(file.size === null ? {} : { "content-length": String(file.size) }),
      "content-disposition": `attachment; filename="${row.localDate}-${row.id}.fit"`,
      "cache-control": "private, no-store",
    },
  });
}
