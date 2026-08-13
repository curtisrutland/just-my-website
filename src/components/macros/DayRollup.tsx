import { barState, scaleFor, targetFor, trackSummary } from "./macro-state";
import { MacroBar } from "./MacroBar";
import { TargetProfileBadge } from "./TargetProfileBadge";
import { Track } from "./Track";
import type { DayRollupData } from "@/lib/macros/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The elevated calorie hero: big total, the Track, target tick label, summary line. */
function CalorieHero({ value, target }: { value: number; target: number | null }) {
  const state = barState(value, target);
  const pos = scaleFor(value, target);

  return (
    <div style={{ marginTop: 22, marginBottom: 26 }}>
      <Track value={value} target={target} color={state.color} height={16} />
      {/* tick label */}
      <div style={{ position: "relative", height: 16, marginTop: 6 }}>
        {target != null && <Tick left={pos(target)} label={`TARGET ${fmt(target)}`} />}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: state.color, marginTop: 6 }}>
        {trackSummary(value, target)}
      </div>
    </div>
  );
}

function Tick({ left, label }: { left: number; label: string }) {
  return (
    <span
      style={{
        position: "absolute",
        left: `${left}%`,
        transform: "translateX(-50%)",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** The estimation surface — dotted-ring accent dot + "{pct}% estimated · {n} of {m} entries". */
function EstimationSurface({ fraction, count, estimated }: { fraction: number; count: number; estimated: number }) {
  const pct = Math.round(fraction * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          border: "1.5px dotted var(--color-accent)",
          flex: "none",
        }}
      />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-text-muted)" }}>
        <span style={{ color: "var(--color-text)" }}>{pct}%</span> estimated · {estimated} of {count} entries
      </span>
    </div>
  );
}

export function DayRollup({ rollup }: { rollup: DayRollupData }) {
  const { totals, estimation, target } = rollup;

  const macros: Array<{ label: string; key: "proteinContent" | "fatContent" | "carbohydrateContent" }> = [
    { label: "protein", key: "proteinContent" },
    { label: "fat", key: "fatContent" },
    { label: "carbs", key: "carbohydrateContent" },
  ];

  return (
    <div
      className="rollup-card"
      style={{
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderRadius: "calc(var(--radius) * 1.5)",
      }}
    >
      {/* header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "var(--color-text-muted)",
            }}
          >
            DAY ROLLUP
          </div>
          <div style={{ marginTop: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 52,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                color: "var(--color-text)",
              }}
            >
              {fmt(totals.calories ?? 0)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--color-text-muted)", marginLeft: 8 }}>
              kcal
            </span>
          </div>
          <EstimationSurface
            fraction={estimation.estimatedFraction}
            count={estimation.entryCount}
            estimated={estimation.estimatedCount}
          />
        </div>
        <TargetProfileBadge target={target} />
      </div>

      {/* signature calorie band — the hero */}
      <CalorieHero value={totals.calories ?? 0} target={targetFor(target, "calories")} />

      {/* macro grid */}
      <div className="macro-grid" style={{ display: "grid" }}>
        {macros.map((m) => (
          <MacroBar
            key={m.key}
            label={m.label}
            value={totals[m.key] ?? 0}
            target={targetFor(target, m.key)}
            unit="g"
          />
        ))}
      </div>
    </div>
  );
}
