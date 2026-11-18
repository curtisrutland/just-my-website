import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { findGrantByAccessToken, touchGrantSeen } from "@/lib/mcp/grants";
import { OAUTH_PATHS } from "@/lib/mcp/oauth";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, describeEvent, describeHttp, registerTools } from "@/lib/mcp/server";

/**
 * `/mcp` — the MCP endpoint (`docs/mcp.md`): stateless Streamable HTTP, bearer-only. It sits outside
 * `/api` because its credential is not one of the API's: the ONLY thing accepted here is the access
 * token of a live OAuth grant (`oauth_grants`). The env tokens and the device tokens are refused,
 * and a grant's token is refused everywhere else. No token, a bad one, an expired one or a revoked
 * one all get the same 401, whose `WWW-Authenticate` header points at the protected resource
 * metadata so a client can find where to sign in.
 *
 * Stateless matters: every request is answered on its own, so it doesn't matter which function
 * instance it lands on. GET and DELETE (the session operations of the 2025-era transport) are
 * exported so the handler answers them with its own 405 instead of Next's.
 *
 * `maxSubscriptions: 0`: a client may ask to be told when the tool list changes, by holding a
 * server-sent-events stream open. The tools never change at runtime, and on Vercel each such stream
 * pinned a function for its full 300 seconds (measured on the spike), so they are refused.
 */
const mcp = createMcpHandler(registerTools, {
  serverInfo: MCP_SERVER_INFO,
  instructions: MCP_INSTRUCTIONS,
  maxSubscriptions: 0,
  onEvent: (event) => console.log(describeEvent(event)),
});

const authed = withMcpAuth(
  mcp,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const grant = await findGrantByAccessToken(bearer);
    if (!grant) return undefined;
    touchGrantSeen(grant.id);
    return {
      token: bearer,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.expiresAt.getTime() / 1000),
      extra: { grantId: grant.id },
    };
  },
  { required: true, resourceMetadataPath: OAUTH_PATHS.protectedResourceMetadata }
);

async function handler(request: Request): Promise<Response> {
  const response = await authed(request);
  console.log(describeHttp(request, response));
  return response;
}

export { handler as GET, handler as POST, handler as DELETE };
