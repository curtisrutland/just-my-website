import type { NextRequest } from "next/server";
import { requirePanelAuth } from "@/lib/panel/auth";
import { patchItem } from "@/lib/shopping/repo";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/panel/shopping/:id/check — check/uncheck a shopping item from the panel (contract §7.1).
 * Idempotent; maps `checked` → status (bought/needed). patchItem bumps the shopping version.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requirePanelAuth(request, "panel:write:shopping");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Request body was not valid JSON." }, { status: 400 });
  }
  const checked = (body as { checked?: unknown } | null)?.checked;
  if (typeof checked !== "boolean") {
    return Response.json({ ok: false, error: "`checked` must be a boolean." }, { status: 400 });
  }

  const row = await patchItem((await params).id, { status: checked ? "bought" : "needed" });
  if (!row) return Response.json({ ok: false, error: "Item not found." }, { status: 404 });
  return Response.json({ ok: true });
}
