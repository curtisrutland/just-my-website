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
        "One day of the food log. `totals` is the day's sum and `target` the goal in effect (null when none applies); " +
        "both cover only the four headline macros: `calories` in kcal, and `proteinContent`, `fatContent` and " +
        "`carbohydrateContent` in grams. `entries` lists each thing eaten, with those four plus `fiberContent`, " +
        "`sugarContent`, `sodiumContent` and `saturatedFatContent` where known. Every mass is in grams, sodium " +
        "included (0.43 means 430 mg). The extra fields are not summed in `totals`: add them up from `entries` if " +
        "needed, and treat null as unknown, never zero. An entry's `confidence` is `measured`, `logged_serving` or " +
        "`estimated`. `estimation` counts only the `estimated` ones: `estimatedCount` out of `entryCount`, and " +
        "`estimatedFraction`, the share of the day's calories they account for.",
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
        "Body weight over a window of days, in pounds. `series` has one point per day: `weight` is that day's " +
        "weigh-in (null if there was none) and `avg` is the average of the weigh-ins in the 7 days ending that day. " +
        "`summary` has `current` (the latest weigh-in), `currentAvg` (the 7-day average on the last day), `range` " +
        "(the lowest and highest weigh-in in the window) and `trendPerWeek`: pounds per week, the least-squares slope " +
        "of `avg` across the whole window, so it depends on `window`. Negative means losing weight. The window never " +
        "starts before the first weigh-in.",
      inputSchema: z.object({
        window: z.number().int().min(7).max(3650).optional().describe("How many days to cover. Default 90."),
        end: date.optional().describe("The last day of the window, YYYY-MM-DD. Omit for the day of the latest weigh-in."),
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
        "Recorded rides and other activities, newest first, as summaries (no GPS track, no sample streams). The " +
        "answer is a page: `items`, plus `count` (all matches), `limit` and `offset`. Units are SI: `distanceMeters`, " +
        "`movingSeconds`, `elapsedSeconds`, `avgSpeedMps` and `maxSpeedMps` (metres per second), `totalAscentMeters`, " +
        "watts, bpm, `calories` in kcal, `avgTemperatureC`. `localDate` is the ride's own calendar date. `name` is " +
        "often null; `sportProfileName` then says what it was, and `note` is the rider's own remark. " +
        "These are the device's numbers, unedited, so a ride can include a recorded drive: treat a `maxSpeedMps` " +
        "above about 13 (30 mph) as suspect, read the `note`, and ask before using that ride's speed or distance in " +
        "a total or a summary. " +
        "`timeInHrZone` is the watch's heart-rate zone message as recorded. Inside it, `timeInHrZone` is 7 durations " +
        "in seconds and `hrZoneHighBoundary` is the 6 upper limits in bpm: the first duration is time up to the first " +
        "limit, each next one is time between two neighbouring limits, and the last is time above the highest limit. " +
        "Ignore its other fields. A ride's `maxHeartRate` can be higher than the zones' maximum. Which bike was " +
        "ridden is not recorded here.",
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
