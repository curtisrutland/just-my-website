import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { hardDeleteGoal, patchGoal, softDeleteGoal } from "@/lib/lifting/repo";
import { liftingGoalPatchSchema } from "@/lib/lifting/schema";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — edit one dated goal in place: reword it, or correct when it started. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, liftingGoalPatchSchema);
  if (!parsed.ok) return parsed.response;
  const goal = await patchGoal((await params).id, parsed.data);
  return goal ? ok(goal) : notFound("Goal not found");
}

/**
 * DELETE — soft by default (the kernel default; agent token allowed). `?hard=true` requires the
 * primary key. Retiring a goal is normally a matter of setting a NEW one, not deleting the old —
 * delete is for a goal written by mistake.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteGoal(id) : await softDeleteGoal(id);
  return done ? noContent() : notFound("Goal not found");
}
