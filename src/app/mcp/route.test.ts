import { describe, expect, it } from "vitest";
import { describeEvent, pong } from "@/lib/mcp/server";
import { DELETE, GET, POST } from "./route";

/**
 * The MCP spike (#133), exercised the way a 2025-era Streamable HTTP client does it: plain JSON-RPC
 * POSTs. The point being proven is statelessness — every request below is answered on its own, with
 * no session id and no `initialize` before it, which is what makes the endpoint safe on serverless
 * (the suspected cause of "connected, but no tools" last time).
 */
const URL_ = "https://example.test/mcp";

type Rpc = { jsonrpc: "2.0"; id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

/** A Streamable HTTP answer is either one JSON body or an SSE stream carrying it. */
async function rpcBody(response: Response): Promise<Rpc> {
  const text = await response.text();
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(text);
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return JSON.parse(data[data.length - 1]);
}

function post(body: unknown, protocol?: string): Promise<Response> {
  return POST(
    new Request(URL_, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(protocol ? { "mcp-protocol-version": protocol } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

const initialize = (protocolVersion: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion, capabilities: {}, clientInfo: { name: "vitest", version: "0" } },
});

describe("/mcp (spike)", () => {
  // The protocol versions claude.ai's client is documented to follow.
  for (const version of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
    it(`initialize (${version}) declares the tools capability and opens no session`, async () => {
      const response = await post(initialize(version));
      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      const { result } = await rpcBody(response);
      expect(result?.protocolVersion).toBe(version);
      expect(result?.capabilities).toHaveProperty("tools");
      expect(result?.serverInfo).toMatchObject({ name: "justmy-website" });
    });
  }

  it("tools/list answers on its own — no session, no initialize first", async () => {
    const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "2025-06-18");
    expect(response.status).toBe(200);
    const { result } = await rpcBody(response);
    const tools = result?.tools as { name: string; description: string; inputSchema: { type: string } }[];
    expect(tools.map((tool) => tool.name)).toEqual(["ping"]);
    expect(tools[0].description).toContain("Reads no data");
    expect(tools[0].inputSchema.type).toBe("object");
  });

  it("tools/call answers on its own and returns the note it was sent", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: { note: "hello" } } },
      "2025-06-18"
    );
    expect(response.status).toBe(200);
    const { result } = await rpcBody(response);
    expect(result?.isError).toBeFalsy();
    const content = result?.content as { type: string; text: string }[];
    expect(content[0].text).toMatch(/^pong · \d{4}-\d\d-\d\dT[\d:.]+Z · hello$/);
  });

  it("a note that breaks the schema is an error result, not a crash", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ping", arguments: { note: 5 } } },
      "2025-06-18"
    );
    const body = await rpcBody(response);
    expect(body.error ?? (body.result?.isError ? body.result : undefined)).toBeTruthy();
  });

  it("the client's 'initialized' notification is accepted", async () => {
    const response = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, "2025-06-18");
    expect(response.status).toBe(202);
  });

  it("GET and DELETE (session operations) are refused with 405, not a hang", async () => {
    const get = await GET(new Request(URL_, { method: "GET", headers: { accept: "text/event-stream" } }));
    expect(get.status).toBe(405);
    const del = await DELETE(new Request(URL_, { method: "DELETE" }));
    expect(del.status).toBe(405);
  });

  it("the log names the client and the tool, never the arguments", () => {
    const arrived = (message: unknown) =>
      describeEvent({ type: "REQUEST_RECEIVED", method: (message as { method: string }).method, parameters: message, status: "success", timestamp: 0 });
    expect(arrived(initialize("2025-06-18"))).toBe("[mcp] <- initialize client=vitest/0 asked=2025-06-18");
    const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: { note: "secret" } } };
    expect(arrived(call)).toBe("[mcp] <- tools/call tool=ping");
    expect(describeEvent({ type: "REQUEST_COMPLETED", method: "tools/list", duration: 1.4, status: "success", timestamp: 0 })).toBe(
      "[mcp] -> tools/list success 1ms"
    );
  });

  it("pong", () => {
    const at = new Date("2026-11-18T12:00:00.000Z");
    expect(pong(undefined, at)).toBe("pong · 2026-11-18T12:00:00.000Z");
    expect(pong("  ", at)).toBe("pong · 2026-11-18T12:00:00.000Z");
    expect(pong(" hi ", at)).toBe("pong · 2026-11-18T12:00:00.000Z · hi");
  });
});
