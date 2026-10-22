import { mkdirSync, writeFileSync } from "node:fs";
import * as z from "zod";
import {
  batchCreateSchema,
  batchDetailViewSchema,
  batchPatchSchema,
  batchViewSchema,
  entryCreateBatchSchema,
  entryCreateSchema,
  entryPatchSchema,
  dayRollupSchema,
  entryViewSchema,
  foodCreateSchema,
  foodPatchSchema,
  macroSetSchema,
  targetProfileCreateSchema,
  targetProfilePatchSchema,
} from "../src/lib/macros/schema";
import {
  exerciseViewSchema,
  goalViewSchema,
  liftingAnnotationPatchSchema,
  liftingGoalCreateSchema,
  liftingGoalPatchSchema,
  liftProgressionSchema,
  prFlagSchema,
  sessionAnnotationSchema,
  sessionDerivedSchema,
  sessionDetailSchema,
  sessionSummarySchema,
  setViewSchema,
} from "../src/lib/lifting/schema";
import {
  rideDetailSchema,
  ridePatchSchema,
  rideStreamViewSchema,
  rideViewSchema,
  timeInHrZoneSchema,
  weeklyStatsSchema,
} from "../src/lib/rides/schema";
import {
  shoppingCreateSchema,
  shoppingItemRowSchema,
  shoppingItemViewSchema,
  shoppingListSchema,
  shoppingPatchSchema,
} from "../src/lib/shopping/schema";
import { vitalsDayViewSchema, vitalsIngestSchema, vitalsRollupSchema } from "../src/lib/vitals/schema";
import { weightCreateSchema, weightEntryViewSchema, weightPatchSchema, weightRollupSchema } from "../src/lib/weight/schema";

/**
 * Generate each module's OpenAPI fragment FROM its Zod schemas (CONVENTIONS: schema.ts is the single
 * source of truth; the spec is downstream). One fragment per module, mirroring the module anatomy.
 * Output is a build artifact (gitignored).
 */
const js = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" });

/**
 * Response views → named component schemas, from the Zod view schemas in each module's `schema.ts`
 * (#80). A registry turns every view that another view nests into a `$ref` instead of an inline
 * copy, so a generated client gets one named type per view (`EntryView`, not `DayRollup.entries`).
 * The response contract test (`src/lib/http/contract.test.ts`) holds the routes to these shapes.
 */
function views(named: Record<string, z.ZodType>): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(named)) registry.add(schema, { id });
  const { schemas } = z.toJSONSchema(registry, {
    target: "openapi-3.0",
    io: "input",
    uri: (id) => `#/components/schemas/${id}`,
  });
  // `$id` isn't an OpenAPI 3.0 schema keyword; the component's key already names it.
  return Object.fromEntries(Object.entries(schemas).map(([id, { $id: _id, ...schema }]) => [id, schema]));
}

const ERR = { $ref: "#/components/schemas/Error" };
const errorResponses = {
  "400": { description: "Validation or invalid JSON", content: { "application/json": { schema: ERR } } },
  "401": { description: "Missing/invalid token", content: { "application/json": { schema: ERR } } },
  "404": { description: "Not found", content: { "application/json": { schema: ERR } } },
};

const conflictResponse = {
  "409": { description: "Conflicts with resource state (e.g. drawing from a finished batch)", content: { "application/json": { schema: ERR } } },
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
const json = (ref: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } });
const okJson = (desc: string, ref: string) => ({ "200": { description: desc, content: json(ref) } });
const createdJson = (desc: string, ref: string) => ({ "201": { description: desc, content: json(ref) } });
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
  deviceToken: {
    type: "http",
    scheme: "bearer",
    description:
      "A DB-backed device token (the iOS app), checked against the scope the operation names ({module}:read or {module}:write). Accepted ONLY by the operations that list it (docs/ios-app.md §3.4); never for hard DELETE.",
  },
};
// The iOS app's allowlisted operations: either env token, or a device token holding the scope.
const deviceSecurity = [{ bearerAuth: [] }, { deviceToken: [] }];
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
    securitySchemes: {
      ...securitySchemes,
      displayToken: {
        type: "http",
        scheme: "bearer",
        description:
          "JMW_DISPLAY_TOKEN — the ESP32 round display's credential. Accepted ONLY by GET /api/macros/days/{date}; structurally rejected everywhere else (least privilege: it lives in firmware, so it can read one day's rollup and nothing more — no writes, no other read, no other module).",
      },
    },
    schemas: {
      FoodCreate: js(foodCreateSchema),
      FoodPatch: js(foodPatchSchema),
      EntryCreate: js(entryCreateSchema),
      EntryCreateBatch: js(entryCreateBatchSchema),
      EntryPatch: js(entryPatchSchema),
      // The canonical READ shape — identical for `GET /entries` items and the day-rollup entries.
      RangeDay: {
        type: "object",
        required: ["date", "totals", "target"],
        properties: {
          date: { type: "string", format: "date" },
          totals: { $ref: "#/components/schemas/MacroTotals" },
          target: { allOf: [{ $ref: "#/components/schemas/MacroTotals" }], nullable: true },
        },
      },
      BatchCreate: js(batchCreateSchema),
      BatchPatch: js(batchPatchSchema),
      // Read shapes: `status` is DERIVED from finishedOn (active/finished); the detail view adds
      // derived consumption (remainingGrams is ADVISORY — only logged draws deplete it).
      BatchView: js(batchViewSchema),
      BatchDetailView: js(batchDetailViewSchema),
      TargetProfileCreate: js(targetProfileCreateSchema),
      TargetProfilePatch: js(targetProfilePatchSchema),
      UsdaResolve: { type: "object", required: ["fdcId"], properties: { fdcId: { type: "integer", minimum: 1 } } },
      ...views({ EntryView: entryViewSchema, MacroTotals: macroSetSchema, DayRollup: dayRollupSchema }),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/macros/foods": {
      get: {
        summary: "Search foods / ingredients",
        description: "Fuzzy name match (q), optionally narrowed by category and/or brand. The brand+category pair is the dedupe cohort used before registering a new ingredient.",
        parameters: [
          ...pageParams,
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "brand", in: "query", schema: { type: "string" } },
        ],
        responses: { ...okList("FoodCreate"), ...errorResponses },
      },
      post: { summary: "Create a food / register an ingredient", requestBody: jsonBody("FoodCreate"), responses: { ...created("Created food"), ...errorResponses } },
    },
    "/api/macros/foods/{id}": {
      get: { summary: "Get a food", parameters: [pathParam("id")], responses: { ...ok("Food"), ...errorResponses } },
      patch: { summary: "Update a food", parameters: [pathParam("id")], requestBody: jsonBody("FoodPatch"), responses: { ...ok("Updated food"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a food", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/batches": {
      get: {
        summary: "Search batches (active-first, then newest-made)",
        description:
          "Fuzzy name match (q) + status filter (default all). Active-first ordering means the current generation of a name is always item one; older generations follow visibly finished — so one call answers 'is there a current taco chicken?'.",
        parameters: [
          ...pageParams,
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "finished", "all"], default: "all" } },
        ],
        responses: { ...okList("BatchView"), ...errorResponses },
      },
      post: {
        summary: "Register a cooked batch",
        description:
          "Never blocks on an active same-name batch — the response surfaces it under activeNameMatches so the caller can ask whether the old generation should be finished.",
        requestBody: jsonBody("BatchCreate"),
        responses: {
          "201": {
            description: "Created batch + any still-active same-name batches",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/BatchView" },
                    {
                      type: "object",
                      required: ["activeNameMatches"],
                      properties: { activeNameMatches: { type: "array", items: { $ref: "#/components/schemas/BatchView" } } },
                    },
                  ],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/api/macros/batches/{id}": {
      get: {
        summary: "Get a batch (+ derived consumedGrams / remainingGrams / drawCount)",
        parameters: [pathParam("id")],
        responses: {
          "200": { description: "Batch detail", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchDetailView" } } } },
          ...errorResponses,
        },
      },
      patch: {
        summary: "Correct a batch; finish = { finishedOn }, undo = { finishedOn: null }",
        parameters: [pathParam("id")],
        requestBody: jsonBody("BatchPatch"),
        responses: { ...ok("Updated batch"), ...errorResponses },
      },
      delete: { summary: "Soft/hard delete a batch (finished ≠ deleted; delete means 'should not exist')", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/entries": {
      get: { summary: "List entries", parameters: [...pageParams, { name: "on", in: "query", schema: { type: "string", format: "date" } }], responses: { ...okList("EntryView"), ...errorResponses } },
      post: {
        summary: "Log an entry",
        description: "May draw from a batch via batchId (XOR with foodId); a finished batch rejects entries dated after its finishedOn (409).",
        requestBody: jsonBody("EntryCreate"),
        responses: { ...created("Logged entry"), ...errorResponses, ...conflictResponse },
      },
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
          ...conflictResponse,
        },
      },
    },
    "/api/macros/entries/{id}": {
      get: { summary: "Get an entry", parameters: [pathParam("id")], responses: { ...ok("Entry"), ...errorResponses } },
      patch: { summary: "Correct an entry", parameters: [pathParam("id")], requestBody: jsonBody("EntryPatch"), responses: { ...ok("Updated entry"), ...errorResponses, ...conflictResponse } },
      delete: { summary: "Soft/hard delete an entry", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/target-profiles": {
      get: { summary: "List target profiles", parameters: [...pageParams], responses: { ...okList("TargetProfileCreate"), ...errorResponses } },
      post: { summary: "Create a target profile", requestBody: jsonBody("TargetProfileCreate"), responses: { ...created("Created profile"), ...errorResponses } },
    },
    "/api/macros/target-profiles/{id}": {
      patch: { summary: "Update a target profile", parameters: [pathParam("id")], requestBody: jsonBody("TargetProfilePatch"), responses: { ...ok("Updated profile"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a target profile", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/macros/days/{date}": {
      get: {
        summary: "Day rollup (totals, estimation, target, entries)",
        description: "The one macros route that also accepts the display token (the ESP32 round display), and a device token holding `macros:read` (the iOS app).",
        security: [{ bearerAuth: [] }, { displayToken: [] }, { deviceToken: [] }],
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
      ...views({ WeightEntryView: weightEntryViewSchema, WeightRollup: weightRollupSchema }),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/weight/entries": {
      get: { security: deviceSecurity, summary: "List weigh-ins", parameters: [...pageParams], responses: { ...okList("WeightEntryView"), ...errorResponses } },
      post: { security: deviceSecurity, summary: "Upsert a day's weight (one per day; re-logging replaces it)", requestBody: jsonBody("WeightCreate"), responses: { ...okJson("Weigh-in (created or replaced) + Location", "WeightEntryView"), ...errorResponses } },
    },
    "/api/weight/entries/{id}": {
      get: { summary: "Get a weigh-in", parameters: [pathParam("id")], responses: { ...okJson("Weigh-in", "WeightEntryView"), ...errorResponses } },
      patch: { summary: "Correct a weigh-in", parameters: [pathParam("id")], requestBody: jsonBody("WeightPatch"), responses: { ...okJson("Updated weigh-in", "WeightEntryView"), ...errorResponses } },
      delete: { summary: "Soft/hard delete a weigh-in", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/weight/days/{date}": {
      get: { security: deviceSecurity, summary: "Get a day's weigh-in", parameters: [pathParam("date")], responses: { ...okJson("Weigh-in", "WeightEntryView"), ...errorResponses } },
    },
    "/api/weight/rollup": {
      get: {
        security: deviceSecurity,
        summary: "Trend rollup: per-day series (raw + 7-day average) + summary stats",
        parameters: [
          { name: "window", in: "query", schema: { type: "integer", default: 90, minimum: 7, maximum: 3650 }, description: "Days back from `end`" },
          { name: "end", in: "query", schema: { type: "string", format: "date" }, description: "Last day of the window (default today)" },
        ],
        responses: { ...okJson("Rollup (series + summary)", "WeightRollup"), ...errorResponses },
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
      ...views({ ShoppingItemView: shoppingItemViewSchema, ShoppingItemRow: shoppingItemRowSchema, ShoppingList: shoppingListSchema }),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/shopping/items": {
      get: { summary: "List items", parameters: [...pageParams], responses: { ...okList("ShoppingItemRow"), ...errorResponses } },
      post: { security: deviceSecurity, summary: "Add an item", requestBody: jsonBody("ShoppingCreate"), responses: { ...createdJson("Created item", "ShoppingItemRow"), ...errorResponses } },
    },
    "/api/shopping/items/{id}": {
      get: { summary: "Get an item", parameters: [pathParam("id")], responses: { ...okJson("Item", "ShoppingItemRow"), ...errorResponses } },
      patch: { security: deviceSecurity, summary: "Edit or check/un-check an item", parameters: [pathParam("id")], requestBody: jsonBody("ShoppingPatch"), responses: { ...okJson("Updated item", "ShoppingItemRow"), ...errorResponses } },
      delete: { summary: "Soft/hard delete an item", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/shopping/list": {
      get: {
        security: deviceSecurity,
        summary: "The two-section list view (active grouped by category + recently bought + activeCount)",
        parameters: [{ name: "boughtWithinDays", in: "query", schema: { type: "integer", default: 7, minimum: 1, maximum: 365 }, description: "Recently-bought window (days)" }],
        responses: { ...okJson("Two-section list", "ShoppingList"), ...errorResponses },
      },
    },
  },
};

const liftingFocuses = ["push", "pull", "upper", "lower", "full", "accessory", "other"];

const liftingSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — lifting",
    version: "0.1.0",
    description:
      "Token API for the lifting module (the first ingestion module). Facts are ingested from Hevy and read-only; the only write is the annotation. Weights are canonical kg (display in whole lb). Generated from Zod schemas + the read types; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      ...securitySchemes,
      webhookSecret: { type: "http", scheme: "bearer", description: "HEVY_WEBHOOK_TOKEN — Hevy's configured Authorization header; NOT a JMW token (documented carve-out)" },
    },
    schemas: {
      // The surface writes: the per-session annotation, and the module-level goal statement.
      LiftingAnnotationPatch: js(liftingAnnotationPatchSchema),
      LiftingGoalCreate: js(liftingGoalCreateSchema),
      LiftingGoalPatch: js(liftingGoalPatchSchema),
      ...views({
        GoalView: goalViewSchema,
        PrFlag: prFlagSchema,
        SessionDerived: sessionDerivedSchema,
        SessionAnnotation: sessionAnnotationSchema,
        SetView: setViewSchema,
        ExerciseView: exerciseViewSchema,
        SessionSummary: sessionSummarySchema,
        SessionDetail: sessionDetailSchema,
        LiftProgression: liftProgressionSchema,
      }),
      // Read shapes (from src/lib/lifting/types.ts). Instants are ISO strings; weights canonical kg.
      Error: errorSchema,
    },
  },
  paths: {
    "/api/lifting/sessions": {
      get: {
        security: deviceSecurity,
        summary: "List sessions (the journal)",
        description: "Paginated session summaries, newest first. Filter by interpreted state, focus, and a startedAt range.",
        parameters: [
          ...pageParams,
          { name: "interpreted", in: "query", schema: { type: "boolean" }, description: "true = has a Claude read; false = the un-interpreted queue" },
          { name: "focus", in: "query", schema: { type: "string", enum: liftingFocuses } },
          { name: "from", in: "query", schema: { type: "string" }, description: "inclusive lower bound on startedAt (ISO date or datetime)" },
          { name: "to", in: "query", schema: { type: "string" }, description: "inclusive upper bound on startedAt (ISO date or datetime)" },
        ],
        responses: {
          "200": {
            description: "Paginated list, plus the current goal statement on the envelope",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "limit", "offset", "count", "goal"],
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/SessionSummary" } },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    count: { type: "integer" },
                    goal: { allOf: [{ $ref: "#/components/schemas/GoalView" }], nullable: true, description: "the goal in force TODAY — the frame these sessions are read against" },
                  },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/api/lifting/sessions/{id}": {
      get: {
        security: deviceSecurity,
        summary: "Get a full session (exercises + sets + derived + annotation)",
        parameters: [pathParam("id")],
        responses: { "200": { description: "Session detail", content: { "application/json": { schema: { $ref: "#/components/schemas/SessionDetail" } } } }, ...errorResponses },
      },
      patch: {
        summary: "Write the annotation (the only session write)",
        description: "session_notes/quality are Curtis's; interpretation/focus are Claude's. Returns the full session (get-after-write).",
        parameters: [pathParam("id")],
        requestBody: jsonBody("LiftingAnnotationPatch"),
        responses: { "200": { description: "Updated session", content: { "application/json": { schema: { $ref: "#/components/schemas/SessionDetail" } } } }, ...errorResponses },
      },
      delete: { summary: "Soft/hard delete a session (hard requires the primary key; cascades to children + note)", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/lifting/lifts/{templateId}": {
      get: {
        security: deviceSecurity,
        summary: "Progression series for one lift identity (best e1RM + top-set per session)",
        parameters: [pathParam("templateId")],
        responses: { "200": { description: "Progression", content: { "application/json": { schema: { $ref: "#/components/schemas/LiftProgression" } } } }, ...errorResponses },
      },
    },
    "/api/lifting/goal": {
      get: {
        summary: "The goal statement in force today (or on ?on=YYYY-MM-DD)",
        description: "What the training is FOR right now — the frame every session read is judged against. The same goal rides along on the session reads themselves. Returns null if no goal has been set.",
        parameters: [{ name: "on", in: "query", schema: { type: "string", format: "date" }, description: "resolve the goal in force on this calendar date (default today)" }],
        responses: { "200": { description: "The current goal, or null", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/GoalView" }], nullable: true } } } }, ...errorResponses },
      },
      post: {
        summary: "Set the goal statement",
        description: "One live goal per effectiveFrom date (default today), so this is an upsert on that date: restating today's goal rewords it; a new date supersedes without touching history. 200 + Location (set/replace, not fresh creation — CONVENTIONS §7).",
        requestBody: jsonBody("LiftingGoalCreate"),
        responses: { "200": { description: "The persisted goal", content: { "application/json": { schema: { $ref: "#/components/schemas/GoalView" } } } }, ...errorResponses },
      },
    },
    "/api/lifting/goals": {
      get: {
        summary: "Goal history, newest first",
        description: "Superseded goals are kept, so an old read stays legible against the goal that actually applied when it was written.",
        parameters: [...pageParams],
        responses: { ...okList("GoalView"), ...errorResponses },
      },
    },
    "/api/lifting/goals/{id}": {
      patch: {
        summary: "Edit one dated goal in place (reword it, or correct when it started)",
        parameters: [pathParam("id")],
        requestBody: jsonBody("LiftingGoalPatch"),
        responses: { "200": { description: "Updated goal", content: { "application/json": { schema: { $ref: "#/components/schemas/GoalView" } } } }, ...errorResponses },
      },
      delete: { summary: "Soft/hard delete a goal (hard requires the primary key)", parameters: [pathParam("id"), hardParam], responses: { ...noContent, ...errorResponses } },
    },
    "/api/lifting/pull": {
      post: {
        summary: "Catch-up pull from Hevy (recover a missed webhook / initial backfill)",
        description: "Pages GET /v1/workouts and ingests missing/updated workouts, idempotently.",
        parameters: [{ name: "pages", in: "query", schema: { type: "integer", default: 1, minimum: 1, maximum: 1000 }, description: "How many Hevy pages to sweep (backfill passes a large number)" }],
        responses: { ...ok("Pull summary: { scanned, ingested, pages }"), ...errorResponses },
      },
    },
    "/api/lifting/webhook": {
      post: {
        summary: "Hevy webhook trigger (dedicated secret, not a JMW token)",
        description: "THE documented kernel carve-out: authenticates with HEVY_WEBHOOK_TOKEN. Write-only, never a read. The body { workoutId } is a trigger; the full workout is pulled server-side.",
        security: [{ webhookSecret: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["workoutId"], properties: { workoutId: { type: "string" } } } } } },
        responses: {
          "200": { description: "Ingested { ok, sessionId, hevyId }" },
          "401": { description: "Invalid webhook token", content: { "application/json": { schema: ERR } } },
        },
      },
    },
  },
};

const ridesSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — rides",
    version: "0.1.0",
    description:
      "Token API for the rides module (the second ingestion module; the first with a binary input). Garmin FIT activities are uploaded, parsed once, and become the record of what was ridden. Every parsed field is an ingested fact — immutable from the surfaces; only name/note are writable. All quantities are SI (m, s, m/s, W, bpm, kcal, °C); display units are a client concern. Generated from Zod schemas + the read types; do not hand-edit.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      ...securitySchemes,
      publisherToken: {
        type: "http",
        scheme: "bearer",
        description:
          "JMW_PUBLISHER_TOKEN — the upload daemon's credential. Accepted ONLY by POST /api/rides/upload; structurally rejected everywhere else (least privilege: it can push FIT files and nothing more).",
      },
    },
    schemas: {
      RidePatch: js(ridePatchSchema),
      ...views({
        TimeInHrZone: timeInHrZoneSchema,
        RideView: rideViewSchema,
        RideStream: rideStreamViewSchema,
        RideDetail: rideDetailSchema,
        WeeklyStats: weeklyStatsSchema,
      }),
      IngestResult: {
        allOf: [
          { $ref: "#/components/schemas/RideView" },
          {
            type: "object",
            required: ["deduped"],
            properties: {
              deduped: { type: "boolean", description: "true = this file (or the same activity from the same device) was already ingested; the existing ride is returned. Normal, not an error — the daemon re-sends files forever." },
            },
          },
        ],
      },
      Error: errorSchema,
    },
  },
  paths: {
    "/api/rides/upload": {
      post: {
        summary: "Ingest a FIT file (raw binary body)",
        description:
          "Body is the raw FIT bytes (application/octet-stream) — `curl --data-binary @ride.fit`. Idempotent: known bytes (or the same activity re-exported) return 200 + the existing ride with deduped:true; a new ride returns 201 + Location. Undecodable or multi-session files are 400s. The ONLY route that accepts the publisher token.",
        security: [{ bearerAuth: [] }, { publisherToken: [] }],
        requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "201": { description: "New ride ingested", content: { "application/json": { schema: { $ref: "#/components/schemas/IngestResult" } } } },
          "200": { description: "Dedupe hit — the existing ride, deduped:true", content: { "application/json": { schema: { $ref: "#/components/schemas/IngestResult" } } } },
          "400": { description: "Not a FIT file / integrity failure / multi-session / oversized", content: { "application/json": { schema: ERR } } },
          "401": { description: "Missing/invalid token", content: { "application/json": { schema: ERR } } },
        },
      },
    },
    "/api/rides": {
      get: {
        security: deviceSecurity,
        summary: "List rides (the log)",
        description: "Summaries only (never streams), newest startedAt first. There is no POST here — rides are never authored, only ingested.",
        parameters: [
          ...pageParams,
          { name: "sport", in: "query", schema: { type: "string" }, description: "Garmin sport string verbatim (e.g. cycling)" },
          { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "inclusive lower bound on localDate" },
          { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "inclusive upper bound on localDate" },
          { name: "q", in: "query", schema: { type: "string" }, description: "substring on name OR sportProfileName (unnamed rides are the norm; \"MTB\" finds them)" },
        ],
        responses: { ...okList("RideView"), ...errorResponses },
      },
    },
    "/api/rides/{id}": {
      get: {
        security: deviceSecurity,
        summary: "Get one ride",
        parameters: [pathParam("id"), { name: "streams", in: "query", schema: { type: "string", enum: ["1"] }, description: "include the downsampled stream arrays (heavy; off by default)" }],
        responses: { "200": { description: "Ride detail", content: { "application/json": { schema: { $ref: "#/components/schemas/RideDetail" } } } }, ...errorResponses },
      },
      patch: {
        summary: "Write the human layer (name/note — the ONLY writable fields)",
        description: "Every measured field is immutable from the surfaces; corrections happen via reprocess. Unknown fields are 400s by design.",
        parameters: [pathParam("id")],
        requestBody: jsonBody("RidePatch"),
        responses: { "200": { description: "Updated ride", content: { "application/json": { schema: { $ref: "#/components/schemas/RideView" } } } }, ...errorResponses },
      },
      delete: {
        summary: "Soft/hard delete (hard requires the primary key and also removes the raw file from Blob)",
        parameters: [pathParam("id"), hardParam],
        responses: { ...noContent, ...errorResponses },
      },
    },
    "/api/rides/{id}/reprocess": {
      post: {
        summary: "Re-decode the stored raw FIT and rewrite the facts in place",
        description: "The corrections/back-fill lever: fact columns + stream are rebuilt from a fresh decode of the SAME raw file; name/note untouched. Normal JMW tokens only (not the publisher token).",
        parameters: [pathParam("id")],
        responses: {
          "200": { description: "Reprocessed ride", content: { "application/json": { schema: { $ref: "#/components/schemas/RideDetail" } } } },
          ...errorResponses,
          "409": { description: "Raw file missing from storage, or no longer decodes", content: { "application/json": { schema: ERR } } },
        },
      },
    },
    "/api/rides/weekly": {
      get: {
        security: deviceSecurity,
        summary: "Weekly rollup (per ISO week: rides / distance / moving time / ascent / avg power)",
        parameters: [
          { name: "weeks", in: "query", schema: { type: "integer", default: 8, minimum: 1, maximum: 104 }, description: "max buckets returned, newest first" },
          { name: "sport", in: "query", schema: { type: "string", default: "cycling" }, description: "defaults to cycling (rides-first); pass 'all' for every activity" },
        ],
        responses: { "200": { description: "Weekly stats", content: { "application/json": { schema: { $ref: "#/components/schemas/WeeklyStats" } } } }, ...errorResponses },
      },
    },
  },
};

const vitalsSpec = {
  openapi: "3.0.3",
  info: {
    title: "justmy.website — vitals",
    version: "0.1.0",
    description:
      "Token API for the vitals module (daily Garmin measurements). Generated from Zod schemas; do not hand-edit. " +
      "Principle: MEASUREMENTS, NOT VERDICTS — no readiness score, Body Battery, stress, VO2max, FTP or sleep grade " +
      "is modelled here; they survive only inside the write-only rawPayload archive. " +
      "There is no human write path and therefore no PATCH: the sole writer is the Garmin daemon, and a wrong value " +
      "is corrected by reprocessing the stored payload.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      ...securitySchemes,
      publisherToken: {
        type: "http",
        scheme: "bearer",
        description:
          "JMW_PUBLISHER_TOKEN — the Garmin daemon's scoped credential. Accepted by exactly two routes across the " +
          "whole API (POST /api/vitals and POST /api/rides/upload) and by nothing else: it can never read, PATCH, or DELETE.",
      },
    },
    schemas: {
      VitalsIngest: js(vitalsIngestSchema),
      ...views({ VitalsDayView: vitalsDayViewSchema, VitalsRollup: vitalsRollupSchema }),
      Error: errorSchema,
    },
  },
  paths: {
    "/api/vitals": {
      get: {
        security: deviceSecurity,
        summary: "List days of measurements (same shape as the detail read)",
        parameters: [
          ...pageParams,
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { ...okList("VitalsDayView"), ...errorResponses },
      },
      post: {
        summary: "Push one day of Garmin measurements (upsert; the daemon re-polls a trailing window)",
        description:
          "Body carries Garmin's responses VERBATIM; the server normalizes, validates, then upserts. 201 the first " +
          "time a day is seen, 200 on every later re-push — re-pushing is the normal case, not an error.",
        security: [{ publisherToken: [] }, { bearerAuth: [] }],
        requestBody: jsonBody("VitalsIngest"),
        responses: { ...created("Day created"), ...ok("Day replaced"), ...errorResponses },
      },
    },
    "/api/vitals/{date}": {
      get: { security: deviceSecurity, summary: "Get one day", parameters: [pathParam("date")], responses: { ...okJson("Day of measurements", "VitalsDayView"), ...errorResponses } },
      delete: {
        summary: "Soft/hard delete a day (the daemon's next poll can re-create it)",
        parameters: [pathParam("date"), hardParam],
        responses: { ...noContent, ...errorResponses },
      },
    },
    "/api/vitals/{date}/reprocess": {
      post: {
        summary: "Re-derive a day's columns from its stored rawPayload",
        description: "The correction lever, mirroring rides: re-parse the archive rather than re-poll Garmin or hand-edit.",
        parameters: [pathParam("date")],
        responses: { ...okJson("Reprocessed day", "VitalsDayView"), ...errorResponses },
      },
    },
    "/api/vitals/summary": {
      get: {
        security: deviceSecurity,
        summary: "Derived rollup: 7-day trailing averages, week-over-week deltas, and the gap list",
        parameters: [
          { name: "window", in: "query", schema: { type: "integer", default: 30, minimum: 1, maximum: 365 }, description: "Days back from `end`" },
          { name: "end", in: "query", schema: { type: "string", format: "date" }, description: "Last day of the window (default the latest day)" },
        ],
        responses: { ...okJson("Rollup (trends + gaps)", "VitalsRollup"), ...errorResponses },
      },
    },
  },
};

const fragments = [
  ["macros", macrosSpec],
  ["weight", weightSpec],
  ["shopping", shoppingSpec],
  ["lifting", liftingSpec],
  ["rides", ridesSpec],
  ["vitals", vitalsSpec],
] as const;

mkdirSync("openapi", { recursive: true });
for (const [name, spec] of fragments) {
  writeFileSync(`openapi/${name}.json`, JSON.stringify(spec, null, 2) + "\n");
  console.log(`Generated openapi/${name}.json (${Object.keys(spec.paths).length} paths).`);
}
