import { describe, expect, it } from "vitest";
import {
  MCP_SCOPES,
  authorizationServerMetadata,
  grantedScopes,
  isAllowedRedirect,
  parseAuthorizeRequest,
  protectedResourceMetadata,
  redirectWith,
  registerClient,
  resourceMatches,
  s256,
  verifyPkce,
} from "./oauth";

/** The OAuth rules of the MCP surface (`docs/mcp.md` §2), with no database and no HTTP. */
const ORIGIN = "https://justmy.website";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a".repeat(43);

const authorize = (over: Record<string, string | undefined> = {}) =>
  parseAuthorizeRequest(
    {
      response_type: "code",
      client_id: "jmw-mcp-client",
      redirect_uri: CLAUDE,
      state: "xyz",
      code_challenge: s256(VERIFIER),
      code_challenge_method: "S256",
      ...over,
    },
    ORIGIN
  );

describe("where a code may be sent", () => {
  it("Claude's callback, exactly", () => {
    expect(isAllowedRedirect(CLAUDE, { production: true })).toBe(true);
    expect(isAllowedRedirect("https://claude.com/api/mcp/auth_callback", { production: true })).toBe(true);
    for (const uri of [
      CLAUDE + "/",
      CLAUDE + "?next=evil",
      "https://claude.ai/api/mcp/auth_callback2",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://evil.example/callback",
      "not a url",
      "",
    ]) {
      expect(isAllowedRedirect(uri, { production: true }), uri).toBe(false);
    }
  });

  it("loopback only outside production", () => {
    for (const uri of ["http://localhost:8123/callback", "http://127.0.0.1:9/cb"]) {
      expect(isAllowedRedirect(uri, { production: false }), uri).toBe(true);
      expect(isAllowedRedirect(uri, { production: true }), uri).toBe(false);
    }
    expect(isAllowedRedirect("https://localhost:8123/callback", { production: false })).toBe(false);
    expect(isAllowedRedirect("http://localhost.evil.example/callback", { production: false })).toBe(false);
  });
});

describe("scopes", () => {
  it("only read scopes exist, and no write scope can be asked into being", () => {
    expect(MCP_SCOPES.every((scope) => scope.endsWith(":read"))).toBe(true);
    expect(grantedScopes("weight:write shopping:write weight:read")).toEqual(["weight:read"]);
    expect(grantedScopes("weight:write")).toEqual([...MCP_SCOPES]); // nothing we offer: the read-only default
  });

  it("nothing asked, or only extras like offline_access, means every read scope", () => {
    expect(grantedScopes(undefined)).toEqual([...MCP_SCOPES]);
    expect(grantedScopes("offline_access")).toEqual([...MCP_SCOPES]);
    expect(grantedScopes("rides:read  macros:read offline_access")).toEqual(["macros:read", "rides:read"]);
  });
});

describe("PKCE", () => {
  it("accepts the verifier for its challenge and nothing else", () => {
    expect(verifyPkce(VERIFIER, s256(VERIFIER))).toBe(true);
    expect(verifyPkce("b".repeat(43), s256(VERIFIER))).toBe(false);
    expect(verifyPkce(VERIFIER, VERIFIER)).toBe(false); // a "plain" challenge is not accepted
    expect(verifyPkce("short", s256("short"))).toBe(false);
    expect(verifyPkce("", "")).toBe(false);
  });
});

describe("the authorization request", () => {
  it("a good request", () => {
    const parsed = authorize({ scope: "weight:read", resource: "https://justmy.website/mcp" });
    expect(parsed).toEqual({
      ok: true,
      request: {
        clientId: "jmw-mcp-client",
        redirectUri: CLAUDE,
        state: "xyz",
        codeChallenge: s256(VERIFIER),
        scopes: ["weight:read"],
        resource: "https://justmy.website/mcp",
      },
    });
  });

  it("a Client ID Metadata Document URL is accepted as the client id", () => {
    const parsed = authorize({ client_id: "https://claude.ai/oauth/some-client-metadata" });
    expect(parsed.ok && parsed.request.clientId).toBe("https://claude.ai/oauth/some-client-metadata");
  });

  it("a bad redirect or a missing client is shown, never redirected", () => {
    for (const over of [{ redirect_uri: "https://evil.example/cb" }, { redirect_uri: undefined }, { client_id: undefined }]) {
      const parsed = authorize(over);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.problem.kind).toBe("page");
    }
  });

  it("everything else goes back to the redirect as an OAuth error, with the state", () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge: undefined }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge_method: undefined }, "invalid_request"],
      [{ code_challenge: "tooshort" }, "invalid_request"],
      [{ resource: "https://other.example/mcp" }, "invalid_target"],
      [{ resource: "https://justmy.website/api" }, "invalid_target"],
    ];
    for (const [over, error] of cases) {
      const parsed = authorize(over);
      expect(!parsed.ok && parsed.problem).toMatchObject({ kind: "redirect", redirectUri: CLAUDE, state: "xyz", error });
    }
  });

  it("the resource may be absent, or ours with a trailing slash", () => {
    expect(authorize({ resource: undefined }).ok).toBe(true);
    expect(authorize({ resource: "https://justmy.website/mcp/" }).ok).toBe(true);
    expect(resourceMatches(undefined, "https://justmy.website/mcp")).toBe(true);
    expect(resourceMatches("https://JustMy.website/mcp", "https://justmy.website/mcp")).toBe(true);
    expect(resourceMatches("https://justmy.website/mcp2", "https://justmy.website/mcp")).toBe(false);
  });

  it("redirectWith keeps an existing query and skips absent values", () => {
    expect(redirectWith("http://localhost:1/cb?x=1", { code: "c d", state: undefined, iss: ORIGIN })).toBe(
      "http://localhost:1/cb?x=1&code=c+d&iss=https%3A%2F%2Fjustmy.website"
    );
  });
});

describe("discovery documents", () => {
  it("the protected resource names the MCP URL and this server as its issuer", () => {
    expect(protectedResourceMetadata(ORIGIN)).toMatchObject({
      resource: "https://justmy.website/mcp",
      authorization_servers: [ORIGIN],
      scopes_supported: [...MCP_SCOPES],
    });
  });

  it("the authorization server says what Claude's client checks for", () => {
    const meta = authorizationServerMetadata(ORIGIN);
    expect(meta.issuer).toBe(ORIGIN);
    expect(meta.authorization_endpoint).toBe("https://justmy.website/oauth/authorize");
    expect(meta.token_endpoint).toBe("https://justmy.website/oauth/token");
    expect(meta.registration_endpoint).toBe("https://justmy.website/oauth/register");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(meta.client_id_metadata_document_supported).toBe(true);
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });
});

describe("client registration", () => {
  it("echoes a client whose redirects are all allowed", () => {
    const result = registerClient({ redirect_uris: [CLAUDE], client_name: "Claude" });
    expect(result.ok && result.client).toMatchObject({
      client_id: "jmw-mcp-client",
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: "none",
      client_name: "Claude",
    });
  });

  it("refuses any redirect it would not send a code to, and malformed bodies", () => {
    for (const body of [{ redirect_uris: [CLAUDE, "https://evil.example/cb"] }, { redirect_uris: [] }, { redirect_uris: "x" }, {}, null, "text"]) {
      const result = registerClient(body);
      expect(!result.ok && result.error, JSON.stringify(body)).toBe("invalid_redirect_uri");
    }
  });
});
