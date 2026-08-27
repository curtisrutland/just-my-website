import { monthDay } from "./format";
import type { VitalsRollup } from "@/lib/vitals/types";

/**
 * The honest absence strip.
 *
 * A gap is stated as a fact and nothing more — never "you missed a day", never a completion
 * percentage (CONVENTIONS §9: absences are observations, never judgments). Two kinds are
 * distinguished because they mean different things: no row at all (the daemon has nothing for that
 * day) versus a row that measured nothing (the watch was off your wrist).
 */
export function VitalsGaps({ gaps, window }: { gaps: VitalsRollup["gaps"]; window: number }) {
  if (gaps.length === 0) {
    return (
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
        every day in the last {window} has measurements.
      </p>
    );
  }

  const noRow = gaps.filter((g) => g.reason === "no_row");
  const noMeasure = gaps.filter((g) => g.reason === "no_measurements");

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
      {noRow.length > 0 && (
        <p style={{ margin: 0 }}>
          {noRow.length} of {window} days have no data: {noRow.slice(0, 8).map((g) => monthDay(g.date)).join(", ")}
          {noRow.length > 8 ? ` +${noRow.length - 8} more` : ""}
        </p>
      )}
      {noMeasure.length > 0 && (
        <p style={{ margin: 0 }}>
          {noMeasure.length} {noMeasure.length === 1 ? "day has" : "days have"} a record but no measurements:{" "}
          {noMeasure.slice(0, 8).map((g) => monthDay(g.date)).join(", ")}
        </p>
      )}
    </div>
  );
}
