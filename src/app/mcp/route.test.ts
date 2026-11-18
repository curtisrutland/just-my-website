import { describe, expect, it } from "vitest";
import { describeEvent } from "@/lib/mcp/server";
import { DELETE, GET, POST } from "./route";

/**
 * `/mcp` without a credential (`docs/mcp.md` §1): refused before the MCP layer runs, with the
 * challenge a client needs to find the sign-in. What a valid grant can do is in `flow.test.ts`.
 */
const URL_ = "https://example.test/mcp";
const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    })
  );

describe("/mcp without a token", () => {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "0" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "weight_rollup", arguments: {} } },
  ];

  for (const message of messages) {
    it(`${message.method} is 401 and points at the protected resource metadata`, async () => {
      const response = await rpc(message);
      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain('resource_metadata="https://example.test/.well-known/oauth-protected-resource/mcp"');
      expect(await response.text()).not.toContain("weight_rollup");
    });
  }

  it("GET and DELETE are refused too", async () => {
    expect((await GET(new Request(URL_, { headers: { accept: "text/event-stream" } }))).status).toBe(401);
    expect((await DELETE(new Request(URL_, { method: "DELETE" }))).status).toBe(401);
  });

  it("a header that isn't a bearer token is no token", async () => {
    expect((await rpc(messages[1], { authorization: "Basic dXNlcjpwYXNz" })).status).toBe(401);
  });
});

describe("the log", () => {
  it("names the client and the tool, never the arguments", () => {
    const arrived = (message: { method: string }) =>
      describeEvent({ type: "REQUEST_RECEIVED", method: message.method, parameters: message, status: "success", timestamp: 0 });
    const init = { method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "vitest", version: "0" } } };
    expect(arrived(init)).toBe("[mcp] <- initialize client=vitest/0 asked=2025-06-18");
    const call = { method: "tools/call", params: { name: "macros_day", arguments: { date: "2026-11-18" } } };
    expect(arrived(call)).toBe("[mcp] <- tools/call tool=macros_day");
    expect(describeEvent({ type: "REQUEST_COMPLETED", method: "tools/list", duration: 1.4, status: "success", timestamp: 0 })).toBe(
      "[mcp] -> tools/list success 1ms"
    );
  });
});
