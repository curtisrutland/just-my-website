import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { notFound } from "@/lib/http/errors";
import { isValidDate } from "@/lib/http/params";
import { ok } from "@/lib/http/responses";
import { getEntryByDay } from "@/lib/weight/repo";

type Ctx = { params: Promise<{ date: string }> };

/** The weight logged on a day (or 404). Used by the entry form to prefill "today". */
export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { date } = await params;
  if (!isValidDate(date)) return notFound("Weight entry not found");
  const entry = await getEntryByDay(date);
  return entry ? ok(entry) : notFound("Weight entry not found");
}
