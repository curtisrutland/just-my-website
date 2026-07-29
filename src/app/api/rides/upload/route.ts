import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireUploadToken } from "@/lib/auth/tokens";
import { errorResponse, validationError } from "@/lib/http/errors";
import { created, ok } from "@/lib/http/responses";
import { FitDecodeError } from "@/lib/rides/fit";
import { ingestFitFile } from "@/lib/rides/ingest";

/**
 * POST /api/rides/upload — the FIT ingest route. Body is the RAW FIT binary
 * (`application/octet-stream`), not JSON and not multipart — simplest possible contract for
 * the v2 daemon (`curl --data-binary @ride.fit`).
 *
 * AUTH: the one route that accepts `JMW_PUBLISHER_TOKEN` (via `requireUploadToken`), alongside
 * the normal JMW tokens. The publisher token works nowhere else.
 *
 * Idempotent by design: re-uploading known bytes (or the same activity re-exported) returns
 * `200` + the existing ride with `deduped: true` — the daemon re-sends files forever and that
 * is normal, not an error. A new ride returns `201` + Location (get-after-create).
 */

/** FIT files run ~0.1–1 MB; 15 MB is a generous ceiling, not a target. */
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = requireUploadToken(request);
  if (!auth.ok) return auth.response;

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0) {
    return errorResponse(400, "validation_error", "Empty body — send the raw FIT bytes");
  }
  if (bytes.length > MAX_BYTES) {
    return errorResponse(400, "validation_error", `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`);
  }

  try {
    const { ride, deduped } = await ingestFitFile(bytes);
    return deduped
      ? ok({ ...ride, deduped: true })
      : created({ ...ride, deduped: false }, `/api/rides/${ride.id}`);
  } catch (e) {
    if (e instanceof FitDecodeError) return errorResponse(400, "validation_error", e.message);
    if (e instanceof z.ZodError) return validationError(e);
    throw e;
  }
}
