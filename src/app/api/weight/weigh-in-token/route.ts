import type { NextRequest } from "next/server";
import { mintWeighInToken } from "@/lib/auth/device-tokens";
import type { MintedToken } from "@/lib/auth/pairing";
import { requireDevice } from "@/lib/auth/tokens";
import { unauthorized } from "@/lib/http/errors";

/**
 * Mint this device's weigh-in token (`docs/ios-app.md` §3.3.7): a child credential that can log and
 * read weigh-ins and nothing else, for Siri, which can't raise Face ID to reach the phone's full
 * token. Device tokens only — the env tokens are rejected. Calling it again replaces the previous
 * weigh-in token. The raw token is in this response and nowhere else.
 */
export async function POST(request: NextRequest) {
  const auth = await requireDevice(request);
  if (!auth.ok) return auth.response;
  const minted = await mintWeighInToken(auth.device);
  if (!minted) return unauthorized("This token can't mint a weigh-in token");
  const body: MintedToken = { token: minted.raw, name: minted.name, scopes: minted.scopes };
  return Response.json(body, { status: 201, headers: { "Cache-Control": "no-store" } });
}
