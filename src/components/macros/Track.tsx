import { scaleFor } from "./macro-state";

/**
 * The signature bar: a fill for the day's value plus an accent target tick. Shared by the calorie
 * hero (16px) and each MacroBar (8px). The dual "honest corridor" band this once drew belonged to
 * calorie cycling — retired with the day-type field, so there is one target to mark.
 */
export function Track({
  value,
  target,
  color,
  height,
}: {
  value: number;
  target: number | null;
  color: string;
  height: number;
}) {
  const pos = scaleFor(value, target);
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

      {/* target tick */}
      {target != null && (
        <div
          style={{
            position: "absolute",
            left: `${pos(target)}%`,
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
