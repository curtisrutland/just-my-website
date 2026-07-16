import type { NextRequest } from "next/server";
import { todayISO } from "@/lib/date";
import { setDayTag } from "@/lib/macros/repo";
import { dayTagCreateSchema } from "@/lib/macros/schema";
import { requirePanelAuth } from "@/lib/panel/auth";

/**
 * POST /api/panel/day-type — set today's day-type from the panel (contract §7.2). Applies to today
 * in Curtis's timezone. Validated through the SAME schema as every other day-tag write, then the same
 * repo (setDayTag), which bumps the health version. Idempotent.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:write:daytype");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Request body was not valid JSON." }, { status: 400 });
  }

  const parsed = dayTagCreateSchema.safeParse({ day: todayISO(), kind: (body as { type?: unknown } | null)?.type });
  if (!parsed.success) {
    return Response.json({ ok: false, error: '`type` must be "training" or "rest".' }, { status: 400 });
  }

  await setDayTag(parsed.data);
  return Response.json({ ok: true });
}
