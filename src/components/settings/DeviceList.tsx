"use client";

import { useTransition } from "react";
import type { DeviceTokenRow } from "@/lib/auth/device-tokens";
import { SectionLabel } from "./PairPhone";

const mono = "var(--font-mono)";

const when = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

/**
 * A child token (a phone's weigh-in token for Siri) sits directly under the token that minted it;
 * one whose parent isn't listed any more falls back to the top level rather than vanishing.
 */
function underParents(devices: DeviceTokenRow[]): DeviceTokenRow[] {
  const ids = new Set(devices.map((d) => d.id));
  const top = devices.filter((d) => !d.parentId || !ids.has(d.parentId));
  return top.flatMap((d) => [d, ...devices.filter((c) => c.parentId === d.id)]);
}

/** Every device token, revoked ones included. Revoke asks first; nothing here can un-revoke. */
export function DeviceList({ devices: listed, revoke }: { devices: DeviceTokenRow[]; revoke: (id: string) => Promise<void> }) {
  const devices = underParents(listed);
  const live = devices.filter((d) => !d.revokedAt).length;
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SectionLabel>DEVICES</SectionLabel>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)" }}>
          {live} live · {devices.length - live} revoked
        </span>
      </div>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--color-surface)" }}>
        {devices.length === 0 ? (
          <div style={{ padding: "26px 16px", textAlign: "center", fontFamily: mono, fontSize: 12.5, color: "var(--color-text-muted)" }}>No devices yet.</div>
        ) : (
          devices.map((d, i) => <DeviceRow key={d.id} device={d} last={i === devices.length - 1} revoke={revoke} />)
        )}
      </div>
    </section>
  );
}

function DeviceRow({ device, last, revoke }: { device: DeviceTokenRow; last: boolean; revoke: (id: string) => Promise<void> }) {
  const [pending, start] = useTransition();
  const revoked = device.revokedAt != null;
  const child = device.parentId != null;
  const onRevoke = () => {
    const consequence = child
      ? "Siri weigh-ins stop at once; the phone itself keeps working and makes a new one the next time the app is opened."
      : "It stops working at once, and this can't be undone — pair again to replace it.";
    if (!window.confirm(`Revoke ${device.name}? ${consequence}`)) return;
    start(() => revoke(device.id));
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
        padding: child ? "10px 16px 10px 38px" : "12px 16px",
        borderBottom: last ? "none" : "1px solid var(--color-border)",
        opacity: revoked ? 0.55 : 1,
      }}
    >
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontFamily: mono, fontSize: child ? 12.5 : 13.5, color: "var(--color-text)", textDecoration: revoked ? "line-through" : "none" }}>
          {child && <span aria-hidden style={{ color: "var(--color-text-muted)" }}>↳ </span>}
          {device.name}
        </div>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3, wordBreak: "break-word" }}>{device.scopes.join(" · ")}</div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 2, fontVariantNumeric: "tabular-nums" }}>
        <span>created</span>
        <span>{when(device.createdAt)}</span>
        <span>last seen</span>
        <span>{when(device.lastSeenAt)}</span>
        {revoked && (
          <>
            <span>revoked</span>
            <span>{when(device.revokedAt)}</span>
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
            aria-label={`Revoke ${device.name}`}
            style={{ fontFamily: mono, fontSize: 12, color: "var(--color-over)", background: "none", border: "1px solid currentColor", borderRadius: "var(--radius)", padding: "5px 10px", cursor: "pointer" }}
          >
            {pending ? "…" : "revoke"}
          </button>
        )}
      </div>
    </div>
  );
}
