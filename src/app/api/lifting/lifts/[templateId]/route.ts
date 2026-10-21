import type { NextRequest } from "next/server";
import { requireScope } from "@/lib/auth/tokens";
import { ok } from "@/lib/http/responses";
import { getLiftProgression } from "@/lib/lifting/repo";

type Ctx = { params: Promise<{ templateId: string }> };

/**
 * GET /api/lifting/lifts/[templateId] — the progression series (best e1RM + top-set weight per
 * session, oldest → newest) for one lift identity. A lift with no history returns an empty series
 * (`points: []`) as a normal 200, not a 404 — the identity space is Hevy's, not ours to 404 on.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await requireScope(request, "lifting:read");
  if (!auth.ok) return auth.response;
  return ok(await getLiftProgression((await params).templateId));
}
