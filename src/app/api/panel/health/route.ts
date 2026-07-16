import type { NextRequest } from "next/server";
import { ok } from "@/lib/http/responses";
import { requirePanelAuth } from "@/lib/panel/auth";
import { panelHealth } from "@/lib/panel/views";

/** GET /api/panel/health — macros (consumed/target/remaining) + weight trend (panel-contract §5.1). */
export async function GET(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:read");
  if (!auth.ok) return auth.response;
  return ok(await panelHealth(), { headers: { "Cache-Control": "no-store" } });
}
