import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import { getSession, hardDeleteSession, patchAnnotation, softDeleteSession } from "@/lib/lifting/repo";
import { liftingAnnotationPatchSchema } from "@/lib/lifting/schema";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the full session: exercise → set tree, derived stats, PR flags, and the annotation. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const session = await getSession((await params).id);
  return session ? ok(session) : notFound("Session not found");
}

/**
 * PATCH — the ONLY session write: the annotation (session_notes / quality / interpretation / focus).
 * The facts are read-only (Hevy's). Returns the full session (get-after-write).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, liftingAnnotationPatchSchema);
  if (!parsed.ok) return parsed.response;
  const session = await patchAnnotation((await params).id, parsed.data);
  return session ? ok(session) : notFound("Session not found");
}

/**
 * DELETE — soft by default (the kernel default; agent token allowed). `?hard=true` requires the
 * primary key (`JMW_API_KEY`); the agent token is structurally barred from hard delete. A hard
 * delete cascades to the session's exercises, sets, and annotation note.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const id = (await params).id;
  const done = hard ? await hardDeleteSession(id) : await softDeleteSession(id);
  return done ? noContent() : notFound("Session not found");
}
