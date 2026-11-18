import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { addDays, todayISO } from "@/lib/date";
import { paginated } from "@/lib/http/pagination";
import { getBike, listBikes, listRideTags } from "@/lib/garage/repo";
import { getGoalOn, getLiftProgression, getSession, listGoals, listSessions } from "@/lib/lifting/repo";
import { liftingFocus } from "@/lib/lifting/schema";
import {
  getBatchById,
  getDayRollup,
  getFoodById,
  getRange,
  listBatches,
  listEntries as listMacroEntries,
  listFoods,
} from "@/lib/macros/repo";
import { getRide, listRides, weeklyStats } from "@/lib/rides/repo";
import { getItemById, getList, listItems } from "@/lib/shopping/repo";
import { searchFoods } from "@/lib/usda/client";
import { getDay as getVitalsDay, getRollup as getVitalsRollup, listDays as listVitalsDays, toView as vitalsView } from "@/lib/vitals/repo";
import { getEntryByDay, getRollup as getWeightRollup, listEntries as listWeightEntries } from "@/lib/weight/repo";
import type { McpScope } from "./oauth";

/**
 * The MCP surface's tools (`docs/mcp.md` §4). A surface, not a module: every tool calls a module's
 * own repo read function and returns the same JSON the token API route for that read returns, with
 * the same field names. Read-only — there is no write tool, and no scope that would allow one.
 *
 * Where the API has a list route and a get-by-id route, one tool serves both: an `id` (or a single
 * `date`) returns that one thing, in the shape the get route returns; without it, the tool returns
 * what the list route returns. That keeps the tool count, which every conversation pays for, down.
 *
 * Descriptions state what a reader can't guess from the field names: units, what is and isn't
 * summed, how to read a raw shape. How to ACT on the data belongs in the skills, not here.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const refusal = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] });

/** Thrown by a tool's reader to refuse a request it can't serve, with a message for the caller. */
export class Refused extends Error {}

/** Returned by a tool's reader when the thing asked for doesn't exist. */
export const NOT_FOUND = Symbol("not found");

/** claude.ai cuts a tool result off at about 150,000 characters; refuse clearly a little before that. */
export const MAX_RESULT_CHARS = 140_000;

export function toResult(data: unknown): ToolResult {
  if (data === NOT_FOUND) return refusal("Not found: nothing matches that id or date.");
  const text = JSON.stringify(data);
  if (text.length > MAX_RESULT_CHARS) {
    return refusal(`The result is too large to return (${text.length} characters). Ask for less: a smaller limit, a shorter range, or no stream.`);
  }
  return { content: [{ type: "text", text }] };
}

type ToolSpec<Shape extends z.ZodRawShape> = {
  name: string;
  scope: McpScope;
  title: string;
  description: string;
  input: Shape;
  /** True when the tool reaches a service outside this platform. */
  openWorld?: boolean;
  read: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
};

/**
 * Register one read tool. The scope check lives here so no tool can forget it: `/mcp` has already
 * refused a request without a live grant; this decides whether THIS grant may run THIS tool.
 */
function reader<Shape extends z.ZodRawShape>(server: McpServer, spec: ToolSpec<Shape>): void {
  const run = async (args: z.infer<z.ZodObject<Shape>>, ctx: ServerContext): Promise<ToolResult> => {
    if (!ctx.http?.authInfo?.scopes.includes(spec.scope)) {
      return refusal(
        `This connection was not granted the ${spec.scope} scope. Reconnect the connector in Claude and approve it again to add it.`
      );
    }
    try {
      return toResult(await spec.read(args));
    } catch (error) {
      if (error instanceof Refused) return refusal(error.message);
      throw error;
    }
  };
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: z.object(spec.input),
      annotations: { readOnlyHint: true, openWorldHint: spec.openWorld ?? false },
    },
    // The SDK types the callback from the schema it is handed; through this generic wrapper that
    // inference can't see the shape, so the (identical) type is asserted once here.
    run as never
  );
}

/**
 * Dates and ids are validated here by refinement, not by `z.iso.date()` / `z.uuid()`: those put a
 * 200-character regular expression into the tool's published schema for every field, and the whole
 * tool list is sent with every conversation. A `format` hint tells the reader the same thing.
 */
const date = z
  .string()
  .refine((value) => z.iso.date().safeParse(value).success, { error: "must be a YYYY-MM-DD calendar date" })
  .meta({ format: "date" });
const id = z
  .string()
  .refine((value) => z.uuid().safeParse(value).success, { error: "must be an id (a UUID) from another tool's result" })
  .meta({ format: "uuid" });
/** An ISO date or datetime, as the lifting routes take it. */
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { error: "must be an ISO date or datetime" });
const page = {
  limit: z.number().int().min(1).max(100).optional().describe("Items per page. Default 20."),
  offset: z.number().int().min(0).max(1_000_000).optional().describe("Items to skip. Default 0."),
};
const paging = (args: { limit?: number; offset?: number }) => ({ limit: args.limit ?? 20, offset: args.offset ?? 0 });
const PAGE = "The answer is a page: `items`, plus `count` (all matches), `limit` and `offset`.";

/** A list read wrapped in the API's pagination envelope (CONVENTIONS §4). */
async function paged<T>(args: { limit?: number; offset?: number }, list: (p: { limit: number; offset: number }) => Promise<{ items: T[]; count: number }>) {
  const p = paging(args);
  const { items, count } = await list(p);
  return paginated(items, count, p.limit, p.offset);
}

const MACROS_SPAN_DAYS = 366;

export function registerTools(server: McpServer): void {
  // --- Macros ---

  reader(server, {
    name: "macros_day",
    scope: "macros:read",
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
    input: { date: date.optional().describe("The calendar date, YYYY-MM-DD. Omit for today.") },
    read: (args) => getDayRollup(args.date ?? todayISO()),
  });

  reader(server, {
    name: "macros_range",
    scope: "macros:read",
    title: "Food log totals over a date range",
    description:
      "One row per calendar day from `start` to `end`, both included: `date`, `totals` and `target`, each with the " +
      "four headline macros (`calories` in kcal; protein, fat and carbohydrate in grams). A day with nothing logged " +
      "has zero totals, so check before averaging. No entries here: use `macros_day` for those. At most " +
      `${MACROS_SPAN_DAYS} days.`,
    input: { start: date.describe("First day, YYYY-MM-DD."), end: date.describe("Last day, YYYY-MM-DD.") },
    read: async ({ start, end }) => {
      if (start > end) throw new Refused("start must be on or before end.");
      if (end > addDays(start, MACROS_SPAN_DAYS - 1)) throw new Refused(`The range may span at most ${MACROS_SPAN_DAYS} days.`);
      return getRange(start, end);
    },
  });

  reader(server, {
    name: "macros_entries",
    scope: "macros:read",
    title: "Food log entries",
    description:
      "Logged food entries, latest day first, across days or for one day (`on`). Each entry has what was eaten " +
      "(`name`), the day (`consumedOn`), `quantityGrams`, its nutrition for that quantity (kcal and grams, as in " +
      "`macros_day`), `confidence`, a `note`, and the catalog food (`foodId`) or batch (`batchId`) it was drawn " +
      "from, if any. " +
      PAGE,
    input: { on: date.optional().describe("Only entries eaten on this date."), ...page },
    read: (args) => paged(args, (p) => listMacroEntries({ ...p, on: args.on })),
  });

  reader(server, {
    name: "macros_foods",
    scope: "macros:read",
    title: "Food catalog",
    description:
      "The catalog of known foods (pinned ingredients and label-verified products). A food's nutrition is per 100 g " +
      "of the food: `calories` in kcal, every other field in grams (sodium too). With `id`, returns that one food. " +
      "Otherwise a page, filtered by `q` (text in the name), `category` or `brand`. " +
      PAGE,
    input: {
      id: id.optional().describe("Return just this food."),
      q: z.string().min(1).optional().describe("Text to find in the food's name."),
      category: z.string().min(1).optional(),
      brand: z.string().min(1).optional(),
      ...page,
    },
    read: async (args) => {
      if (args.id) return (await getFoodById(args.id)) ?? NOT_FOUND;
      return paged(args, (p) => listFoods({ ...p, q: args.q, category: args.category, brand: args.brand }));
    },
  });

  reader(server, {
    name: "macros_batches",
    scope: "macros:read",
    title: "Cooked batches",
    description:
      "Batches of cooked food that entries are drawn from. A batch's nutrition is per 100 g of the cooked batch " +
      "(kcal and grams). `status` is `active` or `finished`. With `id`, returns that batch plus `consumedGrams`, " +
      "`drawCount` and `remainingGrams`; `remainingGrams` is a rough guide only (other people's servings aren't " +
      "logged) and null when the batch's starting weight wasn't recorded. Otherwise a page. " +
      PAGE,
    input: {
      id: id.optional().describe("Return just this batch, with its consumption."),
      status: z.enum(["active", "finished", "all"]).optional().describe("Default all."),
      q: z.string().min(1).optional().describe("Text to find in the batch's name."),
      ...page,
    },
    read: async (args) => {
      if (args.id) return (await getBatchById(args.id)) ?? NOT_FOUND;
      return paged(args, (p) => listBatches({ ...p, q: args.q, status: args.status ?? "all" }));
    },
  });

  reader(server, {
    name: "macros_usda_search",
    scope: "macros:read",
    title: "Search the USDA food database",
    description:
      "Searches USDA FoodData Central, an outside service, for reference nutrition. Returns up to 10 matches in " +
      "`items`, as that service describes them. Nothing here is from the owner's own log, and nothing is saved.",
    input: { q: z.string().min(1).describe("The food to look for.") },
    openWorld: true,
    read: async ({ q }) => ({ items: await searchFoods(q, { pageSize: 10 }) }),
  });

  // --- Weight ---

  reader(server, {
    name: "weight_rollup",
    scope: "weight:read",
    title: "Body weight trend",
    description:
      "Body weight over a window of days, in pounds. `series` has one point per day: `weight` is that day's " +
      "weigh-in (null if there was none) and `avg` is the average of the weigh-ins in the 7 days ending that day. " +
      "`summary` has `current` (the latest weigh-in), `currentAvg` (the 7-day average on the last day), `range` " +
      "(the lowest and highest weigh-in in the window) and `trendPerWeek`: pounds per week, the least-squares slope " +
      "of `avg` across the whole window, so it depends on `window`. Negative means losing weight. The window never " +
      "starts before the first weigh-in.",
    input: {
      window: z.number().int().min(7).max(3650).optional().describe("How many days to cover. Default 90."),
      end: date.optional().describe("The last day of the window, YYYY-MM-DD. Omit for the day of the latest weigh-in."),
    },
    read: (args) => getWeightRollup({ window: args.window ?? 90, end: args.end }),
  });

  reader(server, {
    name: "weight_entries",
    scope: "weight:read",
    title: "Weigh-ins",
    description:
      "The weigh-ins themselves, in pounds, at most one per day, each with its `measuredOn` date and optional " +
      "`note`. With `date`, returns that day's weigh-in. Otherwise a page, newest first. " +
      PAGE,
    input: { date: date.optional().describe("Return just this day's weigh-in."), ...page },
    read: async (args) => {
      if (args.date) return (await getEntryByDay(args.date)) ?? NOT_FOUND;
      return paged(args, (p) => listWeightEntries(p));
    },
  });

  // --- Rides ---

  reader(server, {
    name: "rides_list",
    scope: "rides:read",
    title: "Ride log",
    description:
      "Recorded rides and other activities, newest first, as summaries (no GPS track, no sample streams). " +
      PAGE +
      " Units are SI: `distanceMeters`, `movingSeconds`, `elapsedSeconds`, `avgSpeedMps` and `maxSpeedMps` (metres " +
      "per second), `totalAscentMeters`, watts, bpm, `calories` in kcal, `avgTemperatureC`. `localDate` is the " +
      "ride's own calendar date. `name` is often null; `sportProfileName` then says what it was, and `note` is the " +
      "rider's own remark. " +
      "These are the device's numbers, unedited, so a ride can include a recorded drive: treat a `maxSpeedMps` " +
      "above about 13 (30 mph) as suspect, read the `note`, and ask before using that ride's speed or distance in " +
      "a total or a summary. " +
      "`timeInHrZone` is the watch's heart-rate zone message as recorded. Inside it, `timeInHrZone` is 7 durations " +
      "in seconds and `hrZoneHighBoundary` is the 6 upper limits in bpm: the first duration is time up to the first " +
      "limit, each next one is time between two neighbouring limits, and the last is time above the highest limit. " +
      "Ignore its other fields. A ride's `maxHeartRate` can be higher than the zones' maximum. Which bike was " +
      "ridden is not recorded here: see `garage_rides`.",
    input: {
      from: date.optional().describe("Only rides on or after this local date."),
      to: date.optional().describe("Only rides on or before this local date."),
      sport: z.string().min(1).optional().describe('The device\'s sport, verbatim, e.g. "cycling".'),
      q: z.string().min(1).optional().describe("Text to find in the ride's name or its device profile name."),
      ...page,
    },
    read: ({ limit, offset, ...filters }) => paged({ limit, offset }, (p) => listRides({ ...p, ...filters })),
  });

  reader(server, {
    name: "rides_detail",
    scope: "rides:read",
    title: "One ride in full",
    description:
      "One ride, with the same fields and units as `rides_list`. With `stream: true` it also carries `stream`: the " +
      "recorded samples averaged into buckets of `resolutionSeconds`, as parallel arrays under `data`. `t` is " +
      "seconds from the start; the other arrays line up with it, a null means no reading in that bucket, and a " +
      "channel the device never recorded is absent. A stream is large (a four-hour ride is about 130,000 " +
      "characters, and longer ones are refused), so ask for it only when the question needs the samples.",
    input: {
      id: id.describe("The ride's id, from `rides_list`."),
      stream: z.boolean().optional().describe("Include the sample stream. Default false."),
    },
    read: async (args) => (await getRide(args.id, { includeStream: args.stream ?? false })) ?? NOT_FOUND,
  });

  reader(server, {
    name: "rides_weekly",
    scope: "rides:read",
    title: "Riding by week",
    description:
      "Riding totalled by ISO week, newest first: `weekStart` (the Monday), `rides`, `distanceMeters`, " +
      "`movingSeconds`, `totalAscentMeters`, and `avgPowerWatts` (the mean over that week's rides that recorded " +
      "power, else null). Weeks with no rides are left out. The totals are the device's numbers, so a week can " +
      "include a recorded drive: check `rides_list` for a `maxSpeedMps` above about 13 before quoting a distance.",
    input: {
      weeks: z.number().int().min(1).max(104).optional().describe("How many weeks back. Default 8."),
      sport: z.string().min(1).optional().describe('One sport, verbatim, or "all". Default "cycling".'),
    },
    read: (args) => {
      const sport = args.sport ?? "cycling";
      return weeklyStats({ weeks: args.weeks ?? 8, sport: sport === "all" ? undefined : sport });
    },
  });

  // --- Lifting ---

  reader(server, {
    name: "lifting_sessions",
    scope: "lifting:read",
    title: "Lifting sessions",
    description:
      "Lifting sessions recorded in Hevy, newest first. Weights are in kilograms throughout. A summary has `title`, " +
      "`startedAt`, `derived` (`tonnageKg`, `workingSets`, `totalReps`, `exerciseCount`, best estimated one-rep max, " +
      "`durationMin`, and `prs` set that day) and `annotation` (the owner's `sessionNotes` and 1 to 5 `quality`, " +
      "plus the `focus` and written `interpretation` added afterwards; `interpreted` says whether one exists). " +
      "With `id`, returns that session in full: every exercise and set (`weightKg`, `reps`, `rpe`, `setType`), " +
      "and `goal`, the training goal in force on that session's date. Otherwise a page, which also carries " +
      "today's `goal`. " +
      PAGE,
    input: {
      id: id.optional().describe("Return just this session, with its exercises and sets."),
      interpreted: z.boolean().optional().describe("Only sessions that have (true) or lack (false) an interpretation."),
      focus: liftingFocus.optional(),
      from: instant.optional().describe("Only sessions started at or after this instant. A bare date means midnight UTC that day."),
      to: instant.optional().describe("Only sessions started at or before this instant. A bare date means midnight UTC, so it leaves that day out."),
      ...page,
    },
    read: async (args) => {
      if (args.id) return (await getSession(args.id)) ?? NOT_FOUND;
      const p = paging(args);
      const { items, count, goal } = await listSessions({ ...p, interpreted: args.interpreted, focus: args.focus, from: args.from, to: args.to });
      return { ...paginated(items, count, p.limit, p.offset), goal };
    },
  });

  reader(server, {
    name: "lifting_goal",
    scope: "lifting:read",
    title: "Training goal",
    description:
      "The training goal: prose in the owner's own words saying what the lifting is for, with the date it took " +
      "effect. By default returns the goal in force today, or on `on`; null when none was set by then. With " +
      "`history: true`, returns every goal ever set, newest first, as a page.",
    input: {
      on: date.optional().describe("The goal in force on this date. Omit for today."),
      history: z.boolean().optional().describe("Return all goals instead."),
      ...page,
    },
    read: async (args) => (args.history ? paged(args, (p) => listGoals(p)) : getGoalOn(args.on)),
  });

  reader(server, {
    name: "lifting_lift",
    scope: "lifting:read",
    title: "One lift's history",
    description:
      "How one lift has progressed, oldest to newest: one point per session it appeared in, with the top set's " +
      "weight in kilograms and the best estimated one-rep max. The lift is named by its Hevy template id, found as " +
      "`exerciseTemplateId` on an exercise in a full session (`lifting_sessions` with `id`).",
    input: { templateId: z.string().min(1).describe("The lift's `exerciseTemplateId`.") },
    read: (args) => getLiftProgression(args.templateId),
  });

  // --- Vitals ---

  reader(server, {
    name: "vitals_days",
    scope: "vitals:read",
    title: "Daily watch measurements",
    description:
      "What the watch measured, one row per local calendar date (`measuredOn`). Sleep fields are in seconds " +
      "(`sleepTotalSeconds`, deep, light, REM, awake, naps) with `sleepStartAt` and `sleepEndAt`; " +
      "`restingHeartRate`, `minHeartRate` and `maxHeartRate` are bpm; `hrvLastNightMs` is milliseconds; SpO2 " +
      "fields are percent; respiration is breaths per minute; then `steps`, `floorsAscended` and intensity " +
      "minutes. A null means the watch didn't measure it that day, never zero. With `date`, returns " +
      "that day. Otherwise a page, newest first, optionally between `from` and `to`. " +
      PAGE,
    input: {
      date: date.optional().describe("Return just this day."),
      from: date.optional(),
      to: date.optional(),
      ...page,
    },
    read: async (args) => {
      if (args.date) {
        const row = await getVitalsDay(args.date);
        return row ? vitalsView(row) : NOT_FOUND;
      }
      return paged(args, (p) => listVitalsDays({ ...p, from: args.from, to: args.to }));
    },
  });

  reader(server, {
    name: "vitals_summary",
    scope: "vitals:read",
    title: "Sleep, resting heart rate and HRV trends",
    description:
      "Trends over a window of days for three measurements: `restingHeartRate` (bpm), `hrvLastNightMs` " +
      "(milliseconds) and `sleepTotalSeconds`. Each has `current` (the value on the last day, null if that day " +
      "has none), `currentAvg` (the 7-day average on the last day), `deltaPerWeek` (that average minus the same " +
      "average a week earlier) and a per-day `series` of `value` and `avg`. " +
      "`gaps` lists the days with no row or no measurements; a gap is a missing reading, not a bad night.",
    input: {
      window: z.number().int().min(1).max(365).optional().describe("How many days to cover. Default 30."),
      end: date.optional().describe("The last day of the window. Omit for the latest day with data."),
    },
    read: (args) => getVitalsRollup({ window: args.window, end: args.end }),
  });

  // --- Shopping ---

  reader(server, {
    name: "shopping_list",
    scope: "shopping:read",
    title: "Shopping list",
    description:
      "The shopping list as the owner sees it: `active` is what still needs buying, grouped by `category`; " +
      "`recentlyBought` is what was checked off lately, newest first; `activeCount` is how many items are still " +
      "needed. Each item has `text`, `status` (`needed` or `bought`) and `checkedAt`.",
    input: {
      boughtWithinDays: z.number().int().min(1).max(365).optional().describe("How far back `recentlyBought` reaches, in days."),
    },
    read: (args) => getList({ boughtWithinDays: args.boughtWithinDays }),
  });

  reader(server, {
    name: "shopping_items",
    scope: "shopping:read",
    title: "Shopping items",
    description:
      "Every shopping item that hasn't been removed, bought ones included, newest first, as plain rows. Use " +
      "`shopping_list` to see the list itself; this is for looking an item up. With `id`, returns that item. " +
      "Otherwise a page. " +
      PAGE,
    input: { id: id.optional().describe("Return just this item."), ...page },
    read: async (args) => {
      if (args.id) return (await getItemById(args.id)) ?? NOT_FOUND;
      return paged(args, (p) => listItems(p));
    },
  });

  // --- Garage ---

  reader(server, {
    name: "garage_bikes",
    scope: "garage:read",
    title: "Bikes",
    description:
      "The owner's bikes: `name`, `brand`, `model`, `modelYear`, the device `profiles` that mean this bike, and " +
      "totals from the rides tagged to it: `rides`, `movingSeconds`, `distanceMeters` (metres) and `lastRiddenOn`. " +
      "With `from` and `to`, the totals cover only rides in that window. Retired bikes are left out unless " +
      "`includeRetired` is true. With `id`, returns that one bike; otherwise `items`. The totals come from the " +
      "ride log's own numbers, so a recorded drive tagged to a bike counts towards it.",
    input: {
      id: id.optional().describe("Return just this bike."),
      from: date.optional().describe("Count only rides on or after this date."),
      to: date.optional().describe("Count only rides on or before this date."),
      includeRetired: z.boolean().optional(),
    },
    read: async (args) => {
      const window = { from: args.from, to: args.to };
      if (args.id) return (await getBike(args.id, window)) ?? NOT_FOUND;
      return { items: await listBikes({ includeRetired: args.includeRetired ?? false, ...window }) };
    },
  });

  reader(server, {
    name: "garage_rides",
    scope: "garage:read",
    title: "Which bike each ride was on",
    description:
      "Ride tags: one per ride that has been matched to a bike. `activityId` is the ride's id in `rides_list`, " +
      "`bikeId` the bike's id in `garage_bikes`. `assignedBy` is `rule`, `manual` or `backfill`, with the " +
      "`reason`. Each tag carries the ride's `localDate`, `movingSeconds` and `distanceMeters`. A ride with no tag " +
      "here hasn't been matched to a bike. Filter by `bikeId`, `activityId`, or a date range. " +
      PAGE,
    input: {
      bikeId: id.optional(),
      activityId: id.optional().describe("The ride's id."),
      from: date.optional(),
      to: date.optional(),
      ...page,
    },
    read: ({ limit, offset, ...query }) => paged({ limit, offset }, (p) => listRideTags(query, p)),
  });
}
