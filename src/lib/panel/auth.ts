import { auth as clerkAuth } from "@clerk/nextjs/server";
import { unauthorized } from "@/lib/http/errors";
import type { PanelScope } from "./scopes";
import { type DeviceTokenIdentity, findLiveTokenByRaw, findLiveTokenByRawCached } from "./tokens";

/**
 * Panel auth (panel-contract §3). Every `/api/panel/**` route calls this. Two credential paths,
 * Bearer first:
 *
 *  1. Device token PRESENT → must resolve to a live device token that holds `scope`, else 401. A
 *     present-but-bad token is a hard 401 — we do NOT silently fall back to a session. The token
 *     arrives as `Authorization: Bearer` (skill/service callers, the recipes sender) OR the
 *     `panel_token` cookie (the Pi kiosk — set once via `GET /api/panel/session`; the browser sends
 *     it automatically on the panel's client fetches).
 *  2. No token → accept a Clerk session (the owner, in a browser — dev/debug). A session grants
 *     EVERY scope. Requires clerkMiddleware to run on `/api/panel/**` (see `src/proxy.ts`).
 *  3. Neither → 401.
 *
 * This is the one sanctioned exception to "API is token-only, always" (AGENTS.md), scoped to the
 * panel subtree and justified by the no-hardware dev path + the kiosk cookie.
 */

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const m = header && /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m) return m[1].trim();
  // The Pi kiosk: the device token in an httpOnly cookie (sent automatically on same-origin fetches).
  const cookie = request.headers.get("cookie");
  if (cookie) {
    const cm = cookie.match(/(?:^|;\s*)panel_token=([^;]+)/);
    if (cm) return decodeURIComponent(cm[1]);
  }
  return null;
}

export type PanelAuthOk =
  | { ok: true; via: "token"; tokenId: string; name: string; scopes: PanelScope[] }
  | { ok: true; via: "clerk"; userId: string };

export type PanelAuthResult = PanelAuthOk | { ok: false; response: Response };

type TokenLookup = (raw: string) => Promise<DeviceTokenIdentity | null>;

async function panelAuthWith(
  request: Request,
  scope: PanelScope,
  lookup: TokenLookup
): Promise<PanelAuthResult> {
  const token = extractToken(request);

  if (token) {
    const identity = await lookup(token);
    if (!identity) {
      return { ok: false, response: unauthorized("Invalid or revoked device token") };
    }
    if (!identity.scopes.includes(scope)) {
      return { ok: false, response: unauthorized(`Device token lacks required scope: ${scope}`) };
    }
    return { ok: true, via: "token", tokenId: identity.id, name: identity.name, scopes: identity.scopes };
  }

  // No bearer → the owner's Clerk session (browser dev/debug). Grants all scopes.
  const { userId } = await clerkAuth();
  if (userId) return { ok: true, via: "clerk", userId };

  return {
    ok: false,
    response: unauthorized("Panel routes require a device token or an authenticated session"),
  };
}

/** Standard panel auth: DIRECT Neon token lookup → immediate revocation. Use everywhere EXCEPT the version poll. */
export function requirePanelAuth(request: Request, scope: PanelScope): Promise<PanelAuthResult> {
  return panelAuthWith(request, scope, findLiveTokenByRaw);
}

/**
 * Version-poll auth: KV-CACHED token lookup so the hot path stays off Neon (contract §4.1). Use ONLY
 * for `GET /api/panel/version`. Revocation lags by the cache TTL here (see `findLiveTokenByRawCached`).
 */
export function requirePanelAuthCached(request: Request, scope: PanelScope): Promise<PanelAuthResult> {
  return panelAuthWith(request, scope, findLiveTokenByRawCached);
}
