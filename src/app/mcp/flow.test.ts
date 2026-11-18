import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { GET as weightRollupApi } from "@/app/api/weight/rollup/route";
import { POST as tokenEndpoint } from "@/app/oauth/token/route";
import { createDeviceToken } from "@/lib/auth/device-tokens";
import { db } from "@/lib/db";
import { deviceToken, oauthGrant } from "@/lib/db/schema";
import { createAuthorization, findGrantByAccessToken, listGrants, refreshGrant, revokeGrant } from "@/lib/mcp/grants";
import { MCP_SCOPES, s256, type McpScope } from "@/lib/mcp/oauth";
import { NextRequest } from "next/server";
import { POST as mcp } from "./route";

/**
 * The MCP sign-in end to end (`docs/mcp.md`), against the real database: an approval becomes a code,
 * the code becomes tokens, the access token opens `/mcp` and nothing else, and every way a grant
 * can end actually ends it. Integration, like the other auth tests: rows are named `test-mcp…` and
 * removed afterwards. The consent page itself (Clerk) is not exercised; `createAuthorization` is
 * what its action calls after the session check.
 *
 * Tool calls read real tables, so they ask for 1971: the shape is asserted, no real data is read.
 */
const CLIENT = "test-mcp-flow";
const REDIRECT = "http://localhost:1/callback";
const RESOURCE = "https://example.test/mcp";
const VERIFIER = "v".repeat(64);

afterAll(async () => {
  await db.delete(oauthGrant).where(like(oauthGrant.clientId, "test-mcp%"));
  await db.delete(deviceToken).where(like(deviceToken.name, "test-mcp%"));
});

const approve = (scopes: McpScope[] = [...MCP_SCOPES], now?: Date) =>
  createAuthorization({ clientId: CLIENT, redirectUri: REDIRECT, state: "s", codeChallenge: s256(VERIFIER), scopes, resource: RESOURCE }, now);

const token = (fields: Record<string, string>) =>
  tokenEndpoint(
    new Request("https://example.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    })
  );

const redeem = (code: string, over: Record<string, string> = {}) =>
  token({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: CLIENT, redirect_uri: REDIRECT, resource: RESOURCE, ...over });

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

/** An approved, redeemed grant: the state a connected client is in. */
async function connect(scopes?: McpScope[]): Promise<Tokens & { id: string }> {
  const { id, code } = await approve(scopes);
  const response = await redeem(code);
  expect(response.status).toBe(200);
  return { id, ...((await response.json()) as Tokens) };
}

type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: string } };

async function call(bearer: string | undefined, method: string, params?: unknown): Promise<{ status: number; body: Rpc | null }> {
  const response = await mcp(
    new Request(RESOURCE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    })
  );
  if (response.status !== 200) return { status: response.status, body: null };
  const text = await response.text();
  const data = text.split("\n").filter((line) => line.startsWith("data:"));
  return { status: 200, body: JSON.parse(data.length ? data[data.length - 1].slice(5) : text) };
}

async function tool(bearer: string, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await call(bearer, "tools/call", { name, arguments: args });
  expect(status).toBe(200);
  const result = body?.result as { isError?: boolean; content: { type: string; text: string }[] };
  return { isError: Boolean(result.isError), text: result.content[0].text };
}

const invalidGrant = async (response: Response) => {
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_grant");
};

describe("code → tokens", () => {
  it("a code is redeemed once for a bearer pair, and the response is never cacheable", async () => {
    const { code } = await approve(["weight:read"]);
    const response = await redeem(code);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Tokens;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "weight:read" });
    expect(body.access_token).toMatch(/^jmwa_/);
    expect(body.refresh_token).toMatch(/^jmwr_/);
  });

  it("only hashes are stored", async () => {
    const { id, code } = await approve();
    const tokens = (await (await redeem(code)).json()) as Tokens;
    const [row] = await db.select().from(oauthGrant).where(eq(oauthGrant.id, id));
    const stored = JSON.stringify(row);
    for (const secret of [code, tokens.access_token, tokens.refresh_token]) expect(stored).not.toContain(secret);
  });

  it("refused: wrong verifier, wrong client, wrong redirect, wrong resource, unknown code", async () => {
    const { code } = await approve();
    await invalidGrant(await redeem(code, { code_verifier: "x".repeat(64) }));
    await invalidGrant(await redeem(code, { client_id: "test-mcp-other" }));
    await invalidGrant(await redeem(code, { redirect_uri: "http://localhost:2/callback" }));
    await invalidGrant(await redeem(code, { resource: "https://example.test/api" }));
    await invalidGrant(await redeem("jmwc_" + "0".repeat(43)));
    // None of those spent the code: the right request still works.
    expect((await redeem(code)).status).toBe(200);
  });

  it("refused: an expired code", async () => {
    const { code } = await approve(undefined, new Date(Date.now() - 10 * 60_000));
    await invalidGrant(await redeem(code));
  });

  it("a code used twice is refused and takes its grant down with it", async () => {
    const { code } = await approve();
    const first = (await (await redeem(code)).json()) as Tokens;
    expect((await call(first.access_token, "tools/list")).status).toBe(200);
    await invalidGrant(await redeem(code));
    expect((await call(first.access_token, "tools/list")).status).toBe(401);
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT }));
  });
});

describe("what a grant opens", () => {
  it("lists the three read tools and runs each", async () => {
    const { access_token } = await connect();
    const listed = await call(access_token, "tools/list");
    const tools = listed.body?.result?.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["macros_day", "rides_list", "weight_rollup"]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);

    // Shapes only: other suites write test rows into old dates while this one runs.
    const day = await tool(access_token, "macros_day", { date: "1971-03-01" });
    expect(day.isError).toBe(false);
    const rollupDay = JSON.parse(day.text);
    expect(rollupDay.day).toEqual({ date: "1971-03-01" });
    expect(Object.keys(rollupDay).sort()).toEqual(["day", "entries", "estimation", "target", "totals"]);
    expect(Array.isArray(rollupDay.entries)).toBe(true);

    const weight = await tool(access_token, "weight_rollup", { window: 7, end: "1971-03-07" });
    expect(weight.isError).toBe(false);
    const rollup = JSON.parse(weight.text);
    expect(Object.keys(rollup).sort()).toEqual(["series", "summary"]);
    expect(rollup.summary.window).toBe(7);
    expect(Array.isArray(rollup.series)).toBe(true);

    const rides = await tool(access_token, "rides_list", { from: "1971-03-01", to: "1971-03-02", limit: 5 });
    expect(rides.isError).toBe(false);
    expect(JSON.parse(rides.text)).toMatchObject({ limit: 5, offset: 0, count: expect.any(Number), items: expect.any(Array) });
  });

  it("the descriptions say what a reader can't guess: units, what is summed, how to read zones", async () => {
    // Each of these was misread, or flagged as easy to misread, by Claude on first use (#133).
    const { access_token } = await connect();
    const listed = await call(access_token, "tools/list");
    const about = new Map((listed.body?.result?.tools as { name: string; description: string }[]).map((t) => [t.name, t.description]));
    for (const phrase of ["four headline macros", "sodium included", "not summed in `totals`", "counts only the `estimated` ones"]) {
      expect(about.get("macros_day"), phrase).toContain(phrase);
    }
    for (const phrase of ["in pounds", "least-squares slope", "depends on `window`"]) {
      expect(about.get("weight_rollup"), phrase).toContain(phrase);
    }
    for (const phrase of ["30 mph", "ask before", "`hrZoneHighBoundary` is the 6 upper limits", "metres per second"]) {
      expect(about.get("rides_list"), phrase).toContain(phrase);
    }
  });

  it("a bad argument is an error result, not a crash", async () => {
    const { access_token } = await connect();
    expect((await tool(access_token, "macros_day", { date: "yesterday" })).isError).toBe(true);
    expect((await tool(access_token, "rides_list", { limit: 5000 })).isError).toBe(true);
  });

  it("a tool outside the grant's scopes is refused", async () => {
    const { access_token } = await connect(["weight:read"]);
    const refused = await tool(access_token, "macros_day", { date: "1971-03-01" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("macros:read");
    expect(refused.text).not.toContain("entries");
    expect((await tool(access_token, "rides_list", {})).isError).toBe(true);
    expect((await tool(access_token, "weight_rollup", { window: 7, end: "1971-03-07" })).isError).toBe(false);
  });

  it("the official client connects with the token, on the newest protocol", async () => {
    const { access_token } = await connect();
    const viaRoute: typeof fetch = (input, init) => mcp(new Request(input as RequestInfo, init));
    const client = new Client({ name: "test-mcp-client", version: "0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(RESOURCE), { fetch: viaRoute, requestInit: { headers: { Authorization: `Bearer ${access_token}` } } })
    );
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["macros_day", "rides_list", "weight_rollup"]);
    const result = await client.callTool({ name: "weight_rollup", arguments: { window: 7, end: "1971-03-07" } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("a change-notification stream is refused, and the tools still answer", async () => {
    // docs/mcp.md §5: an open stream pins a function for 300 seconds, and the tool list never changes.
    const { access_token } = await connect(["weight:read"]);
    const kinds: string[] = [];
    const viaRoute: typeof fetch = async (input, init) => {
      const response = await mcp(new Request(input as RequestInfo, init));
      kinds.push(response.headers.get("content-type") ?? "");
      return response;
    };
    const client = new Client({ name: "test-mcp-client", version: "0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(RESOURCE), { fetch: viaRoute, requestInit: { headers: { Authorization: `Bearer ${access_token}` } } })
    );
    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow(/Subscription limit/);
    expect(kinds.some((kind) => kind.includes("text/event-stream"))).toBe(false);
    expect((await client.listTools()).tools).toHaveLength(3);
    await client.close();
  });
});

describe("one credential, one door", () => {
  it("a grant's access token is refused by the token API", async () => {
    const { access_token } = await connect(["weight:read"]);
    const response = await weightRollupApi(new NextRequest("https://example.test/api/weight/rollup", { headers: { authorization: `Bearer ${access_token}` } }));
    expect(response.status).toBe(401);
  });

  it("the API's tokens and a device token are refused by /mcp", async () => {
    const device = await createDeviceToken({ name: "test-mcp-device", scopes: ["weight:read", "macros:read", "rides:read"] });
    expect((await call(device.raw, "tools/list")).status).toBe(401);
    for (const env of [process.env.JMW_API_KEY, process.env.JMW_AGENT_TOKEN]) {
      expect(env, "the env tokens must be set for this test to mean anything").toBeTruthy();
      expect((await call(env, "tools/list")).status).toBe(401);
    }
    expect((await call("jmwa_" + "0".repeat(43), "tools/list")).status).toBe(401);
  });

  it("a refresh token is not an access token, and the reverse", async () => {
    const { access_token, refresh_token } = await connect();
    expect((await call(refresh_token, "tools/list")).status).toBe(401);
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: access_token, client_id: CLIENT }));
  });
});

describe("refresh", () => {
  it("rotates both tokens: the old pair stops working at once", async () => {
    const first = await connect(["weight:read", "rides:read"]);
    const response = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT });
    expect(response.status).toBe(200);
    const second = (await response.json()) as Tokens;
    expect(second.scope).toBe("weight:read rides:read");
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await call(second.access_token, "tools/list")).status).toBe(200);
    expect((await call(first.access_token, "tools/list")).status).toBe(401);
  });

  it("a replaced refresh token inside the grace is refused and harms nothing", async () => {
    const first = await connect();
    const second = (await (await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT })).json()) as Tokens;
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT }));
    expect((await call(second.access_token, "tools/list")).status).toBe(200);
  });

  it("a replaced refresh token after the grace revokes the grant", async () => {
    const first = await connect();
    const second = (await (await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT })).json()) as Tokens;
    expect(await refreshGrant({ refreshToken: first.refresh_token }, new Date(Date.now() + 5 * 60_000))).toBeNull();
    expect((await call(second.access_token, "tools/list")).status).toBe(401);
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: CLIENT }));
  });

  it("refused for another client, without spending the token", async () => {
    const first = await connect();
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: "test-mcp-other" }));
    expect((await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: CLIENT })).status).toBe(200);
  });
});

describe("how a grant ends", () => {
  it("an access token expires after an hour", async () => {
    const { access_token } = await connect();
    expect(await findGrantByAccessToken(access_token)).not.toBeNull();
    expect(await findGrantByAccessToken(access_token, new Date(Date.now() + 59 * 60_000))).not.toBeNull();
    expect(await findGrantByAccessToken(access_token, new Date(Date.now() + 61 * 60_000))).toBeNull();
  });

  it("revoking ends it everywhere, at once, for good", async () => {
    const grant = await connect();
    expect(await revokeGrant(grant.id)).toBe(true);
    expect((await call(grant.access_token, "tools/list")).status).toBe(401);
    await invalidGrant(await token({ grant_type: "refresh_token", refresh_token: grant.refresh_token, client_id: CLIENT }));
    expect(await revokeGrant(grant.id)).toBe(false);
  });

  it("an approval that is then revoked can't be redeemed", async () => {
    const { id, code } = await approve();
    await revokeGrant(id);
    await invalidGrant(await redeem(code));
  });
});

describe("the devices page's list", () => {
  it("shows redeemed grants, revoked ones included, and never an approval that went nowhere", async () => {
    const connected = await connect(["rides:read"]);
    const revoked = await connect();
    await revokeGrant(revoked.id);
    const abandoned = await approve();

    const listed = await listGrants();
    const byId = new Map(listed.map((g) => [g.id, g]));
    expect(byId.get(connected.id)).toMatchObject({ name: "localhost:1", clientId: CLIENT, scopes: ["rides:read"], revokedAt: null });
    expect(byId.get(revoked.id)?.revokedAt).toBeInstanceOf(Date);
    expect(byId.has(abandoned.id)).toBe(false);
    expect(JSON.stringify(listed)).not.toMatch(/Hash|jmw[acr]_/);
  });

  it("a new approval sweeps away approvals whose code expired unredeemed", async () => {
    const stale = await approve(undefined, new Date(Date.now() - 10 * 60_000));
    await approve();
    const [row] = await db.select({ deletedAt: oauthGrant.deletedAt }).from(oauthGrant).where(eq(oauthGrant.id, stale.id));
    expect(row.deletedAt).toBeInstanceOf(Date);
    // A redeemed grant is never swept, however old its code.
    const [kept] = await db
      .select({ id: oauthGrant.id })
      .from(oauthGrant)
      .where(and(like(oauthGrant.clientId, "test-mcp%"), isNotNull(oauthGrant.codeUsedAt), isNotNull(oauthGrant.deletedAt)));
    expect(kept).toBeUndefined();
  });
});
