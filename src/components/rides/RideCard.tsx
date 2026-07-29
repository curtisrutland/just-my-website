import Link from "next/link";
import type { RideView } from "@/lib/rides/types";
import { mdShort, rideStatLine, rideTag, rideTitle } from "./format";

const mono = "var(--font-mono)";

/**
 * One ride card in the log (Rides.dc.html §ride card): title (name, else "MTB — Jul 28"),
 * local date + start time, the mono stat line (absent sensors simply don't appear), the sport
 * tag, and a one-line note snippet when there is one. Server-rendered link.
 */
export function RideCard({ r, localStart }: { r: RideView; localStart: string }) {
  return (
    <Link
      href={`/rides/${r.id}`}
      className="ride-card"
      style={{ display: "flex", flexDirection: "column", gap: 7, padding: "14px 16px", marginTop: 8, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", textDecoration: "none", color: "var(--color-text)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {rideTitle(r)}
        </span>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", flex: "none" }}>
          {mdShort(r.localDate)} · {localStart}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontFamily: mono, fontSize: 13, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
          {rideStatLine(r)}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: "var(--color-text-muted)", border: "1px solid var(--color-border)", borderRadius: 3, padding: "2px 6px", flex: "none" }}>
          {rideTag(r)}
        </span>
      </div>
      {r.note && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.note}
        </div>
      )}
    </Link>
  );
}
