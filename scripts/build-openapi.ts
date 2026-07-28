import { mkdirSync, writeFileSync } from "node:fs";
import * as z from "zod";
import {
  batchCreateSchema,
  batchDetailViewSchema,
  batchPatchSchema,
  batchViewSchema,
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
import { liftingAnnotationPatchSchema, liftingGoalCreateSchema, liftingGoalPatchSchema } from "../src/lib/lifting/schema";
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
      BatchCreate: js(batchCreateSchema),
      BatchPatch: js(batchPatchSchema),
      // Read shapes: `status` is DERIVED from finishedOn (active/finished); the detail view adds
      // derived consumption (remainingGrams is ADVISORY — only logged draws deplete it).
      BatchView: js(batchViewSchema),
      BatchDetailView: js(batchDetailViewSchema),
      DayTagCreate: js(dayTagCreateSchema),
      TargetProfileCreate: js(targetProfileCreateSchema),
      TargetProfilePatch: js(targetProfilePatchSchema),
      UsdaResolve: { type: "object", required: ["fdcId"], properties: { fdcId: { type: "integer", minimum: 1 } } },
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
      GoalView: {
        type: "object",
        required: ["id", "effectiveFrom", "statement"],
        properties: {
          id: { type: "string", format: "uuid" },
          effectiveFrom: { type: "string", format: "date", description: "calendar date the goal takes effect; the goal in force on any date is the latest effectiveFrom on/before it" },
          statement: { type: "string", description: "freeform prose — what the training is for. Deliberately unstructured." },
        },
      },
      // Read shapes (from src/lib/lifting/types.ts). Instants are ISO strings; weights canonical kg.
      PrFlag: {
        type: "object",
        required: ["lift", "templateId", "kind", "value"],
        properties: {
          lift: { type: "string" },
          templateId: { type: "string", nullable: true },
          kind: { type: "string", enum: ["weight", "e1rm"] },
          value: { type: "number", description: "kg (display in whole lb)" },
        },
      },
      SessionDerived: {
        type: "object",
        required: ["tonnageKg", "workingSets", "totalReps", "exerciseCount", "topE1rmKg", "durationMin", "prs"],
        properties: {
          tonnageKg: { type: "number" },
          workingSets: { type: "integer" },
          totalReps: { type: "integer" },
          exerciseCount: { type: "integer" },
          topE1rmKg: { type: "number", nullable: true },
          durationMin: { type: "integer", nullable: true },
          prs: { type: "array", items: { $ref: "#/components/schemas/PrFlag" } },
        },
      },
      SessionAnnotation: {
        type: "object",
        required: ["sessionNotes", "quality", "focus", "interpretation", "interpreted"],
        properties: {
          sessionNotes: { type: "string", nullable: true },
          quality: { type: "integer", nullable: true, minimum: 1, maximum: 5 },
          focus: { type: "string", nullable: true, enum: liftingFocuses },
          interpretation: { type: "string", nullable: true },
          interpreted: { type: "boolean", description: "interpretedAt is set" },
        },
      },
      SetView: {
        type: "object",
        required: ["index", "setType", "weightKg", "reps", "rpe", "distanceMeters", "durationSeconds", "pr"],
        properties: {
          index: { type: "integer" },
          setType: { type: "string", enum: ["normal", "warmup", "failure", "dropset"] },
          weightKg: { type: "number", nullable: true },
          reps: { type: "integer", nullable: true },
          rpe: { type: "number", nullable: true, description: "unused in practice (always null)" },
          distanceMeters: { type: "number", nullable: true },
          durationSeconds: { type: "integer", nullable: true },
          pr: { type: "boolean", description: "this set achieved a PR (weight or e1RM) for its lift" },
        },
      },
      ExerciseView: {
        type: "object",
        required: ["index", "title", "exerciseTemplateId", "notes", "supersetGroup", "e1rmKg", "e1rmUnreliable", "sets"],
        properties: {
          index: { type: "integer" },
          title: { type: "string" },
          exerciseTemplateId: { type: "string", nullable: true, description: "Hevy's stable lift id — threads a lift across sessions" },
          notes: { type: "string", nullable: true },
          supersetGroup: { type: "integer", nullable: true },
          e1rmKg: { type: "number", nullable: true, description: "best Epley e1RM over working sets" },
          e1rmUnreliable: { type: "boolean", description: "best set is >12 reps — estimate degrades" },
          sets: { type: "array", items: { $ref: "#/components/schemas/SetView" } },
        },
      },
      SessionSummary: {
        type: "object",
        required: ["id", "hevyId", "title", "startedAt", "endedAt", "description", "derived", "annotation"],
        properties: {
          id: { type: "string", format: "uuid" },
          hevyId: { type: "string" },
          title: { type: "string", nullable: true },
          startedAt: { type: "string", format: "date-time" },
          endedAt: { type: "string", format: "date-time", nullable: true },
          description: { type: "string", nullable: true, description: "Hevy's own workout note (distinct from sessionNotes)" },
          derived: { $ref: "#/components/schemas/SessionDerived" },
          annotation: { $ref: "#/components/schemas/SessionAnnotation" },
        },
      },
      SessionDetail: {
        allOf: [
          { $ref: "#/components/schemas/SessionSummary" },
          {
            type: "object",
            required: ["exercises", "goal"],
            properties: {
              exercises: { type: "array", items: { $ref: "#/components/schemas/ExerciseView" } },
              goal: { allOf: [{ $ref: "#/components/schemas/GoalView" }], nullable: true, description: "the goal in force ON THIS SESSION'S DATE (not necessarily today's) — read it before interpreting" },
            },
          },
        ],
      },
      LiftProgression: {
        type: "object",
        required: ["templateId", "title", "points"],
        properties: {
          templateId: { type: "string" },
          title: { type: "string", nullable: true },
          points: {
            type: "array",
            items: {
              type: "object",
              required: ["sessionId", "startedAt", "e1rmKg", "topSetKg"],
              properties: {
                sessionId: { type: "string", format: "uuid" },
                startedAt: { type: "string", format: "date-time" },
                e1rmKg: { type: "number", nullable: true },
                topSetKg: { type: "number", nullable: true },
              },
            },
          },
        },
      },
      Error: errorSchema,
    },
  },
  paths: {
    "/api/lifting/sessions": {
      get: {
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

const fragments = [
  ["macros", macrosSpec],
  ["weight", weightSpec],
  ["shopping", shoppingSpec],
  ["lifting", liftingSpec],
] as const;

mkdirSync("openapi", { recursive: true });
for (const [name, spec] of fragments) {
  writeFileSync(`openapi/${name}.json`, JSON.stringify(spec, null, 2) + "\n");
  console.log(`Generated openapi/${name}.json (${Object.keys(spec.paths).length} paths).`);
}
