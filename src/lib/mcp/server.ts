import type { McpServer } from "@modelcontextprotocol/server";
import type { McpHandlerOptions } from "mcp-handler";
import { z } from "zod";

/**
 * The MCP surface — SPIKE (#133). One tool that touches no data, to answer a single question:
 * can claude.ai list and call a tool served from this app on Vercel? The attempt in mid-2026
 * connected and then showed no tools. Nothing here reads a module; auth and real tools come only
 * after this is seen working (see `docs/mcp-spike.md`).
 */
export const MCP_SERVER_INFO = { name: "justmy-website", version: "0.0.1" };

export const MCP_INSTRUCTIONS =
  "justmy.website connection test. The only tool is `ping`, which returns the server's time and reads no data.";

export function pong(note: string | undefined, now: Date = new Date()): string {
  const trimmed = note?.trim();
  return ["pong", now.toISOString(), ...(trimmed ? [trimmed] : [])].join(" · ");
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping justmy.website",
      description:
        "Connection test for justmy.website. Returns 'pong', the server's current time and the note, if one was sent. Reads no data.",
      inputSchema: z.object({
        note: z.string().max(200).optional().describe("Optional text to send back, to prove the arguments arrived."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ note }) => ({ content: [{ type: "text", text: pong(note) }] })
  );
}

type McpEvent = Parameters<NonNullable<McpHandlerOptions["onEvent"]>>[0];

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/**
 * Two log lines per MCP message — `<-` when it arrives, `->` when it is answered — so the order
 * `initialize` → `tools/list` → `tools/call` can be read off the function log. They name the
 * method, the client and the tool — never arguments or results, so the lines stay safe to keep once
 * tools return real data. (The handler reports the whole JSON-RPC message as `parameters` on
 * arrival, and only the method, status and duration on completion.)
 */
export function describeEvent(event: McpEvent): string {
  if (event.type === "ERROR") return `[mcp] error ${event.severity} ${String(event.error)}`;
  if (event.type === "REQUEST_COMPLETED") {
    return `[mcp] -> ${event.method} ${event.status} ${Math.round(event.duration ?? 0)}ms`;
  }
  const params = field(event.parameters, "params");
  const parts = [`[mcp] <- ${event.method}`];
  if (event.method === "initialize") {
    const client = field(params, "clientInfo");
    parts.push(`client=${String(field(client, "name"))}/${String(field(client, "version"))}`);
    parts.push(`asked=${String(field(params, "protocolVersion"))}`);
  }
  if (event.method === "tools/call") parts.push(`tool=${String(field(params, "name"))}`);
  return parts.join(" ");
}

/** The HTTP side of the same story: which verb, which transport headers, what came back. */
export function describeHttp(request: Request, response: Response): string {
  const h = request.headers;
  return [
    `[mcp] http ${request.method} -> ${response.status}`,
    `type=${response.headers.get("content-type") ?? "-"}`,
    `accept=${h.get("accept") ?? "-"}`,
    `proto=${h.get("mcp-protocol-version") ?? "-"}`,
    `session=${h.has("mcp-session-id") ? "sent" : "none"}`,
    `auth=${h.has("authorization") ? "sent" : "none"}`,
    `ua=${h.get("user-agent") ?? "-"}`,
  ].join(" ");
}
