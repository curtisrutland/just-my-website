import { registerClient } from "@/lib/mcp/oauth";
import { oauthError, oauthJson } from "@/lib/mcp/responses";

/**
 * Dynamic client registration (RFC 7591), stateless (`docs/mcp.md` §2). Unauthenticated by design,
 * and safe because it stores nothing and grants nothing: it only checks that the client's redirect
 * URIs are ones this server would send a code to, and hands back the shared public client id.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "The body must be JSON.");
  }
  const result = registerClient(body);
  if (!result.ok) return oauthError(400, result.error, result.description);
  return oauthJson(result.client, 201);
}
