import type { Kind, MacroSet } from "@/lib/macros/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Which target profile is in effect (UI-CONTRACT §3). A kind dot + kind name + a sub-line.
 * Unspecified shows the dual target; training/rest show their single target.
 */
export function TargetProfileBadge({
  kind,
  training,
  rest,
}: {
  kind: Kind;
  training?: MacroSet;
  rest?: MacroSet;
}) {
  const dot = kind === "training" ? "var(--color-warning)" : kind === "rest" ? "var(--color-success)" : "var(--color-accent)";
  const name = kind === "unspecified" ? "unspecified" : kind;

  let sub = "";
  if (kind === "unspecified") {
    const r = rest?.calories;
    const t = training?.calories;
    sub = `dual target · ${r != null ? fmt(r) : "—"} / ${t != null ? fmt(t) : "—"} kcal`;
  } else {
    const set = kind === "training" ? training : rest;
    const cal = set?.calories;
    const p = set?.proteinContent;
    sub = `${cal != null ? fmt(cal) : "—"} kcal${p != null ? ` · ${fmt(p)}g P` : ""}`;
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "10px 13px",
        background: kind === "unspecified" ? "var(--band)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "none" }} />
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
          {name}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 6 }}>
        {sub}
      </div>
    </div>
  );
}
