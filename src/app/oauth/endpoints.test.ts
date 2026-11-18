import { describe, expect, it } from "vitest";
import { GET as authorizationServer } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { POST as register } from "./register/route";
import { POST as token } from "./token/route";

/**
 * The OAuth endpoints that need no database (`docs/mcp.md` §2): the two discovery documents, client
 * registration, and the token endpoint's refusals of malformed requests. The flows that mint and
 * redeem credentials are in `src/app/mcp/flow.test.ts`.
 */
const at = (path: string, init?: RequestInit) =>
  new Request("http://internal" + path, { ...init, headers: { "x-forwarded-host": "justmy.website", "x-forwarded-proto": "https", ...init?.headers } });

const form = (fields: Record<string, string>) =>
  at("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

describe("discovery", () => {
  it("protected resource metadata uses the public host, at both paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = protectedResource(at(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({ resource: "https://justmy.website/mcp", authorization_servers: ["https://justmy.website"] });
    }
  });

  it("authorization server metadata's issuer is the host that was asked", async () => {
    const response = authorizationServer(at("/.well-known/oauth-authorization-server"));
    const meta = await response.json();
    expect(meta.issuer).toBe("https://justmy.website");
    expect(meta.token_endpoint).toBe("https://justmy.website/oauth/token");
    const local = await authorizationServer(new Request("http://localhost:3000/.well-known/oauth-authorization-server", { headers: { host: "localhost:3000" } })).json();
    expect(local.issuer).toBe("http://localhost:3000");
  });
});

describe("POST /oauth/register", () => {
  const post = (body: string) => register(at("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body }));

  it("201 for Claude's callback, and never cacheable", async () => {
    const response = await post(JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ client_id: "jmw-mcp-client", token_endpoint_auth_method: "none" });
  });

  it("400 for another redirect, and for a body that isn't JSON", async () => {
    const other = await post(JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }));
    expect(other.status).toBe(400);
    expect((await other.json()).error).toBe("invalid_redirect_uri");
    const junk = await post("not json");
    expect(junk.status).toBe(400);
    expect((await junk.json()).error).toBe("invalid_client_metadata");
  });
});

describe("POST /oauth/token, malformed requests", () => {
  it("a JSON body is refused: the endpoint is form-encoded", async () => {
    const response = await token(at("/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_request");
  });

  it("an unknown grant type", async () => {
    for (const grant_type of ["client_credentials", "password", ""]) {
      const response = await token(form({ grant_type }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("unsupported_grant_type");
    }
  });

  it("missing fields are invalid_request, before any lookup", async () => {
    const cases: Record<string, string>[] = [
      { grant_type: "authorization_code", code: "x", client_id: "c" },
      { grant_type: "authorization_code", code_verifier: "v", client_id: "c" },
      { grant_type: "authorization_code", code: "x", code_verifier: "v" },
      { grant_type: "refresh_token" },
    ];
    for (const fields of cases) {
      const response = await token(form(fields));
      expect(response.status, JSON.stringify(fields)).toBe(400);
      expect((await response.json()).error).toBe("invalid_request");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
