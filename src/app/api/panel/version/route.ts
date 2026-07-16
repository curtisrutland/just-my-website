import type { NextRequest } from "next/server";
import { ok } from "@/lib/http/responses";
import { requirePanelAuthCached } from "@/lib/panel/auth";
import { readVersions } from "@/lib/panel/version";

/**
 * GET /api/panel/version — the cheapest, most frequent request in the system (panel-contract §4).
 * Returns `{ health, shopping, recipe }` (opaque monotonic ints). KV-ONLY on the steady-state path:
 * cached auth (§4.1) + a single KV read, never Neon, so the Neon compute can autosuspend.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePanelAuthCached(request, "panel:read");
  if (!auth.ok) return auth.response;
  return ok(await readVersions(), { headers: { "Cache-Control": "no-store" } });
}
