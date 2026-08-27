import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireBearer } from "@/lib/auth/tokens";
import { notFound, validationError } from "@/lib/http/errors";
import { isValidDate } from "@/lib/http/params";
import { ok } from "@/lib/http/responses";
import { getRawPayload, toView, upsertDay } from "@/lib/vitals/repo";
import { normalizeGarminDay } from "@/lib/vitals/normalize";

type Ctx = { params: Promise<{ date: string }> };

/**
 * POST — re-derive a day's fact columns from its stored `rawPayload`.
 *
 * The correction lever, mirroring `POST /api/rides/[id]/reprocess`: the archive is the truth and
 * the columns are a projection of it, so fixing a parsing mistake — or surfacing a field we chose
 * not to keep on day one — is a re-parse across stored history, never a re-poll of a rate-limited
 * API and never a hand edit.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) return notFound("No vitals for that day");

  const raw = await getRawPayload(date);
  if (!raw) return notFound("No vitals for that day");

  try {
    const { row } = await upsertDay(normalizeGarminDay(date, raw));
    return ok(toView(row));
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    throw e;
  }
}
