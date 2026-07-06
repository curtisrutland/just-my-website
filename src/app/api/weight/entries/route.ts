import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { ok } from "@/lib/http/responses";
import { listEntries, setWeight } from "@/lib/weight/repo";
import { weightCreateSchema } from "@/lib/weight/schema";

export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const { items, count } = await listEntries({ limit, offset });
  return ok(paginated(items, count, limit, offset));
}

// Upsert the weight for a day (one per day; re-logging replaces it).
export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, weightCreateSchema);
  if (!parsed.ok) return parsed.response;
  const entry = await setWeight(parsed.data);
  return ok(entry, { headers: { Location: `/api/weight/days/${entry.measuredOn}` } });
}
