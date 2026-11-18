# MCP spike (#133)

**Archived.** Step 1 passed on 2026-11-18: after PR #134 was merged, claude.ai listed `ping` and
called it on production. The surface that followed is described in `docs/mcp.md`; the `ping` tool
and the open endpoint described below no longer exist. The result and the production log are on
issue #133.

What the log added to this page's findings: claude.ai talks to the server with the 2026-07-28
protocol (`server/discover`, then `tools/list`), which has no sessions at all, and in a chat it
opens a `subscriptions/listen` stream that held a Vercel function for the full 300 seconds.

Original status, 2026-11-18: step 1 is built on the branch `spike/mcp` and proven locally. It has
not been tried from claude.ai yet, because claude.ai can only reach a public URL.

## The question

The attempt in mid-2026 ended with claude.ai connecting to the server and showing no tools. Before
any auth or real data, this spike answers one thing: can claude.ai list and call a tool served from
this app on Vercel?

## What claude.ai requires today

Read from Anthropic's connector docs on 2026-11-18 (links at the end).

- **Transport:** Streamable HTTP. The older HTTP+SSE transport still works but is being retired.
- **Auth:** a server with no authentication is supported. So are OAuth with Dynamic Client
  Registration and OAuth with a Client ID Metadata Document. A fixed bearer token in a header is in
  beta for some organizations only, so it is not an option to plan on.
- **Reach:** claude.ai calls from Anthropic's servers (`160.79.104.0/21`), never from the laptop or
  phone. The URL must be public, must not redirect to another host, and must resolve to an IPv4
  address.
- **What it uses:** tools, prompts and resources. A tool result can be about 150,000 characters and
  a call can run for 240 seconds.

## Why last time probably failed

No code or logs survive from that attempt, so this is inference. The handler library then kept each
connection's session in memory (or in Redis) for the HTTP+SSE transport. On Vercel the request that
opens a session and the request that lists tools can land on different instances, and the second one
finds no session.

The current libraries (`mcp-handler` 2.4 on `@modelcontextprotocol/server` 2.4) have no sessions at
all. Every request is answered on its own. That removes the suspected cause instead of working
around it.

## What is built

| File | What it is |
|---|---|
| `src/app/mcp/route.ts` | The endpoint, `POST /mcp`. `GET` and `DELETE` answer 405. |
| `src/lib/mcp/server.ts` | The one tool, `ping`, and the log lines. |
| `src/proxy.ts` | `/mcp` is skipped by the Clerk proxy, like `/api`. |
| `src/app/mcp/route.test.ts`, `client.test.ts` | Tests, below. |

`ping` takes an optional `note` and returns `pong`, the server's time and the note. It reads no
data. The endpoint has no authentication, which is acceptable only because of that. It lives outside
`/api` so the rule that `/api` is token-only stays true.

## What is proven locally

- Hand-written requests for the three protocol versions claude.ai follows (2025-03-26, 2025-06-18,
  2025-11-25): `initialize` declares the tools capability and opens no session.
- `tools/list` and `tools/call` each succeed with no `initialize` before them.
- The first request to a freshly restarted dev server was a `tools/call`, and it succeeded. Nothing
  depends on server memory.
- The official MCP client connects, lists `ping` and calls it.
- `/`, `/weight` and `/mcpx` still redirect to sign-in and `/api/weight/entries` still answers 401.
- `npm test` passes (297 tests) and `npm run build` lists `/mcp`.

Not proven: anything on Vercel, and anything from claude.ai.

## Trying it from claude.ai

Preview deployments are behind Vercel's sign-in (the project protects every URL except the custom
domains), so claude.ai cannot reach a preview. The practical route is production:

1. Merge `spike/mcp` and let it deploy. `https://justmy.website/mcp` then exists and offers `ping`.
2. In claude.ai open **Customize > Connectors**, add a custom connector with the URL
   `https://justmy.website/mcp`, and leave the OAuth fields empty.
3. On the connector's page, **Tool permissions** should list `ping`.
4. In a chat, turn the connector on and ask Claude to ping justmy.website with a note.

The function log should then show, in this order:

```
[mcp] <- initialize client=…/… asked=…
[mcp] -> initialize success …ms
[mcp] <- tools/list
[mcp] -> tools/list success …ms
[mcp] <- tools/call tool=ping
[mcp] -> tools/call success …ms
```

Each HTTP request also logs one `[mcp] http …` line with the verb, the status, and whether a session
id or an `Authorization` header was sent. If the tool list stays empty, those lines say how far
claude.ai got.

## If step 1 works: auth, then real tools

Recommended shape, not built:

- **A small OAuth server inside this app.** Its consent page is an ordinary Clerk-gated page, so
  signing in is the existing sign-in. Approving mints a scoped row in `device_tokens`, read-only by
  default, listed and revoked on `/settings/devices` like the phone. This uses Clerk for the human
  and does not depend on Clerk's own OAuth product or on the production cutover (#23).
- **What claude.ai needs from it:** protected-resource metadata at
  `/.well-known/oauth-protected-resource/mcp`, a 401 from `/mcp` that points at it,
  authorization-server metadata, client registration (DCR or a Client ID Metadata Document), PKCE
  with S256, the redirect `https://claude.ai/api/mcp/auth_callback`, and refresh tokens that rotate.
- **Then three read-only tools** from the existing repo read functions: the macros day, the weight
  rollup and the ride list.

`ping` and the open endpoint go away when auth lands: an MCP endpoint that returns data must never
answer without a token.

## Sources

- https://claude.com/docs/connectors/building
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/testing
- https://claude.com/docs/connectors/building/troubleshooting
- https://github.com/vercel-labs/mcp-handler
