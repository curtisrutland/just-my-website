import type { NextRequest } from "next/server";
import { ok } from "@/lib/http/responses";
import { requirePanelAuth } from "@/lib/panel/auth";
import { panelRecipe } from "@/lib/panel/views";

/** GET /api/panel/recipe — the active normalized recipe, or `recipe: null` (a normal 200 state). */
export async function GET(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:read");
  if (!auth.ok) return auth.response;
  return ok(await panelRecipe(), { headers: { "Cache-Control": "no-store" } });
}
