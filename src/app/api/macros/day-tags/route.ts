import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { ok } from "@/lib/http/responses";
import { setDayTag } from "@/lib/macros/repo";
import { dayTagCreateSchema } from "@/lib/macros/schema";

// Upsert a day's kind. One live tag per day, so this is idempotent (POST doubles as set).
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, dayTagCreateSchema);
  if (!parsed.ok) return parsed.response;
  const tag = await setDayTag(parsed.data);
  return ok(tag, { headers: { Location: `/api/macros/day-tags/${tag.day}` } });
}
