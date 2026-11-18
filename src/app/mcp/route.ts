import { createMcpHandler } from "mcp-handler";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, describeEvent, describeHttp, registerTools } from "@/lib/mcp/server";

/**
 * `/mcp` — SPIKE (#133, `docs/mcp-spike.md`). A stateless Streamable HTTP MCP endpoint with one
 * tool that reads no data. It sits outside `/api` on purpose: the token API is token-only
 * (CONVENTIONS §2) and this endpoint has no auth yet, so it must not expose anything. The proxy
 * skips it the way it skips `/api`, so Clerk never bounces a machine client to the sign-in page.
 *
 * Stateless matters: every request is answered on its own, so it doesn't matter which function
 * instance it lands on. GET and DELETE (the session operations of the 2025-era transport) are
 * exported so the handler answers them with its own 405 instead of Next's.
 */
const mcp = createMcpHandler(registerTools, {
  serverInfo: MCP_SERVER_INFO,
  instructions: MCP_INSTRUCTIONS,
  onEvent: (event) => console.log(describeEvent(event)),
});

async function handler(request: Request): Promise<Response> {
  const response = await mcp(request);
  console.log(describeHttp(request, response));
  return response;
}

export { handler as GET, handler as POST, handler as DELETE };
