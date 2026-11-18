"use client";

import { useTransition } from "react";
import type { GrantRow } from "@/lib/mcp/grants";
import { SectionLabel } from "./PairPhone";

const mono = "var(--font-mono)";

const when = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

/**
 * Apps connected through the MCP sign-in (`docs/mcp.md` §3), revoked ones included. Each row is one
 * approval on the consent page. Revoke asks first; nothing here can un-revoke.
 */
export function GrantList({ grants, revoke }: { grants: GrantRow[]; revoke: (id: string) => Promise<void> }) {
  const live = grants.filter((g) => !g.revokedAt).length;
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SectionLabel>CONNECTED APPS</SectionLabel>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)" }}>
          {live} live · {grants.length - live} revoked
        </span>
      </div>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--color-surface)" }}>
        {grants.length === 0 ? (
          <div style={{ padding: "26px 16px", textAlign: "center", fontFamily: mono, fontSize: 12.5, color: "var(--color-text-muted)" }}>
            No apps connected. Add the connector in Claude to connect one.
          </div>
        ) : (
          grants.map((g, i) => <GrantRowView key={g.id} grant={g} last={i === grants.length - 1} revoke={revoke} />)
        )}
      </div>
    </section>
  );
}

function GrantRowView({ grant, last, revoke }: { grant: GrantRow; last: boolean; revoke: (id: string) => Promise<void> }) {
  const [pending, start] = useTransition();
  const revoked = grant.revokedAt != null;
  const onRevoke = () => {
    if (!window.confirm(`Disconnect ${grant.name}? It loses access at once. To use it again, reconnect from Claude and approve.`)) return;
    start(() => revoke(grant.id));
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
        padding: "12px 16px",
        borderBottom: last ? "none" : "1px solid var(--color-border)",
        opacity: revoked ? 0.55 : 1,
      }}
    >
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 13.5, color: "var(--color-text)", textDecoration: revoked ? "line-through" : "none" }}>{grant.name}</div>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3, wordBreak: "break-word" }}>{grant.scopes.join(" · ")}</div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 2, fontVariantNumeric: "tabular-nums" }}>
        <span>connected</span>
        <span>{when(grant.createdAt)}</span>
        <span>last seen</span>
        <span>{when(grant.lastSeenAt)}</span>
        {revoked && (
          <>
            <span>revoked</span>
            <span>{when(grant.revokedAt)}</span>
          </>
        )}
      </div>
      <div style={{ width: 76, textAlign: "right" }}>
        {revoked ? (
          <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)" }}>revoked</span>
        ) : (
          <button
            type="button"
            onClick={onRevoke}
            disabled={pending}
            aria-label={`Disconnect ${grant.name}`}
            style={{ fontFamily: mono, fontSize: 12, color: "var(--color-over)", background: "none", border: "1px solid currentColor", borderRadius: "var(--radius)", padding: "5px 10px", cursor: "pointer" }}
          >
            {pending ? "…" : "revoke"}
          </button>
        )}
      </div>
    </div>
  );
}
