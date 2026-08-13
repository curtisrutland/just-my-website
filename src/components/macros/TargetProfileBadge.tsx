import type { MacroSet } from "@/lib/macros/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Which target profile is in effect (UI-CONTRACT §3): the profile's headline numbers, or an
 * explicit "no target" when none applies. One target per day — the kind dot and the dual-target
 * sub-line went with the retired day-type field.
 */
export function TargetProfileBadge({ target }: { target: MacroSet | null }) {
  const cal = target?.calories;
  const p = target?.proteinContent;
  const sub = target
    ? `${cal != null ? fmt(cal) : "—"} kcal${p != null ? ` · ${fmt(p)}g P` : ""}`
    : "none in effect";

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "10px 13px",
        background: target ? "transparent" : "var(--band)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: target ? "var(--color-accent)" : "var(--color-text-muted)",
            flex: "none",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-text)",
          }}
        >
          target
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 6 }}>
        {sub}
      </div>
    </div>
  );
}
