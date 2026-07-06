import { barState, resolveTargets, scaleFor, trackSummary, type TrackTargets } from "./macro-state";
import { MacroBar } from "./MacroBar";
import { TargetProfileBadge } from "./TargetProfileBadge";
import { Track } from "./Track";
import type { DayRollupData } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The elevated calorie hero: big total, the honest-corridor Track, tick labels, summary line. */
function CalorieHero({ value, targets }: { value: number; targets: TrackTargets }) {
  const state = barState(value, targets);
  const pos = scaleFor(value, targets);
  const dual = targets.rest != null && targets.train != null && targets.rest !== targets.train;

  return (
    <div style={{ marginTop: 22, marginBottom: 26 }}>
      <Track value={value} targets={targets} color={state.color} height={16} />
      {/* tick labels */}
      <div style={{ position: "relative", height: 16, marginTop: 6 }}>
        {dual ? (
          <>
            <Tick left={pos(targets.rest!)} label={`REST ${fmt(targets.rest!)}`} />
            <Tick left={pos(targets.train!)} label={`TRAIN ${fmt(targets.train!)}`} />
          </>
        ) : (
          targets.single != null && <Tick left={pos(targets.single)} label={`TARGET ${fmt(targets.single)}`} />
        )}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: state.color, marginTop: 6 }}>
        {trackSummary(value, targets, "kcal")}
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
  const { totals, estimation, targets, day } = rollup;
  const calorieTargets = resolveTargets(targets, "calories");

  const macros: Array<{ label: string; key: "proteinContent" | "fatContent" | "carbohydrateContent" }> = [
    { label: "protein", key: "proteinContent" },
    { label: "fat", key: "fatContent" },
    { label: "carbs", key: "carbohydrateContent" },
  ];

  return (
    <div
      style={{
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderRadius: "calc(var(--radius) * 1.5)",
        padding: 26,
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
        <TargetProfileBadge kind={day.kind} training={targets.training} rest={targets.rest} />
      </div>

      {/* signature calorie band — the hero */}
      <CalorieHero value={totals.calories ?? 0} targets={calorieTargets} />

      {/* macro grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
        {macros.map((m) => (
          <MacroBar
            key={m.key}
            label={m.label}
            value={totals[m.key] ?? 0}
            targets={resolveTargets(targets, m.key)}
            unit="g"
          />
        ))}
      </div>
    </div>
  );
}
