import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { createEntry, listEntries } from "@/lib/macros/repo";
import { entryCreateSchema } from "@/lib/macros/schema";

export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const on = request.nextUrl.searchParams.get("on") ?? undefined;
  const { items, count } = await listEntries({ limit, offset, on });
  return ok(paginated(items, count, limit, offset));
}

export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, entryCreateSchema);
  if (!parsed.ok) return parsed.response;
  const entry = await createEntry(parsed.data);
  return created(entry, `/api/macros/entries/${entry.id}`);
}
