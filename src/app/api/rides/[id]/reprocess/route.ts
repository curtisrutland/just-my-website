import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse, notFound, validationError } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { FitDecodeError } from "@/lib/rides/fit";
import { reprocessRideFromBlob } from "@/lib/rides/ingest";

/**
 * POST /api/rides/{id}/reprocess — re-decode the stored raw FIT and rewrite every fact column
 * + rebuild the stream, in place. The corrections lever (a wrong watt is fixed by fixing the
 * parser and reprocessing, not by editing the watt) and the back-fill lever (a parser upgrade
 * re-extracts history). Name/note are never touched.
 *
 * Normal JMW tokens only — NOT the publisher token (a maintenance lever, not an ingest one).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await reprocessRideFromBlob((await params).id);
    switch (result.status) {
      case "ok":
        return ok(result.ride);
      case "not_found":
        return notFound("Ride not found");
      case "blob_missing":
        return errorResponse(409, "conflict", "The raw FIT file is missing from storage; cannot reprocess");
    }
  } catch (e) {
    if (e instanceof FitDecodeError) return errorResponse(409, "conflict", `Stored file no longer decodes: ${e.message}`);
    if (e instanceof z.ZodError) return validationError(e);
    throw e;
  }
}
