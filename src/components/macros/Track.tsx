import { scaleFor, type TrackTargets } from "./macro-state";

/**
 * The signature bar. Single-target → a fill + an accent target tick. Dual-target → the "honest
 * corridor": a translucent band spanning rest→training with accent hairline edges, the day's
 * value filled beneath and marked with a text-colored line. Shared by the calorie hero (16px)
 * and each MacroBar (8px).
 */
export function Track({
  value,
  targets,
  color,
  height,
}: {
  value: number;
  targets: TrackTargets;
  color: string;
  height: number;
}) {
  const pos = scaleFor(value, targets);
  const dual = targets.rest != null && targets.train != null && targets.rest !== targets.train;
  const valuePos = pos(value);

  return (
    <div
      style={{
        position: "relative",
        height,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {dual &&
        (() => {
          const lo = Math.min(targets.rest!, targets.train!);
          const hi = Math.max(targets.rest!, targets.train!);
          const left = pos(lo);
          const width = pos(hi) - left;
          return (
            <div
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 0,
                bottom: 0,
                background: "var(--band)",
                borderLeft: "1px solid var(--color-accent)",
                borderRight: "1px solid var(--color-accent)",
              }}
            />
          );
        })()}

      {/* value fill */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${valuePos}%`,
          background: color,
          opacity: 0.85,
        }}
      />

      {/* single target tick */}
      {!dual && targets.single != null && (
        <div
          style={{
            position: "absolute",
            left: `${pos(targets.single)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--color-accent)",
          }}
        />
      )}

      {/* value marker */}
      <div
        style={{
          position: "absolute",
          left: `calc(${valuePos}% - 1px)`,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--color-text)",
        }}
      />
    </div>
  );
}
