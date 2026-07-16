import type { NextRequest } from "next/server";
import { ok } from "@/lib/http/responses";
import { requirePanelAuth } from "@/lib/panel/auth";
import { normalizeRecipe, validateSendPayload } from "@/lib/panel/normalize";
import { setPanelRecipe } from "@/lib/panel/repo";
import { panelRecipe } from "@/lib/panel/views";

/** GET /api/panel/recipe — the active normalized recipe, or `recipe: null` (a normal 200 state). */
export async function GET(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:read");
  if (!auth.ok) return auth.response;
  return ok(await panelRecipe(), { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/panel/recipe — send-to-panel (panel-contract §6). Sender-anonymous: takes a JSON-LD
 * Recipe (+ `notes`) and a sourceUrl; it does not know or care who sent it. Validates and normalizes
 * ON RECEIVE so a bad payload is caught while the user is still on a device with a keyboard, and the
 * Pi renderer never branches on schema.org raggedness. Uses the contract's own {ok, errors} shape,
 * not the standard error envelope.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePanelAuth(request, "panel:write:recipe");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, errors: ["Request body was not valid JSON."] }, { status: 400 });
  }

  const parsed = validateSendPayload(body);
  if (!parsed.ok) return Response.json({ ok: false, errors: parsed.errors }, { status: 400 });

  const norm = normalizeRecipe(parsed.recipe);
  const setAt = await setPanelRecipe({ raw: parsed.recipe, norm, sourceUrl: parsed.sourceUrl });
  return Response.json({ ok: true, sentAt: setAt.toISOString() });
}
