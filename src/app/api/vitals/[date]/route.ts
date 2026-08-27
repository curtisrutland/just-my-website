import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound } from "@/lib/http/errors";
import { isValidDate } from "@/lib/http/params";
import { noContent, ok } from "@/lib/http/responses";
import { getDay, hardDeleteDay, softDeleteDay, toView } from "@/lib/vitals/repo";

type Ctx = { params: Promise<{ date: string }> };

/**
 * GET — one day. Returns the same view shape as the list (#40); `rawPayload` is excluded from
 * both, because it is the archive rather than the contract.
 *
 * There is deliberately NO PATCH: these numbers come off a wrist and a hand-typed HRV would be a
 * fiction. A wrong value is corrected by REPROCESSING the stored payload.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) return notFound("No vitals for that day");
  const row = await getDay(date);
  return row ? ok(toView(row)) : notFound("No vitals for that day");
}

/**
 * DELETE — soft by default (the day stops being read; the daemon's next poll can re-create it,
 * since the unique index is scoped to live rows). `?hard=true` requires the primary key: the agent
 * token is structurally barred from destroying the archive.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) return notFound("No vitals for that day");
  const done = hard ? await hardDeleteDay(date) : await softDeleteDay(date);
  return done ? noContent() : notFound("No vitals for that day");
}
