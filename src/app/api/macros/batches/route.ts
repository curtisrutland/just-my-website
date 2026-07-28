import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { errorResponse, parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { createBatch, listBatches } from "@/lib/macros/repo";
import { batchCreateSchema } from "@/lib/macros/schema";

const STATUSES = ["active", "finished", "all"] as const;
type Status = (typeof STATUSES)[number];

/**
 * List batches, ACTIVE-FIRST then newest-made (default status=all): `?q=taco+chicken` answers all
 * three lookup cases in one call — a current batch exists (it's item one, status "active"), only
 * old generations exist (everything returned is visibly "finished"), or nothing exists (empty).
 */
export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const params = request.nextUrl.searchParams;
  const q = params.get("q") ?? undefined;
  const status = (params.get("status") ?? "all") as Status;
  if (!STATUSES.includes(status)) {
    return errorResponse(400, "validation_error", "status must be one of active | finished | all", {
      status: ["Invalid value"],
    });
  }
  const { items, count } = await listBatches({ limit, offset, q, status });
  return ok(paginated(items, count, limit, offset));
}

/**
 * Register a batch. Never blocks on an active same-name batch — the response surfaces it under
 * `activeNameMatches` (dedupe-on-write) so the agent can ask "finish the old one?".
 */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, batchCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { batch, activeNameMatches } = await createBatch(parsed.data);
  return created({ ...batch, activeNameMatches }, `/api/macros/batches/${batch.id}`);
}
