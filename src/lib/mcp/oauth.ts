import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The OAuth rules for the MCP surface (`docs/mcp.md` §2–§3), as pure functions: what a client may
 * ask for, where a code may be sent, and what the two discovery documents say. No database and no
 * request objects here; `grants.ts` owns storage and the routes own HTTP.
 *
 * The authorization server is this app. It serves exactly one resource (`/mcp`), one human (whoever
 * holds the Clerk session on the consent page), and public clients only (PKCE, no client secret).
 */

/**
 * What an MCP grant can hold: read scopes, one per module, and nothing else. Writes are not offered.
 * The names match the module scopes of the device tokens where those exist (`macros:read`, …), so a
 * scope means the same thing on every surface; `garage:read` exists only here. A grant holds the
 * scopes it was approved with: adding one here reaches an existing connection only when it is
 * reconnected and approved again.
 */
export const MCP_SCOPES = [
  "macros:read",
  "weight:read",
  "rides:read",
  "lifting:read",
  "vitals:read",
  "shopping:read",
  "garage:read",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const SCOPE_LABELS: Record<McpScope, string> = {
  "macros:read": "Read your food log: entries, daily totals and targets, your food catalog and batches",
  "weight:read": "Read your weigh-ins and weight trend",
  "rides:read": "Read your ride log: each ride's numbers and its recorded track",
  "lifting:read": "Read your lifting sessions, goals and each lift's history",
  "vitals:read": "Read your daily watch measurements: sleep, heart rate, HRV, steps",
  "shopping:read": "Read your shopping list",
  "garage:read": "Read your bikes and which bike each ride was on",
};

export const OAUTH_PATHS = {
  mcp: "/mcp",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  register: "/oauth/register",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  // RFC 9728 §3.1: the well-known prefix goes in front of the resource's own path.
  protectedResourceMetadata: "/.well-known/oauth-protected-resource/mcp",
} as const;

/** An access token works for an hour; Claude refreshes it up to five minutes before that. */
export const ACCESS_TTL_SECONDS = 60 * 60;
/** A code only has to survive one redirect and one POST. */
export const CODE_TTL_SECONDS = 120;
/**
 * How long a just-replaced refresh token is refused quietly. Two refreshes can race (two chats
 * noticing the expiry at once); the loser must not look like a thief. After this, a replaced
 * refresh token showing up again revokes the grant.
 */
export const REFRESH_GRACE_SECONDS = 30;

/** The MCP endpoint's URL, which is also the RFC 8707 resource identifier a grant is issued for. */
export const mcpResource = (origin: string): string => origin + OAUTH_PATHS.mcp;

// --- Where a code may be sent ---

/**
 * The hosted Claude apps' one callback (claude.ai on the web, desktop, mobile). `claude.com` is the
 * same callback on Anthropic's other domain, accepted so a host move doesn't break sign-in.
 */
const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

/**
 * The redirect allowlist IS the client check. Registration is open and a client id is only a label,
 * so the one thing that decides who can receive a code is this list: Claude's callback, exactly.
 * Outside production a loopback address is also accepted, so the flow can be walked locally.
 */
export function isAllowedRedirect(uri: string, opts: { production?: boolean } = {}): boolean {
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  const production = opts.production ?? process.env.NODE_ENV === "production";
  if (production) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1") && !url.hash;
}

// --- Scopes ---

/**
 * The scopes a request ends up with. Anything this server doesn't offer is dropped (Claude may add
 * `offline_access`; a refresh token is issued regardless). Asking for nothing, or for nothing we
 * offer, means the default: every read scope. The consent page shows the result before approval.
 */
export function grantedScopes(requested: string | undefined): McpScope[] {
  const asked = new Set((requested ?? "").split(/\s+/).filter(Boolean));
  const granted = MCP_SCOPES.filter((scope) => asked.has(scope));
  return granted.length ? granted : [...MCP_SCOPES];
}

// --- PKCE (RFC 7636), S256 only ---

const PKCE_CHARS = /^[A-Za-z0-9\-._~]{43,128}$/;

export const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!PKCE_CHARS.test(verifier)) return false;
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- The authorization request ---

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
};

/** The parameters of an authorization request. The consent form carries them back unchanged. */
export const AUTHORIZE_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

/**
 * Why a request can't go ahead. `page` problems are shown to the human and never redirected: the
 * redirect target itself is what's wrong, so sending anything there would be the vulnerability.
 * `redirect` problems go back to the (trusted) redirect URI as an OAuth error.
 */
export type AuthorizeProblem =
  | { kind: "page"; message: string }
  | { kind: "redirect"; redirectUri: string; state: string | undefined; error: string; description: string };

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string): string | undefined => {
  const value = params[key];
  return typeof value === "string" && value.length ? value : undefined;
};

const sameResource = (a: string, b: string): boolean => a.replace(/\/+$/, "").toLowerCase() === b.toLowerCase();

export function parseAuthorizeRequest(
  params: Params,
  origin: string
): { ok: true; request: AuthorizeRequest } | { ok: false; problem: AuthorizeProblem } {
  const clientId = one(params, "client_id");
  const redirectUri = one(params, "redirect_uri");
  if (!clientId || clientId.length > 2000) return { ok: false, problem: { kind: "page", message: "The request has no client_id." } };
  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
    return { ok: false, problem: { kind: "page", message: "The request's redirect_uri is not one this server sends codes to." } };
  }

  const state = one(params, "state");
  const fail = (error: string, description: string) =>
    ({ ok: false, problem: { kind: "redirect", redirectUri, state, error, description } }) as const;

  if (state && state.length > 2000) return fail("invalid_request", "state is too long");
  if (one(params, "response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  const codeChallenge = one(params, "code_challenge");
  if (!codeChallenge || one(params, "code_challenge_method") !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(codeChallenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const resource = mcpResource(origin);
  const asked = one(params, "resource");
  if (asked && !sameResource(asked, resource)) return fail("invalid_target", `resource must be ${resource}`);

  return { ok: true, request: { clientId, redirectUri, state, codeChallenge, scopes: grantedScopes(one(params, "scope")), resource } };
}

/** `redirectUri` with OAuth response parameters added (it may already carry a query). */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/** A resource value sent to the token endpoint: absent is fine, present must be this grant's. */
export const resourceMatches = (sent: string | undefined, granted: string): boolean => !sent || sameResource(sent, granted);

// --- Discovery documents ---

/** RFC 9728 protected resource metadata: what `/mcp` is and who issues its tokens. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "justmy.website",
  };
}

/**
 * RFC 8414 authorization server metadata. Public clients only (`none`), S256 only. Both ways Claude
 * can identify itself are advertised: a Client ID Metadata Document (its URL is the client id) and
 * Dynamic Client Registration. Either way the redirect allowlist decides, so the metadata document
 * is not fetched: it could only tell us redirect URIs we would refuse anyway.
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: origin + OAUTH_PATHS.authorize,
    token_endpoint: origin + OAUTH_PATHS.token,
    registration_endpoint: origin + OAUTH_PATHS.register,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// --- Dynamic client registration (RFC 7591), stateless ---

/** The id every registered client gets. Nothing is stored: registering proves nothing and grants nothing. */
export const REGISTERED_CLIENT_ID = "jmw-mcp-client";

export function registerClient(
  body: unknown
): { ok: true; client: Record<string, unknown> } | { ok: false; error: string; description: string } {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((uri) => typeof uri === "string" && isAllowedRedirect(uri))) {
    return { ok: false, error: "invalid_redirect_uri", description: "Every redirect_uri must be one this server sends codes to." };
  }
  return {
    ok: true,
    client: {
      client_id: REGISTERED_CLIENT_ID,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(typeof input.client_name === "string" ? { client_name: input.client_name.slice(0, 200) } : {}),
    },
  };
}
