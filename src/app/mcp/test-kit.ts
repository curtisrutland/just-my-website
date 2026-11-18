import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { POST as tokenEndpoint } from "@/app/oauth/token/route";
import { db } from "@/lib/db";
import { oauthGrant } from "@/lib/db/schema";
import { createAuthorization } from "@/lib/mcp/grants";
import { MCP_SCOPES, s256, type McpScope } from "@/lib/mcp/oauth";
import { POST as mcp } from "./route";

/**
 * Shared by the MCP integration tests (`flow.test.ts`, `tools.test.ts`): stand in for a connected
 * client against the real database. Each test file gets its own client id, so the files can run at
 * the same time and each cleans up only its own grants.
 *
 * The consent page itself (Clerk) is not exercised; `createAuthorization` is what its action calls
 * after the session check.
 */
export const REDIRECT = "http://localhost:1/callback";
export const RESOURCE = "https://example.test/mcp";
export const VERIFIER = "v".repeat(64);

export type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };
export type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: string } };

export function mcpTestKit(client: string) {
  const approve = (scopes: McpScope[] = [...MCP_SCOPES], now?: Date) =>
    createAuthorization({ clientId: client, redirectUri: REDIRECT, state: "s", codeChallenge: s256(VERIFIER), scopes, resource: RESOURCE }, now);

  const token = (fields: Record<string, string>) =>
    tokenEndpoint(
      new Request("https://example.test/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      })
    );

  const redeem = (code: string, over: Record<string, string> = {}) =>
    token({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: client, redirect_uri: REDIRECT, resource: RESOURCE, ...over });

  /** An approved, redeemed grant: the state a connected client is in. */
  async function connect(scopes?: McpScope[]): Promise<Tokens & { id: string }> {
    const { id, code } = await approve(scopes);
    const response = await redeem(code);
    expect(response.status).toBe(200);
    return { id, ...((await response.json()) as Tokens) };
  }

  /** One JSON-RPC request to `/mcp`, as a 2025-era client sends it. */
  async function call(bearer: string | undefined, method: string, params?: unknown): Promise<{ status: number; body: Rpc | null }> {
    const response = await mcp(
      new Request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
      })
    );
    if (response.status !== 200) return { status: response.status, body: null };
    const text = await response.text();
    const data = text.split("\n").filter((line) => line.startsWith("data:"));
    return { status: 200, body: JSON.parse(data.length ? data[data.length - 1].slice(5) : text) };
  }

  /** Call a tool; returns whether it refused and the text it sent back. */
  async function tool(bearer: string, name: string, args: Record<string, unknown> = {}) {
    const { status, body } = await call(bearer, "tools/call", { name, arguments: args });
    expect(status).toBe(200);
    const result = body?.result as { isError?: boolean; content: { type: string; text: string }[] } | undefined;
    if (!result) throw new Error(`${name}: ${JSON.stringify(body?.error)}`);
    return { isError: Boolean(result.isError), text: result.content[0].text };
  }

  const cleanup = () => db.delete(oauthGrant).where(eq(oauthGrant.clientId, client));

  return { client, approve, token, redeem, connect, call, tool, cleanup, mcp };
}
