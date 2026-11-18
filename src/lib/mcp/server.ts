import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { McpHandlerOptions } from "mcp-handler";
import { z } from "zod";
import { todayISO } from "@/lib/date";
import { paginated } from "@/lib/http/pagination";
import { getDayRollup } from "@/lib/macros/repo";
import { listRides } from "@/lib/rides/repo";
import { getRollup } from "@/lib/weight/repo";
import type { McpScope } from "./oauth";

/**
 * The MCP surface's tools (`docs/mcp.md` §4). A surface, not a module: every tool calls a module's
 * own repo read function and returns the same JSON the token API route for that read returns, with
 * the same field names. Read-only — there is no write tool, and no scope that would allow one.
 */
export const MCP_SERVER_INFO = { name: "justmy-website", version: "0.1.0" };

export const MCP_INSTRUCTIONS =
  "Read-only access to justmy.website, a personal health-data platform: the food log, body weight and the ride log. " +
  "Calendar dates are YYYY-MM-DD in the owner's timezone (America/Chicago). Nothing here can add, change or delete data.";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

/**
 * The scope check, per tool. `/mcp` already refused the request if there was no live grant; this
 * decides whether THIS grant may run THIS tool. Returns the refusal to send, or null to go ahead.
 */
function missingScope(ctx: ServerContext, scope: McpScope): ToolResult | null {
  if (ctx.http?.authInfo?.scopes.includes(scope)) return null;
  return { isError: true, content: [{ type: "text", text: `This connection was not granted the ${scope} scope.` }] };
}

const date = z.iso.date();
const readOnly = { readOnlyHint: true, openWorldHint: false };

export function registerTools(server: McpServer): void {
  server.registerTool(
    "macros_day",
    {
      title: "Food log for a day",
      description:
        "One day of the food log: `totals` and `target` (calories in kcal, every other field in grams, schema.org " +
        "NutritionInformation names), `estimation` (how much of the day is estimated) and `entries` (each thing eaten). " +
        "`target` is null when no target applies.",
      inputSchema: z.object({
        date: date.optional().describe("The calendar date, YYYY-MM-DD. Omit for today."),
      }),
      annotations: readOnly,
    },
    async (args, ctx) => missingScope(ctx, "macros:read") ?? json(await getDayRollup(args.date ?? todayISO()))
  );

  server.registerTool(
    "weight_rollup",
    {
      title: "Body weight trend",
      description:
        "Body weight over a window of days, in pounds: `series` (one point per day with that day's `weight`, null if " +
        "not weighed, and the 7-day average `avg`) and `summary` (`current`, `currentAvg`, `trendPerWeek`, `range`).",
      inputSchema: z.object({
        window: z.number().int().min(7).max(3650).optional().describe("How many days to cover. Default 90."),
        end: date.optional().describe("The last day of the window, YYYY-MM-DD. Omit for today."),
      }),
      annotations: readOnly,
    },
    async (args, ctx) => missingScope(ctx, "weight:read") ?? json(await getRollup({ window: args.window ?? 90, end: args.end }))
  );

  server.registerTool(
    "rides_list",
    {
      title: "Ride log",
      description:
        "Recorded rides and other activities, newest first, as summaries (no GPS or sample streams). Units are SI: " +
        "`distanceMeters`, `movingSeconds`, `elapsedSeconds`, `avgSpeedMps`, `totalAscentMeters`, watts, bpm, kcal. " +
        "`localDate` is the ride's own calendar date. `name` is often null; `sportProfileName` then says what it was. " +
        "The answer is a page: `items`, plus `count` (all matches), `limit` and `offset`.",
      inputSchema: z.object({
        from: date.optional().describe("Only rides on or after this local date."),
        to: date.optional().describe("Only rides on or before this local date."),
        sport: z.string().min(1).optional().describe('The device\'s sport, verbatim, e.g. "cycling".'),
        q: z.string().min(1).optional().describe("Text to find in the ride's name or its device profile name."),
        limit: z.number().int().min(1).max(100).optional().describe("Rides per page. Default 20."),
        offset: z.number().int().min(0).optional().describe("Rides to skip. Default 0."),
      }),
      annotations: readOnly,
    },
    async (args, ctx) => {
      const refused = missingScope(ctx, "rides:read");
      if (refused) return refused;
      const { limit = 20, offset = 0, ...filters } = args;
      const { items, count } = await listRides({ limit, offset, ...filters });
      return json(paginated(items, count, limit, offset));
    }
  );
}

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
