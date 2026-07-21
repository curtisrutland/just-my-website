import Link from "next/link";
import type { SessionSummary } from "@/lib/lifting/types";
import { dateLine, fmtVolume, fmtWeight } from "./format";

const mono = "var(--font-mono)";

/** A journal session card (server-rendered link). Journal always shows whole `lb`. */
export function JournalCard({ s }: { s: SessionSummary }) {
  const a = s.annotation;
  const snip = a.interpretation ? truncate(a.interpretation, 104) : null;
  const stats = [
    { value: fmtVolume(s.derived.tonnageKg, "lb"), label: "lb vol" },
    { value: fmtWeight(s.derived.topE1rmKg, "lb") ?? "—", label: "top e1RM" },
    { value: String(s.derived.durationMin ?? "—"), label: "min" },
  ];
  return (
    <Link
      href={`/lifting/${s.id}`}
      className="lift-card"
      style={{ display: "block", textDecoration: "none", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "calc(var(--radius) * 1.5)", background: "var(--color-surface)", padding: "18px 20px" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.title ?? "Untitled session"}</span>
            {a.focus && <span style={focusChip}>{a.focus}</span>}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 6, letterSpacing: "0.04em" }}>{dateLine(s.startedAt)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          {s.derived.prs.length > 0 && (
            <span style={{ whiteSpace: "nowrap", fontFamily: mono, fontSize: 9.5, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 3, border: "1px solid var(--color-accent)", color: "var(--color-accent)" }}>
              ◆ {s.derived.prs.length} PR{s.derived.prs.length > 1 ? "s" : ""}
            </span>
          )}
          {!a.interpreted && (
            <span style={{ whiteSpace: "nowrap", fontFamily: mono, fontSize: 9.5, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 3, border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>◦ needs read</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
        {stats.map((st) => (
          <div key={st.label} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{st.value}</span>
            <span style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>{st.label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>QUALITY</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} style={pip(a.quality != null && n <= a.quality)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--color-border)" }}>
        {snip ? (
          <div style={{ display: "flex", gap: 11 }}>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: "var(--color-text-muted)", paddingTop: 3, flex: "none" }}>READ</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.55, color: "var(--color-text)", opacity: 0.86 }}>{snip}</span>
          </div>
        ) : (
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>no interpretation yet — awaiting Claude&apos;s read</span>
        )}
      </div>
    </Link>
  );
}

const focusChip: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 9.5,
  letterSpacing: "0.06em",
  padding: "2px 7px",
  borderRadius: 3,
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};

function pip(filled: boolean): React.CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flex: "none",
    background: filled ? "var(--color-accent)" : "transparent",
    border: "1px solid " + (filled ? "var(--color-accent)" : "var(--color-border)"),
  };
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n).replace(/\s+\S*$/, "") + "…";
}
