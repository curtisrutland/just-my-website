import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

/**
 * Walk the MCP sign-in against a LOCAL dev server, as a stand-in for Claude (`docs/mcp.md` §2):
 *
 *   npm run mcp:try                       # against http://localhost:3000
 *   npm run mcp:try -- http://localhost:3001
 *
 * It discovers the server, prints the consent URL to open in a signed-in browser, waits for the
 * approval to arrive on a loopback port, redeems the code, lists the tools, calls one, and refreshes
 * once. It never prints a token. Production refuses loopback redirects, so this only works against
 * a dev server. The grant it creates shows on /settings/devices as `localhost:<port>`: revoke it
 * there when done (the script's last check waits for that, to show revoking works).
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const b64 = (bytes: Buffer) => bytes.toString("base64url");
const verifier = b64(randomBytes(32));
const challenge = b64(createHash("sha256").update(verifier).digest());
const state = b64(randomBytes(12));

const step = (label: string, detail = "") => console.log(`  ${label}${detail ? "  " + detail : ""}`);
const fail = (message: string): never => {
  console.error(`\n  FAILED: ${message}\n`);
  process.exit(1);
};

async function rpc(access: string | undefined, method: string, params?: unknown) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(access ? { authorization: `Bearer ${access}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  const text = await response.text();
  const data = text.split("\n").filter((line) => line.startsWith("data:"));
  let body: { result?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(data.length ? data[data.length - 1].slice(5) : text);
  } catch {
    body = null;
  }
  return { status: response.status, challenge: response.headers.get("www-authenticate"), result: body?.result };
}

const token = (fields: Record<string, string>) =>
  fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

async function main() {
  console.log(`\n  MCP sign-in walk-through against ${base}\n`);

  const refused = await rpc(undefined, "tools/list");
  if (refused.status !== 401) fail(`/mcp without a token answered ${refused.status}, expected 401`);
  const pointer = /resource_metadata="([^"]+)"/.exec(refused.challenge ?? "")?.[1];
  if (!pointer) fail("the 401 has no resource_metadata pointer");
  step("1. /mcp without a token → 401, pointing at", pointer);

  const resource = await (await fetch(pointer!)).json();
  const issuer: string = resource.authorization_servers[0];
  const meta = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
  step("2. discovery → sign-in at", meta.authorization_endpoint);

  const code = await new Promise<string>((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/callback") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/plain" }).end("Done. You can close this tab and go back to the terminal.");
      server.close();
      if (url.searchParams.get("state") !== state) fail("the state that came back is not the one sent");
      if (url.searchParams.get("iss") !== issuer) fail("the issuer that came back is not the server's");
      const error = url.searchParams.get("error");
      if (error) fail(`the request was not approved: ${error}`);
      resolve(url.searchParams.get("code") ?? fail("no code came back"));
    });
    server.listen(0, "127.0.0.1", async () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://localhost:${port}/callback`;
      const registered = await fetch(meta.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirect], client_name: "mcp-try" }),
      });
      if (registered.status !== 201) fail(`registration answered ${registered.status}`);
      const { client_id } = await registered.json();
      clientId = client_id;
      redirectUri = redirect;
      const authorize = new URL(meta.authorization_endpoint);
      for (const [key, value] of Object.entries({
        response_type: "code",
        client_id,
        redirect_uri: redirect,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: resource.scopes_supported.join(" "),
        resource: resource.resource,
      })) {
        authorize.searchParams.set(key, value as string);
      }
      step("3. registered; open this in a browser signed in to the dev server, and approve:");
      console.log(`\n     ${authorize}\n`);
    });
  });
  step("4. approved: a code arrived on the loopback port");

  const redeemed = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri, resource: resource.resource });
  if (redeemed.status !== 200) fail(`the token endpoint answered ${redeemed.status}: ${await redeemed.text()}`);
  const first = await redeemed.json();
  step("5. code redeemed →", `${first.token_type} token, ${first.expires_in}s, scope "${first.scope}"`);

  const replay = await token({ grant_type: "authorization_code", code: "jmwc_wrong", code_verifier: verifier, client_id: clientId });
  if (replay.status !== 400) fail("a wrong code was not refused");

  const listed = await rpc(first.access_token, "tools/list");
  const tools = ((listed.result?.tools as { name: string }[]) ?? []).map((tool) => tool.name);
  if (listed.status !== 200 || tools.length === 0) fail(`tools/list answered ${listed.status}`);
  step("6. tools:", tools.join(", "));

  const called = await rpc(first.access_token, "tools/call", { name: "weight_rollup", arguments: { window: 7 } });
  const content = (called.result?.content as { text: string }[] | undefined)?.[0]?.text ?? "";
  if (called.status !== 200 || called.result?.isError) fail("weight_rollup did not answer");
  step("7. weight_rollup(window: 7) →", `${content.length} characters of JSON, keys: ${Object.keys(JSON.parse(content)).join(", ")}`);

  const refreshed = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId });
  if (refreshed.status !== 200) fail(`refresh answered ${refreshed.status}`);
  const second = await refreshed.json();
  const oldAccess = await rpc(first.access_token, "tools/list");
  const newAccess = await rpc(second.access_token, "tools/list");
  if (oldAccess.status !== 401 || newAccess.status !== 200) fail(`after refresh: old token ${oldAccess.status}, new token ${newAccess.status}`);
  step("8. refreshed: the old access token is refused (401), the new one works");

  step("9. now revoke it:", `open ${base}/settings/devices → Connected apps → revoke "${new URL(redirectUri).host}"`);
  process.stdout.write("     waiting for the revoke (Ctrl-C to skip) ");
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await rpc(second.access_token, "tools/list")).status === 401) break;
    process.stdout.write(".");
  }
  console.log("\n  10. revoked: /mcp now answers 401 to that grant\n\n  All steps passed.\n");
}

let clientId = "";
let redirectUri = "";
main().catch((error) => fail(String(error)));
