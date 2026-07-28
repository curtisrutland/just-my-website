import { errorResponse, notFound } from "@/lib/http/errors";
import { MacroDomainError } from "./repo";

/**
 * Translate a repo `MacroDomainError` into the error envelope (CONVENTIONS §3), or null when the
 * thrown value is something else (which the route should rethrow). One mapping, used by every
 * route whose repo call can hit a batch rule: draw guards on the entry write paths, date/linkage
 * invariants on the batch and entry patch paths.
 */
export function macroDomainErrorResponse(e: unknown): Response | null {
  if (!(e instanceof MacroDomainError)) return null;
  switch (e.code) {
    case "batch_not_found":
      return notFound(e.message);
    // The lifecycle rule: the batch exists but is finished for the entry's date. 409, not 400 —
    // the request is well-formed; it conflicts with the batch's state.
    case "batch_finished":
      return errorResponse(409, "conflict", e.message);
    case "batch_dates_invalid":
    case "food_xor_batch":
      return errorResponse(400, "validation_error", e.message);
  }
}
