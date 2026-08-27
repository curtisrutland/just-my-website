import { DASH, fmt0, fmt1, hm, monthDay, weekday } from "./format";
import type { VitalsDayView } from "@/lib/vitals/types";

type Col = {
  key: string;
  head: string;
  unit?: string;
  get: (d: VitalsDayView) => string;
  measured: (d: VitalsDayView) => boolean;
};

type Group = { label: string; cols: Col[] };

/**
 * Column groups. Order follows the model doc: sleep, heart, breathing, movement.
 *
 * Every cell routes through `fmt*`/`hm`, which render `null` as an em-dash — a day the watch was
 * not worn must never read as a measured zero. `measured` drives the muted styling and the title,
 * so an absence is visibly different from a value, not just textually.
 */
const GROUPS: Group[] = [
  {
    label: "sleep",
    cols: [
      { key: "sleep", head: "total", get: (d) => hm(d.sleepTotalSeconds), measured: (d) => d.sleepTotalSeconds != null },
      { key: "deep", head: "deep", get: (d) => hm(d.sleepDeepSeconds), measured: (d) => d.sleepDeepSeconds != null },
      { key: "rem", head: "rem", get: (d) => hm(d.sleepRemSeconds), measured: (d) => d.sleepRemSeconds != null },
      { key: "awake", head: "awake", get: (d) => hm(d.sleepAwakeSeconds), measured: (d) => d.sleepAwakeSeconds != null },
    ],
  },
  {
    label: "heart",
    cols: [
      { key: "rhr", head: "resting", unit: "bpm", get: (d) => fmt0(d.restingHeartRate), measured: (d) => d.restingHeartRate != null },
      { key: "min", head: "min", unit: "bpm", get: (d) => fmt0(d.minHeartRate), measured: (d) => d.minHeartRate != null },
      { key: "max", head: "max", unit: "bpm", get: (d) => fmt0(d.maxHeartRate), measured: (d) => d.maxHeartRate != null },
      { key: "hrv", head: "hrv", unit: "ms", get: (d) => fmt0(d.hrvLastNightMs), measured: (d) => d.hrvLastNightMs != null },
    ],
  },
  {
    label: "breathing",
    cols: [
      { key: "spo2", head: "spo₂ avg", unit: "%", get: (d) => fmt0(d.spo2Avg), measured: (d) => d.spo2Avg != null },
      { key: "spo2low", head: "spo₂ low", unit: "%", get: (d) => fmt0(d.spo2Low), measured: (d) => d.spo2Low != null },
      { key: "resp", head: "resp", unit: "br/min", get: (d) => fmt1(d.respirationWakingAvg), measured: (d) => d.respirationWakingAvg != null },
    ],
  },
  {
    label: "movement",
    cols: [
      { key: "steps", head: "steps", get: (d) => (d.steps == null ? DASH : d.steps.toLocaleString()), measured: (d) => d.steps != null },
      { key: "floors", head: "floors", get: (d) => fmt0(d.floorsAscended), measured: (d) => d.floorsAscended != null },
      { key: "im", head: "intensity", unit: "min", get: (d) => {
          const mod = d.intensityMinutesModerate;
          const vig = d.intensityMinutesVigorous;
          return mod == null && vig == null ? DASH : `${mod ?? 0}/${vig ?? 0}`;
        }, measured: (d) => d.intensityMinutesModerate != null || d.intensityMinutesVigorous != null },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.cols);
const mono = "var(--font-mono)";

/**
 * The module's centre of gravity: a dated table of measurements. No hero, no score, no grade —
 * the restraint is the signature (docs/vitals-model.md).
 *
 * 14 columns is a lot, so the table scrolls horizontally inside its own container rather than
 * squeezing; at <=768px `.vitals-table` swaps to stacked per-day cards (globals.css), because a
 * 14-column grid on a phone is a spreadsheet, not a reading.
 */
export function VitalsTable({ days }: { days: VitalsDayView[] }) {
  if (days.length === 0) {
    return (
      <p style={{ fontFamily: mono, fontSize: 12, color: "var(--color-text-muted)" }}>
        No days recorded yet — the Garmin daemon has not pushed anything.
      </p>
    );
  }

  return (
    <div className="vitals-scroll" style={{ overflowX: "auto" }}>
      <table className="vitals-table" style={{ borderCollapse: "collapse", width: "100%", fontFamily: mono, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...headCell, textAlign: "left" }} />
            {GROUPS.map((g) => (
              <th
                key={g.label}
                colSpan={g.cols.length}
                style={{ ...headCell, textAlign: "left", color: "var(--color-accent)", letterSpacing: "0.12em", borderLeft: "1px solid var(--color-border)" }}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            <th style={{ ...headCell, textAlign: "left" }}>day</th>
            {GROUPS.flatMap((g) =>
              g.cols.map((c, i) => (
                <th key={c.key} style={{ ...headCell, borderLeft: i === 0 ? "1px solid var(--color-border)" : undefined }}>
                  {c.head}
                  {c.unit ? <span style={{ opacity: 0.6 }}> {c.unit}</span> : null}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.measuredOn} className="vitals-row">
              <td data-label="day" style={{ ...cell, textAlign: "left", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--color-text)" }}>{monthDay(d.measuredOn)}</span>{" "}
                <span style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>{weekday(d.measuredOn)}</span>
              </td>
              {ALL.map((c) => {
                const has = c.measured(d);
                return (
                  <td
                    key={c.key}
                    data-label={c.head}
                    title={has ? undefined : "not measured"}
                    style={{ ...cell, color: has ? "var(--color-text)" : "var(--color-text-muted)", opacity: has ? 1 : 0.45 }}
                  >
                    {c.get(d)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const headCell: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-muted)",
  textAlign: "right",
  padding: "6px 10px",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const cell: React.CSSProperties = {
  padding: "7px 10px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};
