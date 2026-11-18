import { redeemCode, refreshGrant, type TokenSet } from "@/lib/mcp/grants";
import { oauthError, oauthJson } from "@/lib/mcp/responses";

/**
 * The token endpoint (RFC 6749 §3.2; `docs/mcp.md` §2). No bearer token and no session: the
 * credential is the code plus its PKCE verifier, or the refresh token. Public clients only, so
 * there is no client secret to check. Every refusal of a credential is the same `invalid_grant`.
 */
const tokenResponse = (tokens: TokenSet): Response =>
  oauthJson({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(" "),
  });

export async function POST(request: Request): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "The body must be application/x-www-form-urlencoded.");
  }
  const form = new URLSearchParams(await request.text());
  const field = (name: string) => form.get(name) || undefined;

  switch (field("grant_type")) {
    case "authorization_code": {
      const code = field("code");
      const codeVerifier = field("code_verifier");
      const clientId = field("client_id");
      if (!code || !codeVerifier || !clientId) {
        return oauthError(400, "invalid_request", "code, code_verifier and client_id are required.");
      }
      const tokens = await redeemCode({ code, codeVerifier, clientId, redirectUri: field("redirect_uri"), resource: field("resource") });
      return tokens ? tokenResponse(tokens) : oauthError(400, "invalid_grant", "The authorization code is not valid.");
    }
    case "refresh_token": {
      const refreshToken = field("refresh_token");
      if (!refreshToken) return oauthError(400, "invalid_request", "refresh_token is required.");
      const tokens = await refreshGrant({ refreshToken, clientId: field("client_id") });
      return tokens ? tokenResponse(tokens) : oauthError(400, "invalid_grant", "The refresh token is not valid.");
    }
    default:
      return oauthError(400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  }
}
