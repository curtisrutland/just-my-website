import type { NextRequest } from "next/server";
import { requireBearer, requirePrimary } from "@/lib/auth/tokens";
import { notFound, parseJson } from "@/lib/http/errors";
import { noContent, ok } from "@/lib/http/responses";
import {
  getLiveDayTag,
  hardDeleteDayTag,
  patchDayTag,
  softDeleteDayTag,
} from "@/lib/macros/repo";
import { dayTagPatchSchema } from "@/lib/macros/schema";
import { isValidDate } from "@/lib/http/params";

type Ctx = { params: Promise<{ day: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { day } = await params;
  if (!isValidDate(day)) return notFound("Day tag not found");
  const tag = await getLiveDayTag(day);
  return tag ? ok(tag) : notFound("Day tag not found");
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, dayTagPatchSchema);
  if (!parsed.ok) return parsed.response;
  const { day } = await params;
  if (!isValidDate(day)) return notFound("Day tag not found");
  const tag = await patchDayTag(day, parsed.data);
  return tag ? ok(tag) : notFound("Day tag not found");
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const auth = hard ? requirePrimary(request) : requireBearer(request);
  if (!auth.ok) return auth.response;
  const { day } = await params;
  if (!isValidDate(day)) return notFound("Day tag not found");
  if (hard) {
    const tag = await getLiveDayTag(day);
    const done = tag ? await hardDeleteDayTag(tag.id) : false;
    return done ? noContent() : notFound("Day tag not found");
  }
  const done = await softDeleteDayTag(day);
  return done ? noContent() : notFound("Day tag not found");
}
