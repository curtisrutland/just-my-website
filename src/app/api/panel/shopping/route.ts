import type { NextRequest } from "next/server";
import { ok } from "@/lib/http/responses";
import { requirePanelAuth } from "@/lib/panel/auth";
import { panelShopping } from "@/lib/panel/views";

/** GET /api/panel/shopping — the full list (needed + recently-bought), each with a checked flag. */
export async function GET(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:read");
  if (!auth.ok) return auth.response;
  return ok(await panelShopping(), { headers: { "Cache-Control": "no-store" } });
}
