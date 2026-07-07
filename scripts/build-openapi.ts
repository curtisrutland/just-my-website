import { mkdirSync, writeFileSync } from "node:fs";
import * as z from "zod";
import {
  dayTagCreateSchema,
  entryCreateBatchSchema,
  entryCreateSchema,
  entryPatchSchema,
  entryViewSchema,
  foodCreateSchema,
  foodPatchSchema,
  targetProfileCreateSchema,
  targetProfilePatchSchema,
} from "../src/lib/macros/schema";
import { shoppingCreateSchema, shoppingPatchSchema } from "../src/lib/shopping/schema";
import { weightCreateSchema, weightPatchSchema } from "../src/lib/weight/schema";

/**
 * Generate each module's OpenAPI fragment FROM its Zod schemas (CONVENTIONS: schema.ts is the single
 * source of truth; the spec is downstream). One fragment per module, mirroring the module anatomy.
 * Output is a build artifact (gitignored).
 */
const js = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" });

const ERR = { $ref: "#/components/schemas/Error" };
const errorResponses = {
  "400": { description: "Validation or invalid JSON", content: { "application/json": { schema: ERR } } },
  "401": { description: "Missing/invalid token", content: { "application/json": { schema: ERR } } },
  "404": { description: "Not found", content: { "application/json": { schema: ERR } } },
};

const jsonBody = (ref: string) => ({ required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
const okList = (item: string) => ({
  "200": {
    description: "Paginated list",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["items", "limit", "offset", "count"],
          properties: {
            items: { type: "array", items: { $ref: `#/components/schemas/${item}` } },
            limit: { type: "integer" },
            offset: { type: "integer" },
            count: { type: "integer" },
          },
        },
      },
    },
  },
});
const ok = (desc: string) => ({ "200": { description: desc } });
const created = (desc: string) => ({ "201": { description: desc } });
const noContent = { "204": { description: "Deleted" } };

const pageParams = [
  { name: "limit", in: "query", schema: { type: "integer", default: 50, minimum: 1, maximum: 100 } },
  { name: "offset", in: "query", schema: { type: "integer", default: 0, minimum: 0 } },
];
const pathParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const hardParam = { name: "hard", in: "query", schema: { type: "boolean" }, description: "Hard delete (requires the primary key)" };

// Shared across every module fragment (the small kernel: two-token auth + the error envelope).
const securitySchemes = {
  bearerAuth: { type: "http", scheme: "bearer", description: "JMW_API_KEY or JMW_AGENT_TOKEN" },
  primaryKey: { type: "http", scheme: "bearer", description: "JMW_API_KEY only — required for hard DELETE" },
};
const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object" } },
    },
  },
};

const macrosSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — macros",
    version: "0.1.0",
    description: "Token API for the macro module. Generated from Zod schemas; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes,
    schemas: {
      FoodCreate: js(foodCreateSchema),
      FoodPatch: js(foodPatchSchema),
      EntryCreate: js(entryCreateSchema),
      EntryCreateBatch: js(entryCreateBatchSchema),
      EntryPatch: js(entryPatchSchema),
      // The canonical READ shape — identical for `GET /entries` items and the day-rollup entries.
      EntryView: js(entryViewSchema),
      RangeDay: {
        type: "object",
        required: ["date", "kind", "totals", "targets"],
        properties: {
          date: { type: "string", format: "date" },
          kind: { type: "string", enum: ["training", "rest", "unspecified"] },
          totals: { $ref: "#/components/schemas/MacroTotals" },
          targets: {
            type: "object",
            properties: { training: { $ref: "#/components/schemas/MacroTotals" }, rest: { $ref: "#/components/schemas/MacroTotals" } },
          },
        },
      },
      DayRollup: {
        type: "object",
        required: ["day", "totals", "estimation", "targets", "entries"],
        properties: {
          day: {
            type: "object",
            required: ["date", "kind"],
            properties: { date: { type: "string", format: "date" }, kind: { type: "string", enum: ["training", "rest", "unspecified"] } },
          },
          totals: { $ref: "#/components/schemas/MacroTotals" },
          estimation: {
            type: "object",
            required: ["estimatedFraction", "entryCount", "estimatedCount"],
            properties: { estimatedFraction: { type: "number" }, entryCount: { type: "integer" }, estimatedCount: { type: "integer" } },
          },
          targets: {
            type: "object",
            properties: { training: { $ref: "#/components/schemas/MacroTotals" }, rest: { $ref: "#/components/schemas/MacroTotals" } },
          },
          entries: { type: "array", items: { $ref: "#/components/schemas/EntryView" } },
        },
      },
      MacroTotals: {
        type: "object",
        required: ["calories", "proteinContent", "fatContent", "carbohydrateContent"],
        properties: {
          calories: { type: "number", nullable: true },
          proteinContent: { type: "number", nullable: true },
          fatContent: { type: "number", nullable: true },
          carbohydrateContent: { type: "number", nullable: true },
        },
      },
      DayTagCreate: js(dayTagCreateSchema),
      TargetProfileCreate: js(targetProfileCreateSchema),
      TargetProfilePatch: js(targetProfilePatchSchema),
      UsdaResolve: { type: "object", required: ["fdcId"], properties: { fdcId: { type: "integer", minimum: 1 } } },
      Error: errorSchema,
    },
  },
  paths: {
    "/api/macros/foods": {
      get: { summary: "List foods", parameters: [...pageParams, { name: "q", in: "query", schema: { type: "string" } }], responses: { ...okList("FoodCreate"), ...errorResponses } },
      post: { summary: "Create a food", requestBody: jsonBody("FoodCreate"), responses: { ...created("Created food"), ...errorResponses } },
    },
    "/api/macros/foods/{id}": {
      get: { summary: "Get a food", parameters: [pathParam("id")], responses: { ...ok("Food"), ...errorResponses } },
      patch: { summary: "Update a food", parameters: [pathParam("id")], requestBody: jsonBody("FoodPatch"), responses: { ...ok("Updated food"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a food", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/entries": {
      get: { summary: "List entries", parameters: [...pageParams, { name: "on", in: "query", schema: { type: "string", format: "date" } }], responses: { ...okList("EntryView"), ...errorResponses } },
      post: { summary: "Log an entry", requestBody: jsonBody("EntryCreate"), responses: { ...created("Logged entry"), ...errorResponses } },
    },
    "/api/macros/entries/batch": {
      post: {
        summary: "Atomically log multiple entries (all-or-nothing)",
        requestBody: jsonBody("EntryCreateBatch"),
        responses: {
          "201": {
            description: "All entries created, in input order (EntryView shape). On any failure, zero are written.",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/EntryView" } } } },
          },
          ...errorResponses,
        },
      },
    },
    "/api/macros/entries/{id}": {
      get: { summary: "Get an entry", parameters: [pathParam("id")], responses: { ...ok("Entry"), ...errorResponses } },
      patch: { summary: "Correct an entry", parameters: [pathParam("id")], requestBody: jsonBody("EntryPatch"), responses: { ...ok("Updated entry"), ...errorResponses } },
      delete: { summary: "Soft/hard delete an entry", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/day-tags": {
      post: { summary: "Set (upsert) a day's kind", requestBody: jsonBody("DayTagCreate"), responses: { ...ok("Day tag"), ...errorResponses } },
    },
    "/api/macros/day-tags/{day}": {
      get: { summary: "Get a day's tag", parameters: [pathParam("day")], responses: { ...ok("Day tag"), ...errorResponses } },
      delete: { summary: "Clear a day's tag", parameters: [pathParam("day"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/target-profiles": {
      get: { summary: "List target profiles", parameters: [...pageParams, { name: "kind", in: "query", schema: { type: "string" } }], responses: { ...okList("TargetProfileCreate"), ...errorResponses } },
      post: { summary: "Create a target profile", requestBody: jsonBody("TargetProfileCreate"), responses: { ...created("Created profile"), ...errorResponses } },
    },
    "/api/macros/target-profiles/{id}": {
      patch: { summary: "Update a target profile", parameters: [pathParam("id")], requestBody: jsonBody("TargetProfilePatch"), responses: { ...ok("Updated profile"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a target profile", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/days/{date}": {
      get: {
        summary: "Day rollup (totals, estimation, target(s), entries)",
        parameters: [pathParam("date")],
        responses: {
          "200": { description: "Day rollup", content: { "application/json": { schema: { $ref: "#/components/schemas/DayRollup" } } } },
          ...errorResponses,
        },
      },
    },
    "/api/macros/range": {
      get: {
        summary: "Per-day four-macro totals across an inclusive [start, end] span",
        parameters: [
          { name: "start", in: "query", required: true, schema: { type: "string", format: "date" } },
          { name: "end", in: "query", required: true, schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": {
            description: "One row per day (chronological); empty days are zeroed, never missing",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/RangeDay" } } } },
          },
          ...errorResponses,
        },
      },
    },
    "/api/macros/usda/search": {
      get: { summary: "Search USDA FoodData Central", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { ...ok("Search hits"), ...errorResponses } },
    },
    "/api/macros/usda/resolve": {
      post: { summary: "Resolve + cache a USDA food", requestBody: jsonBody("UsdaResolve"), responses: { ...ok("Cached food"), ...errorResponses } },
    },
  },
};

const weightSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — weight",
    version: "0.1.0",
    description: "Token API for the weight module. Generated from Zod schemas; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes,
    schemas: {
      WeightCreate: js(weightCreateSchema),
      WeightPatch: js(weightPatchSchema),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/weight/entries": {
      get: { summary: "List weigh-ins", parameters: [...pageParams], responses: { ...okList("WeightCreate"), ...errorResponses } },
      post: { summary: "Upsert a day's weight (one per day; re-logging replaces it)", requestBody: jsonBody("WeightCreate"), responses: { ...ok("Weigh-in (created or replaced) + Location"), ...errorResponses } },
    },
    "/api/weight/entries/{id}": {
      get: { summary: "Get a weigh-in", parameters: [pathParam("id")], responses: { ...ok("Weigh-in"), ...errorResponses } },
      patch: { summary: "Correct a weigh-in", parameters: [pathParam("id")], requestBody: jsonBody("WeightPatch"), responses: { ...ok("Updated weigh-in"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a weigh-in", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/weight/days/{date}": {
      get: { summary: "Get a day's weigh-in", parameters: [pathParam("date")], responses: { ...ok("Weigh-in"), ...errorResponses } },
    },
    "/api/weight/rollup": {
      get: {
        summary: "Trend rollup: per-day series (raw + 7-day average) + summary stats",
        parameters: [
          { name: "window", in: "query", schema: { type: "integer", default: 90, minimum: 7, maximum: 3650 }, description: "Days back from `end`" },
          { name: "end", in: "query", schema: { type: "string", format: "date" }, description: "Last day of the window (default today)" },
        ],
        responses: { ...ok("Rollup (series + summary)"), ...errorResponses },
      },
    },
  },
};

const shoppingSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — shopping",
    version: "0.1.0",
    description: "Token API for the shopping module. Generated from Zod schemas; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes,
    schemas: {
      ShoppingCreate: js(shoppingCreateSchema),
      ShoppingPatch: js(shoppingPatchSchema),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/shopping/items": {
      get: { summary: "List items", parameters: [...pageParams], responses: { ...okList("ShoppingCreate"), ...errorResponses } },
      post: { summary: "Add an item", requestBody: jsonBody("ShoppingCreate"), responses: { ...created("Created item"), ...errorResponses } },
    },
    "/api/shopping/items/{id}": {
      get: { summary: "Get an item", parameters: [pathParam("id")], responses: { ...ok("Item"), ...errorResponses } },
      patch: { summary: "Edit or check/un-check an item", parameters: [pathParam("id")], requestBody: jsonBody("ShoppingPatch"), responses: { ...ok("Updated item"), ...errorResponses } },
      delete: { summary: "Soft/hard delete an item", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/shopping/list": {
      get: {
        summary: "The two-section list view (active grouped by category + recently bought + activeCount)",
        parameters: [{ name: "boughtWithinDays", in: "query", schema: { type: "integer", default: 7, minimum: 1, maximum: 365 }, description: "Recently-bought window (days)" }],
        responses: { ...ok("Two-section list"), ...errorResponses },
      },
    },
  },
};

const fragments = [
  ["macros", macrosSpec],
  ["weight", weightSpec],
  ["shopping", shoppingSpec],
] as const;

mkdirSync("openapi", { recursive: true });
for (const [name, spec] of fragments) {
  writeFileSync(`openapi/${name}.json`, JSON.stringify(spec, null, 2) + "\n");
  console.log(`Generated openapi/${name}.json (${Object.keys(spec.paths).length} paths).`);
}
