import { NextResponse } from "next/server";
import { findLiveTokenByRaw } from "@/lib/panel/tokens";

/**
 * GET /api/panel/session?token=<device token> — one-time kiosk setup (impl §7). Validates the token
 * (must hold `panel:read`) and drops it into an httpOnly `panel_token` cookie, then redirects to the
 * panel. The Pi's kiosk URL points here once; thereafter the cookie carries every request (page load
 * + client poll + writes), no Clerk login on the wall.
 *
 * The token rides in the URL, which is fine for a one-time private setup — it IS the credential, and
 * it lands in an httpOnly cookie (never in client JS). Treat the setup URL as a secret.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing ?token" }, { status: 400 });
  }

  const identity = await findLiveTokenByRaw(token);
  if (!identity || !identity.scopes.includes("panel:read")) {
    return NextResponse.json({ ok: false, error: "Invalid token, or it lacks the panel:read scope." }, { status: 401 });
  }

  const res = NextResponse.redirect(new URL("/panel/health", request.url));
  res.cookies.set("panel_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // ~1 year; re-visit this URL to refresh the cookie
  });
  return res;
}
