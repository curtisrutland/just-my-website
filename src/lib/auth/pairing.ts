import * as z from "zod";

/**
 * The pairing payload a phone scans (`docs/ios-app.md` §4.1). JSON, not a URL, so the system Camera
 * can't hand the token to Safari — only the app's own scanner reads it. `base` lets a dev build pair
 * against `http://<mac>.local:3000` through the same flow; `name` is the token's name on the devices
 * page, so the phone's Settings can say which pairing it is (handoff §8).
 */
export type PairingPayload = { v: 1; base: string; token: string; name?: string };

export function pairingPayload(opts: { base: string; token: string; name?: string }): string {
  const payload: PairingPayload = { v: 1, base: opts.base.replace(/\/+$/, ""), token: opts.token };
  const name = opts.name?.trim();
  if (name) payload.name = name;
  return JSON.stringify(payload);
}

/**
 * The origin the phone should talk to, from the request that minted the token: the production host in
 * prod, `http://localhost:3000` (simulator) or `http://<mac>.local:3000` (a phone on the LAN) in dev.
 */
export function originFrom(headers: Headers): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "justmy.website";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || /\.local(:\d+)?$/.test(host);
  const proto = headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * What a route that mints a token answers with (`POST /api/weight/weigh-in-token`): the raw token,
 * returned this once and never retrievable again, plus the name and scopes it was stored with.
 */
export const mintedTokenSchema = z.object({
  token: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
});

export type MintedToken = z.infer<typeof mintedTokenSchema>;
