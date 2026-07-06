import { barState, targetCaption, type TrackTargets } from "./macro-state";
import { Track } from "./Track";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * One macro's value and its bar toward target(s) (UI-CONTRACT §3 MacroBar/MacroValue). Value in
 * mono tabular; a state word colored by the target-state rules; the shared Track; a target caption.
 * Units are display-only.
 */
export function MacroBar({
  label,
  value,
  targets,
  unit,
}: {
  label: string;
  value: number;
  targets: TrackTargets;
  unit: "g" | "kcal";
}) {
  const state = barState(value, targets);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.04em", color: state.color }}>
          {state.word}
        </span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 26,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-text)",
          }}
        >
          {fmt(value)}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-text-muted)", marginLeft: 3 }}>
          {unit}
        </span>
      </div>
      <Track value={value} targets={targets} color={state.color} height={8} />
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 8 }}>
        {targetCaption(targets, unit)}
      </div>
    </div>
  );
}
