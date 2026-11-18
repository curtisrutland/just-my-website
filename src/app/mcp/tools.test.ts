import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_SCOPES, type McpScope } from "@/lib/mcp/oauth";
import { MAX_RESULT_CHARS, NOT_FOUND, toResult } from "@/lib/mcp/tools";
import { mcpTestKit } from "./test-kit";

/**
 * Every MCP tool (`docs/mcp.md` §4), against the real database: it is listed, it answers in the
 * shape its API route answers in, it refuses a grant without its scope, and it says "not found"
 * rather than crashing.
 *
 * Tool calls read real tables. They ask for 1971, a fresh id or a single row, and only the SHAPE is
 * asserted: other suites write test rows into old dates while this one runs, and no real value is
 * ever printed or compared.
 */
const { connect, call, tool, cleanup } = mcpTestKit("test-mcp-tools");

afterAll(cleanup);

type Listed = { name: string; description: string; annotations: { readOnlyHint: boolean; openWorldHint: boolean }; inputSchema: { properties?: Record<string, unknown> } };

/** What each tool is, the scope it needs, a harmless call, and the keys its answer must have. */
const PAGE_KEYS = ["count", "items", "limit", "offset"];
const TOOLS: { name: string; scope: McpScope; args: Record<string, unknown>; keys?: string[]; skipCall?: string }[] = [
  { name: "macros_day", scope: "macros:read", args: { date: "1971-03-01" }, keys: ["day", "entries", "estimation", "target", "totals"] },
  { name: "macros_range", scope: "macros:read", args: { start: "1971-03-01", end: "1971-03-03" } },
  { name: "macros_entries", scope: "macros:read", args: { on: "1971-03-01", limit: 1 }, keys: PAGE_KEYS },
  { name: "macros_foods", scope: "macros:read", args: { limit: 1 }, keys: PAGE_KEYS },
  { name: "macros_batches", scope: "macros:read", args: { limit: 1 }, keys: PAGE_KEYS },
  { name: "macros_usda_search", scope: "macros:read", args: { q: "egg" }, skipCall: "it calls an outside service" },
  { name: "weight_rollup", scope: "weight:read", args: { window: 7, end: "1971-03-07" }, keys: ["series", "summary"] },
  { name: "weight_entries", scope: "weight:read", args: { limit: 1 }, keys: PAGE_KEYS },
  { name: "rides_list", scope: "rides:read", args: { from: "1971-03-01", to: "1971-03-02", limit: 1 }, keys: PAGE_KEYS },
  { name: "rides_detail", scope: "rides:read", args: { id: randomUUID() } },
  { name: "rides_weekly", scope: "rides:read", args: { weeks: 1 }, keys: ["weeks"] },
  { name: "lifting_sessions", scope: "lifting:read", args: { from: "1971-03-01", to: "1971-03-02", limit: 1 }, keys: ["count", "goal", "items", "limit", "offset"] },
  { name: "lifting_goal", scope: "lifting:read", args: { history: true, limit: 1 }, keys: PAGE_KEYS },
  { name: "lifting_lift", scope: "lifting:read", args: { templateId: "test-mcp-no-such-lift" }, keys: ["points", "templateId", "title"] },
  { name: "vitals_days", scope: "vitals:read", args: { from: "1971-03-01", to: "1971-03-02", limit: 1 }, keys: PAGE_KEYS },
  { name: "vitals_summary", scope: "vitals:read", args: { window: 7, end: "1971-03-07" } },
  { name: "shopping_list", scope: "shopping:read", args: {}, keys: ["active", "activeCount", "recentlyBought"] },
  { name: "shopping_items", scope: "shopping:read", args: { limit: 1 }, keys: PAGE_KEYS },
  { name: "garage_bikes", scope: "garage:read", args: { from: "1971-03-01", to: "1971-03-02" }, keys: ["items"] },
  { name: "garage_rides", scope: "garage:read", args: { from: "1971-03-01", to: "1971-03-02", limit: 1 }, keys: PAGE_KEYS },
];

let full: string;
let listed: Listed[];

beforeAll(async () => {
  full = (await connect()).access_token;
  listed = (await call(full, "tools/list")).body?.result?.tools as Listed[];
});

describe("the tool list", () => {
  it("is exactly the tools this file knows, all read-only", () => {
    expect(listed.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(listed.every((t) => t.annotations.readOnlyHint)).toBe(true);
    // Only the USDA search reaches outside the platform.
    expect(listed.filter((t) => t.annotations.openWorldHint).map((t) => t.name)).toEqual(["macros_usda_search"]);
  });

  it("no tool can write: nothing is named like a write, and every scope is a read scope", () => {
    expect(listed.filter((t) => /(create|add|log|set|update|patch|delete|remove|write)/.test(t.name))).toEqual([]);
    expect(MCP_SCOPES.every((scope) => scope.endsWith(":read"))).toBe(true);
    expect(new Set(TOOLS.map((t) => t.scope))).toEqual(new Set(MCP_SCOPES));
  });

  it("stays small enough to carry in every conversation", () => {
    // Every description is sent whenever the connector is on (#148). This is a budget, not a truth:
    // raise it on purpose, with a reason, not by accident.
    const size = JSON.stringify(listed).length;
    expect(size).toBeLessThan(22_000);
  });

  it("the descriptions say what a reader can't guess: units, what is summed, how to read zones", () => {
    // Each of these was misread, or flagged as easy to misread, by Claude on first use (#133).
    const about = new Map(listed.map((t) => [t.name, t.description]));
    const must: Record<string, string[]> = {
      macros_day: ["four headline macros", "sodium included", "not summed in `totals`", "counts only the `estimated` ones"],
      macros_foods: ["per 100 g"],
      macros_batches: ["per 100 g"],
      weight_rollup: ["in pounds", "least-squares slope", "depends on `window`"],
      weight_entries: ["in pounds"],
      rides_list: ["30 mph", "ask before", "`hrZoneHighBoundary` is the 6 upper limits", "metres per second"],
      rides_weekly: ["recorded drive"],
      lifting_sessions: ["kilograms"],
      lifting_lift: ["kilograms"],
      vitals_days: ["in seconds", "never zero"],
      garage_bikes: ["metres", "recorded drive"],
    };
    for (const [name, phrases] of Object.entries(must)) {
      for (const phrase of phrases) expect(about.get(name), `${name}: ${phrase}`).toContain(phrase);
    }
  });
});

describe("each tool answers in its route's shape", () => {
  for (const spec of TOOLS) {
    if (spec.skipCall) {
      it.skip(`${spec.name} (${spec.skipCall})`, () => {});
      continue;
    }
    if (spec.name === "rides_detail") continue; // a fresh id: covered under "not found"
    it(spec.name, async () => {
      const answer = await tool(full, spec.name, spec.args);
      expect(answer.isError, answer.text.slice(0, 200)).toBe(false);
      const data = JSON.parse(answer.text);
      if (spec.keys) expect(Object.keys(data).sort()).toEqual(spec.keys);
    });
  }

  it("macros_range: one row per day, both ends included", async () => {
    const rows = JSON.parse((await tool(full, "macros_range", { start: "1971-03-01", end: "1971-03-03" })).text);
    expect(rows.map((r: { date: string }) => r.date)).toEqual(["1971-03-01", "1971-03-02", "1971-03-03"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["date", "target", "totals"]);
  });

  it("vitals_summary: the three trends and the gaps", async () => {
    const rollup = JSON.parse((await tool(full, "vitals_summary", { window: 7, end: "1971-03-07" })).text);
    for (const key of ["restingHeartRate", "hrvLastNightMs", "sleepTotalSeconds", "gaps", "window"]) expect(rollup).toHaveProperty(key);
  });

  it("lifting_goal: the goal in force, or null", async () => {
    const goal = JSON.parse((await tool(full, "lifting_goal", { on: "1971-03-01" })).text);
    expect(goal === null || typeof goal.statement === "string").toBe(true);
  });

  it("pages default to 20 and never exceed what was asked", async () => {
    const page = JSON.parse((await tool(full, "weight_entries")).text);
    expect(page.limit).toBe(20);
    expect(page.items.length).toBeLessThanOrEqual(20);
    const one = JSON.parse((await tool(full, "weight_entries", { limit: 1 })).text);
    expect(one.items.length).toBeLessThanOrEqual(1);
  });
});

describe("refusals", () => {
  it("every tool refuses a grant that lacks its scope, and says how to fix it", async () => {
    for (const scope of MCP_SCOPES) {
      const others = MCP_SCOPES.filter((s) => s !== scope);
      const { access_token } = await connect([...others]);
      for (const spec of TOOLS.filter((t) => t.scope === scope)) {
        const answer = await tool(access_token, spec.name, spec.args);
        expect(answer.isError, spec.name).toBe(true);
        expect(answer.text).toContain(`not granted the ${scope} scope`);
        expect(answer.text).toContain("Reconnect");
      }
    }
  });

  it("a grant with one scope can run that module's tools and no other's", async () => {
    const { access_token } = await connect(["shopping:read"]);
    expect((await tool(access_token, "shopping_list")).isError).toBe(false);
    for (const spec of TOOLS.filter((t) => t.scope !== "shopping:read")) {
      expect((await tool(access_token, spec.name, spec.args)).isError, spec.name).toBe(true);
    }
  });

  it("an id or date that matches nothing is 'not found', for every tool that takes one", async () => {
    const missing = randomUUID();
    const lookups: [string, Record<string, unknown>][] = [
      ["macros_foods", { id: missing }],
      ["macros_batches", { id: missing }],
      ["weight_entries", { date: "1971-03-01" }],
      ["rides_detail", { id: missing }],
      ["rides_detail", { id: missing, stream: true }],
      ["lifting_sessions", { id: missing }],
      ["vitals_days", { date: "1971-03-01" }],
      ["shopping_items", { id: missing }],
      ["garage_bikes", { id: missing }],
    ];
    for (const [name, args] of lookups) {
      const answer = await tool(full, name, args);
      expect(answer.isError, name).toBe(true);
      expect(answer.text, name).toContain("Not found");
    }
  });

  it("a malformed argument is refused before any read", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["macros_day", { date: "yesterday" }],
      ["macros_range", { start: "1971-03-01" }],
      ["rides_list", { limit: 5000 }],
      ["rides_detail", { id: "not-a-uuid" }],
      ["rides_detail", {}],
      ["lifting_sessions", { from: "last week" }],
      ["lifting_sessions", { focus: "cardio" }],
      ["macros_batches", { status: "stale" }],
      ["weight_rollup", { window: 3 }],
      ["garage_rides", { bikeId: "123" }],
    ];
    for (const [name, args] of bad) {
      const answer = await tool(full, name, args);
      expect(answer.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
  });

  it("macros_range refuses a backwards or over-long range", async () => {
    const backwards = await tool(full, "macros_range", { start: "1971-03-02", end: "1971-03-01" });
    expect(backwards.isError).toBe(true);
    expect(backwards.text).toContain("on or before");
    const long = await tool(full, "macros_range", { start: "1971-01-01", end: "1972-06-01" });
    expect(long.isError).toBe(true);
    expect(long.text).toContain("366");
  });

  it("an unknown tool is an error, including the retired ping", async () => {
    const { body } = await call(full, "tools/call", { name: "ping", arguments: {} });
    expect(body?.error ?? body?.result?.isError).toBeTruthy();
  });
});

describe("toResult", () => {
  it("serialises data, and maps NOT_FOUND to a refusal", () => {
    expect(toResult({ a: 1 })).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
    expect(toResult(null)).toEqual({ content: [{ type: "text", text: "null" }] });
    expect(toResult(NOT_FOUND).isError).toBe(true);
  });

  it("refuses a result too large for the client instead of letting it be cut off", () => {
    const big = toResult({ blob: "x".repeat(MAX_RESULT_CHARS) });
    expect(big.isError).toBe(true);
    expect(big.content[0].text).toContain("too large");
    expect(toResult({ blob: "x".repeat(1000) }).isError).toBeUndefined();
  });
});
