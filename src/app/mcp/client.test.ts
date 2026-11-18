import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./route";

/**
 * The MCP spike (#133) driven by the official MCP client rather than by hand-written JSON-RPC: it
 * negotiates whichever protocol generation it prefers, lists the tools and calls one. Its `fetch`
 * is pointed straight at the route handlers, so no server has to be running.
 */
const handlers: Record<string, (request: Request) => Promise<Response>> = { GET, POST, DELETE };
const seen: string[] = [];

const viaRoute: typeof fetch = async (input, init) => {
  const request = new Request(input as RequestInfo, init);
  seen.push(request.method);
  return handlers[request.method](request);
};

describe("/mcp (spike), official client", () => {
  it("connects, lists the tool and calls it", async () => {
    const client = new Client({ name: "vitest-client", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), { fetch: viaRoute }));

    expect(client.getServerVersion()).toMatchObject({ name: "justmy-website" });
    expect(client.getServerCapabilities()).toHaveProperty("tools");
    expect(client.getNegotiatedProtocolVersion()).toMatch(/^20\d\d-\d\d-\d\d$/);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["ping"]);

    const result = await client.callTool({ name: "ping", arguments: { note: "from the client" } });
    expect(result.isError).toBeFalsy();
    expect((result.content as { type: string; text: string }[])[0].text).toMatch(/^pong · .+Z · from the client$/);

    await client.close();
    expect(seen).toContain("POST");
  });
});
