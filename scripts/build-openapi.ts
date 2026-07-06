import { mkdirSync, writeFileSync } from "node:fs";
import * as z from "zod";
import {
  dayTagCreateSchema,
  entryCreateSchema,
  entryPatchSchema,
  foodCreateSchema,
  foodPatchSchema,
  targetProfileCreateSchema,
  targetProfilePatchSchema,
} from "../src/lib/macros/schema";

/**
 * Generate the macros module's OpenAPI fragment FROM the Zod schemas (CONVENTIONS: schema.ts is the
 * single source of truth; the spec is downstream). Output is a build artifact (gitignored).
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

const spec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — macros",
    version: "0.1.0",
    description: "Token API for the macro module. Generated from Zod schemas; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "JMW_API_KEY or JMW_AGENT_TOKEN" },
      primaryKey: { type: "http", scheme: "bearer", description: "JMW_API_KEY only — required for hard DELETE" },
    },
    schemas: {
      FoodCreate: js(foodCreateSchema),
      FoodPatch: js(foodPatchSchema),
      EntryCreate: js(entryCreateSchema),
      EntryPatch: js(entryPatchSchema),
      DayTagCreate: js(dayTagCreateSchema),
      TargetProfileCreate: js(targetProfileCreateSchema),
      TargetProfilePatch: js(targetProfilePatchSchema),
      UsdaResolve: { type: "object", required: ["fdcId"], properties: { fdcId: { type: "integer", minimum: 1 } } },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object" } },
          },
        },
      },
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
      get: { summary: "List entries", parameters: [...pageParams, { name: "on", in: "query", schema: { type: "string", format: "date" } }], responses: { ...okList("EntryCreate"), ...errorResponses } },
      post: { summary: "Log an entry", requestBody: jsonBody("EntryCreate"), responses: { ...created("Logged entry"), ...errorResponses } },
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
      get: { summary: "Day rollup (totals, estimation, target(s), entries)", parameters: [pathParam("date")], responses: { ...ok("Day rollup"), ...errorResponses } },
    },
    "/api/macros/usda/search": {
      get: { summary: "Search USDA FoodData Central", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { ...ok("Search hits"), ...errorResponses } },
    },
    "/api/macros/usda/resolve": {
      post: { summary: "Resolve + cache a USDA food", requestBody: jsonBody("UsdaResolve"), responses: { ...ok("Cached food"), ...errorResponses } },
    },
  },
};

mkdirSync("openapi", { recursive: true });
writeFileSync("openapi/macros.json", JSON.stringify(spec, null, 2) + "\n");
console.log(`Generated openapi/macros.json (${Object.keys(spec.paths).length} paths).`);
