import type { McpHandlerOptions } from "mcp-handler";

/**
 * What the MCP endpoint says about itself, and what it logs (`docs/mcp.md`). The tools are in
 * `tools.ts`; the OAuth rules in `oauth.ts`; grant storage in `grants.ts`.
 */
export { registerTools } from "./tools";

export const MCP_SERVER_INFO = { name: "justmy-website", version: "0.2.0" };

export const MCP_INSTRUCTIONS =
  "Read-only access to justmy.website, one person's health-data platform: the food log, body weight, rides and " +
  "bikes, lifting sessions, daily watch measurements and the shopping list. Calendar dates are YYYY-MM-DD in the " +
  "owner's timezone (America/Chicago). Units differ by module and each tool says its own: food in kcal and grams, " +
  "body weight in pounds, lifting in kilograms, rides in SI. Nothing here can add, change or delete data.";

type McpEvent = Parameters<NonNullable<McpHandlerOptions["onEvent"]>>[0];

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/**
 * Two log lines per MCP message — `<-` when it arrives, `->` when it is answered — so a session can
 * be read off the function log. They name the method, the client and the tool — never arguments,
 * results or tokens. (The handler reports the whole JSON-RPC message as `parameters` on arrival,
 * and only the method, status and duration on completion.)
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
    `proto=${h.get("mcp-protocol-version") ?? "-"}`,
    `auth=${h.has("authorization") ? "sent" : "none"}`,
    `ua=${h.get("user-agent") ?? "-"}`,
  ].join(" ");
}
