import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originFrom } from "@/lib/auth/pairing";
import { AUTHORIZE_FIELDS, SCOPE_LABELS, parseAuthorizeRequest, redirectWith } from "@/lib/mcp/oauth";
import { decideAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";
const card = {
  maxWidth: 520,
  margin: "12vh auto 0",
  padding: "26px 26px 22px",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  background: "var(--color-surface)",
} as const;
const button = {
  fontFamily: mono,
  fontSize: 13,
  padding: "9px 18px",
  borderRadius: "var(--radius)",
  border: "1px solid currentColor",
  background: "none",
  cursor: "pointer",
} as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The consent page (`docs/mcp.md` §2): the authorization endpoint of this app's OAuth server. It is
 * an ordinary Clerk-gated page, so "signing in" to the MCP connector is the existing sign-in; the
 * proxy sends an unsigned-in browser to Clerk and back here with the query intact. Rendering it has
 * no side effects: only the form's action mints a code.
 */
export default async function AuthorizePage({ searchParams }: Props) {
  const params = await searchParams;
  const origin = originFrom(await headers());
  const parsed = parseAuthorizeRequest(params, origin);

  if (!parsed.ok) {
    if (parsed.problem.kind === "redirect") {
      const { redirectUri, state, error, description } = parsed.problem;
      redirect(redirectWith(redirectUri, { error, error_description: description, state, iss: origin }));
    }
    return (
      <main style={card}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: 0 }}>This sign-in request can&apos;t be used</h1>
        <p style={{ color: "var(--color-text-muted)", marginTop: 12 }}>{parsed.problem.message}</p>
        <p style={{ color: "var(--color-text-muted)", marginTop: 12 }}>Nothing was approved. Start again from Claude.</p>
      </main>
    );
  }

  const { request } = parsed;
  const target = new URL(request.redirectUri);
  return (
    <main style={card}>
      <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.08em", color: "var(--color-text-muted)" }}>CONNECT AN APP</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "8px 0 0" }}>
        Let <span style={{ color: "var(--color-accent)" }}>{target.host}</span> read your data?
      </h1>
      <p style={{ marginTop: 14 }}>It will be able to:</p>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
        {request.scopes.map((scope) => (
          <li key={scope}>
            {SCOPE_LABELS[scope]} <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)" }}>{scope}</span>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 14, color: "var(--color-text-muted)" }}>
        It can&apos;t add, change or delete anything. You can end the connection at any time on the Devices page.
      </p>
      <p style={{ marginTop: 14, fontFamily: mono, fontSize: 11.5, color: "var(--color-text-muted)", wordBreak: "break-all" }}>
        The sign-in code is sent to {target.origin + target.pathname}
      </p>
      <p style={{ marginTop: 14, color: "var(--color-warning)" }}>
        Approve only if you started connecting from Claude yourself a moment ago.
      </p>
      <form action={decideAction} style={{ display: "flex", gap: 12, marginTop: 20 }}>
        {AUTHORIZE_FIELDS.map((name) => {
          const value = params[name];
          return typeof value === "string" ? <input key={name} type="hidden" name={name} value={value} /> : null;
        })}
        <button type="submit" name="decision" value="approve" style={{ ...button, color: "var(--color-accent)" }}>
          Approve
        </button>
        <button type="submit" name="decision" value="deny" style={{ ...button, color: "var(--color-text-muted)" }}>
          Deny
        </button>
      </form>
    </main>
  );
}
