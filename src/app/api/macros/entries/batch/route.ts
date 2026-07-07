import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { createEntries } from "@/lib/macros/repo";
import { entryCreateBatchSchema } from "@/lib/macros/schema";

/**
 * Atomic batch log. The whole array is validated first (a bad element → 400 naming its index, zero
 * rows written), then the lot is inserted in one statement. Returns 201 + the created entries in
 * the unified read shape (`EntryView`), in input order, so a composite meal logs and reads in one call.
 */
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, entryCreateBatchSchema);
  if (!parsed.ok) return parsed.response;
  const entries = await createEntries(parsed.data);
  return ok(entries, { status: 201 });
}
