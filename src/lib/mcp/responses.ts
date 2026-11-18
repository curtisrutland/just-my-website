/**
 * Responses for the OAuth endpoints (`docs/mcp.md` §2). They are not part of the token API, so they
 * use OAuth's own error shape (RFC 6749 §5.2: `{ error, error_description }`), not the platform's
 * error envelope. Nothing here may be cached: every body is either a credential or a refusal.
 */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const oauthJson = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });

export const oauthError = (status: number, error: string, description: string): Response =>
  oauthJson({ error, error_description: description }, status);

/** Discovery documents are public and read cross-origin by browser-based clients. */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

export const metadataJson = (body: unknown): Response =>
  Response.json(body, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });

export const metadataPreflight = (): Response => new Response(null, { status: 204, headers: CORS });
