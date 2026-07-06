import type { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth/tokens";
import { parseJson } from "@/lib/http/errors";
import { paginated, parsePagination } from "@/lib/http/pagination";
import { created, ok } from "@/lib/http/responses";
import { addItem, listItems } from "@/lib/shopping/repo";
import { shoppingCreateSchema } from "@/lib/shopping/schema";

export async function GET(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parsePagination(request.nextUrl.searchParams);
  const { items, count } = await listItems({ limit, offset });
  return ok(paginated(items, count, limit, offset));
}

export async function POST(request: NextRequest) {
  const auth = requireBearer(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJson(request, shoppingCreateSchema);
  if (!parsed.ok) return parsed.response;
  const item = await addItem(parsed.data);
  return created(item, `/api/shopping/items/${item.id}`);
}
