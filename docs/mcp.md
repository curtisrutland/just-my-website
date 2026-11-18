# MCP surface

How Claude reads justmy.website as a connector: one MCP endpoint, a small OAuth server in front of
it, and read-only tools for every module. Issue #133. The spike that led here is `docs/archive/mcp-spike.md`.

This is a **surface**, not a module (CONVENTIONS §1). It owns no domain data and no domain logic. It
is also a **kernel departure** in auth (CONVENTIONS §2): a new kind of credential, and four
endpoints that answer without a bearer token. Widening anything in §2 to §4 below needs an entry
here and a test.

## 1. What is exposed

| URL | What | Who may call it |
|---|---|---|
| `POST /mcp` | The MCP endpoint (stateless Streamable HTTP) | Only the access token of a live grant |
| `GET /.well-known/oauth-protected-resource/mcp` (also the bare path) | RFC 9728 metadata: what `/mcp` is, who issues its tokens | Anyone |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata: the endpoints below | Anyone |
| `POST /oauth/register` | Dynamic client registration, stateless | Anyone |
| `POST /oauth/token` | Code → tokens, refresh → tokens | Whoever holds the code and its PKCE verifier, or the refresh token |
| `GET /oauth/authorize` | The consent page | A signed-in Clerk session |

The four "anyone" and credential-only endpoints sit outside `/api` on purpose. `/api` is token-only
with no exceptions; these cannot be. None of them returns data. The proxy (`src/proxy.ts`) skips
`/mcp`, `/oauth/token`, `/oauth/register` and `/.well-known/`, and does **not** skip
`/oauth/authorize`: the Clerk gate on the consent page is what makes an approval mean something.

`/mcp` answers 401 to everything without a live grant's access token: no token, a device token, the
env tokens, an expired or revoked access token, a refresh token. The 401 carries
`WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, which is
how Claude finds the sign-in.

## 2. Signing in

The authorization server is this app. It serves one resource (`/mcp`), one human, and public clients
only. Rules, all in `src/lib/mcp/oauth.ts` and tested in `oauth.test.ts`:

- **Where a code may go.** `https://claude.ai/api/mcp/auth_callback` (and the same path on
  `claude.com`), exactly. Outside production a loopback `http://localhost…` redirect is also
  accepted, to walk the flow locally. **This allowlist is the client check.** Registration is open
  and a client id is only a label; nothing else decides who can receive a code.
- **Client identity.** Both forms Claude uses are accepted: an id from `/oauth/register` (every
  client gets the same one; nothing is stored) and a Client ID Metadata Document URL. The document is
  not fetched: it could only list redirect URIs, and the allowlist already refuses every one but
  Claude's.
- **PKCE** with `S256` is required. There is no client secret.
- **Scopes.** One read scope per module: `macros:read`, `weight:read`, `rides:read`, `lifting:read`,
  `vitals:read`, `shopping:read`, `garage:read`. Anything else asked for is dropped. Asking for
  nothing we offer means all of them. There is no write scope to ask for.
- **Resource** (RFC 8707). If sent, it must be this host's `/mcp`.
- **Consent.** `/oauth/authorize` shows what will be readable and where the code goes. Rendering it
  changes nothing. Approve and Deny post to one server action, which checks the Clerk session and
  validates the request again before minting a code. A bad `client_id` or `redirect_uri` is shown on
  the page and never redirected; every other problem goes back to the redirect as an OAuth error.

Sequence, as Claude runs it:

1. `POST /mcp` with no token → 401 with the metadata pointer.
2. `GET` the two `/.well-known/` documents.
3. Optionally `POST /oauth/register`.
4. The browser opens `/oauth/authorize?…`; Curtis signs in if needed and approves.
5. The browser is sent to Claude's callback with `code`, `state` and `iss`.
6. `POST /oauth/token` with the code and the PKCE verifier → an access token and a refresh token.
7. `POST /mcp` with `Authorization: Bearer <access token>`.

## 3. Grants

One approval is one row in `oauth_grants` (`src/lib/mcp/grants.ts` is the only code that touches the
table). Grants are deliberately **not** rows in `device_tokens`. A device token is one long-lived
secret; a grant's credentials rotate and expire. Keeping them in separate tables also makes the
separation structural: `/mcp` only looks in `oauth_grants`, the token API only looks in
`device_tokens`, so neither credential can open the other door.

| Credential | Lifetime | Notes |
|---|---|---|
| Authorization code | 120 seconds, one use | A second use revokes the grant it produced |
| Access token | 1 hour | Looked up on every request, so revoking is immediate |
| Refresh token | Until revoked | Rotated on every use; the old pair dies in the same statement |

- Only sha256 hashes are stored. The raw values exist in one response each.
- **Refresh reuse.** A refresh token that was already replaced is refused. Within 30 seconds of the
  rotation that is treated as two requests racing. After that it means two parties hold the grant's
  credentials, and the grant is revoked.
- **Revoking.** `/settings/devices` lists every grant under "Connected apps" with a revoke button.
  A revoked grant is dead for good: 401 at `/mcp`, `invalid_grant` at the token endpoint. To
  reconnect, connect again from Claude and approve.
- An approval whose code is never redeemed is not a connection. It is not listed, and the next
  approval soft-deletes it.

## 4. Tools

Each tool calls a module's own repo read function and returns the same JSON, with the same field
names, as the token API route for that read. No tool writes. The scope check is in the one function
that registers every tool (`reader` in `src/lib/mcp/tools.ts`), so a tool can't be added without one.

Where the API has a list route and a get-by-id route, one tool serves both: an `id` (or a single
`date`) returns that one thing in the get route's shape; without it, the list route's shape.

| Tool | Scope | Repo read | Same as |
|---|---|---|---|
| `macros_day` | `macros:read` | `getDayRollup(date)`; today in `America/Chicago` by default | `GET /api/macros/days/{date}` |
| `macros_range` | `macros:read` | `getRange(start, end)`; at most 366 days | `GET /api/macros/range` |
| `macros_entries` | `macros:read` | `listEntries({ on })` | `GET /api/macros/entries` |
| `macros_foods` | `macros:read` | `listFoods(…)`, or `getFoodById(id)` | `GET /api/macros/foods`, `/foods/{id}` |
| `macros_batches` | `macros:read` | `listBatches(…)`, or `getBatchById(id)` | `GET /api/macros/batches`, `/batches/{id}` |
| `macros_usda_search` | `macros:read` | `searchFoods(q)` (USDA, an outside service) | `GET /api/macros/usda/search` |
| `weight_rollup` | `weight:read` | `getRollup({ window, end })`; window 7 to 3650, default 90 | `GET /api/weight/rollup` |
| `weight_entries` | `weight:read` | `listEntries(…)`, or `getEntryByDay(date)` | `GET /api/weight/entries`, `/days/{date}` |
| `rides_list` | `rides:read` | `listRides(…)`; filters `from`, `to`, `sport`, `q` | `GET /api/rides` |
| `rides_detail` | `rides:read` | `getRide(id, { includeStream })` | `GET /api/rides/{id}` |
| `rides_weekly` | `rides:read` | `weeklyStats({ weeks, sport })` | `GET /api/rides/weekly` |
| `lifting_sessions` | `lifting:read` | `listSessions(…)`, or `getSession(id)` | `GET /api/lifting/sessions`, `/sessions/{id}` |
| `lifting_goal` | `lifting:read` | `getGoalOn(on)`, or `listGoals(…)` with `history` | `GET /api/lifting/goal`, `/goals` |
| `lifting_lift` | `lifting:read` | `getLiftProgression(templateId)` | `GET /api/lifting/lifts/{templateId}` |
| `vitals_days` | `vitals:read` | `listDays(…)`, or `getDay(date)` | `GET /api/vitals`, `/vitals/{date}` |
| `vitals_summary` | `vitals:read` | `getRollup({ window, end })` | `GET /api/vitals/summary` |
| `shopping_list` | `shopping:read` | `getList({ boughtWithinDays })` | `GET /api/shopping/list` |
| `shopping_items` | `shopping:read` | `listItems(…)`, or `getItemById(id)` | `GET /api/shopping/items`, `/items/{id}` |
| `garage_bikes` | `garage:read` | `listBikes(…)`, or `getBike(id, window)` | `GET /api/garage/bikes`, `/bikes/{id}` |
| `garage_rides` | `garage:read` | `listRideTags(…)` | `GET /api/garage/rides` |

**How the tools differ from the routes**, all deliberate:
- A page is 20 items by default (the API's is 50), to keep answers small. The maximum is still 100.
- A thing that doesn't exist is an error result saying "Not found", where the route answers 404.
- A result over 140,000 characters is refused with a message saying to ask for less. claude.ai cuts a
  result off at about 150,000. Measured on 2026-11-18: the longest ride (3.9 hours) with its stream is
  about 129,000 characters, and a page of 100 rides is about 88,000.

**Descriptions** say what a reader can't guess from the field names: units (food in kcal and grams,
body weight in pounds, lifting in kilograms, rides in SI), what is and isn't summed, how to read a raw
shape, and when a number needs a question first (a ride over about 30 mph is probably a recorded
drive). How to *act* on the data belongs in the skills.

**The cost of the list.** Every tool's definition is sent with every conversation that has the
connector on. The 20 read tools are about 20,000 characters (`tools.test.ts` holds a budget of
22,000). Two things keep it down: dates and ids are validated by refinement instead of zod's built-in
formats, which publish a 200-character regular expression per field, and list and get-by-id share a
tool.

Adding a tool: add its scope to `MCP_SCOPES` (and a consent label) only if it needs a new one, register
it with `reader`, add a row here, and add it to the table in `tools.test.ts`. A grant holds the scopes
it was approved with, so a new scope reaches an existing connection only when it is reconnected and
approved again. A write tool would be a larger change than a tool: it needs a write scope, a decision
about what the skills keep doing, and the write-path rule (`schema.parse` then `repo`, CONVENTIONS §5).
That work is #144.

## 5. Hosting notes

- **Stateless.** No sessions; any function instance can answer any request. The attempt in mid-2026
  probably failed on exactly this (`docs/archive/mcp-spike.md`).
- **No streams.** `maxSubscriptions: 0`. Claude asks to be notified when the tool list changes by
  holding a server-sent-events stream open. On the spike each one pinned a Vercel function for its
  full 300 seconds and ended as a timeout error. The tools never change at runtime, so the request
  is refused.
- **Logging.** Lines prefixed `[mcp]` name the method, the client and the tool. Never arguments,
  results or tokens.
- **Preview deployments can't be used.** They are behind Vercel sign-in, and Claude calls from
  Anthropic's servers. The connector URL is `https://justmy.website/mcp`.

## 6. Trying it locally

Claude can't reach a dev server, so `npm run mcp:try` stands in for it. With `npm run dev` running
and a browser signed in to it, the script discovers the server, prints the consent URL, waits for the
approval on a loopback port, redeems the code, lists the tools, calls `weight_rollup`, refreshes
once, and then waits for the grant to be revoked on `/settings/devices`. It never prints a token.
It works only against a dev server: production refuses loopback redirects.

The automated tests are `src/lib/mcp/oauth.test.ts` (the rules), `src/app/oauth/endpoints.test.ts`
(discovery, registration, malformed token requests), `src/app/mcp/route.test.ts` (no credential),
`src/app/mcp/flow.test.ts` (everything a grant does and every way it ends) and
`src/app/mcp/tools.test.ts` (every tool: its shape, its scope check, not-found, bad arguments). The
last two run against the database and share `src/app/mcp/test-kit.ts`.

## 7. Not done

- Claude Code as a client (it needs a loopback redirect in production).
- Any write.
- Fetching Client ID Metadata Documents, should a second client ever be allowed.
