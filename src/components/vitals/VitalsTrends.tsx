import { deltaText, fmt0, hm, WINDOW_LABEL, type WindowKey } from "./format";
import { VitalsSparkline } from "./VitalsSparkline";
import type { VitalsRollup, VitalsTrend } from "@/lib/vitals/types";
import Link from "next/link";

const mono = "var(--font-mono)";

type Row = {
  key: keyof Pick<VitalsRollup, "restingHeartRate" | "hrvLastNightMs" | "sleepTotalSeconds">;
  label: string;
  unit: string;
  fmt: (n: number | null) => string;
  deltaUnit: string;
  deltaDigits?: number;
};

/**
 * The three metrics worth a trend. Deltas are week-over-week averages, never day-over-day: one
 * night's HRV or one morning's resting HR is noise, the same lesson the weight module learned.
 */
const ROWS: Row[] = [
  { key: "restingHeartRate", label: "resting heart rate", unit: "bpm", fmt: fmt0, deltaUnit: "bpm", deltaDigits: 1 },
  { key: "hrvLastNightMs", label: "hrv (last night)", unit: "ms", fmt: fmt0, deltaUnit: "ms", deltaDigits: 1 },
  { key: "sleepTotalSeconds", label: "sleep", unit: "", fmt: hm, deltaUnit: "min" },
];

/**
 * Three quiet trend rows — deliberately NOT a hero.
 *
 * Every delta renders in the neutral text color with no arrow-as-judgment and no green/red: a
 * resting HR that fell is not "good" and an HRV that rose is not "recovered". That framing is the
 * verdict the module exists to refuse. The number and its direction; nothing else.
 */
export function VitalsTrends({ rollup, window, basePath }: { rollup: VitalsRollup; window: WindowKey; basePath: string }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontFamily: mono, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-text-muted)", margin: 0 }}>
          trend · 7-day average
        </h2>
        <nav className="vitals-chips" style={{ display: "flex", gap: 6 }}>
          {(Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => (
            <Link
              key={k}
              href={`${basePath}?w=${k}`}
              style={{
                fontFamily: mono,
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: "var(--radius)",
                textDecoration: "none",
                border: "1px solid var(--color-border)",
                color: k === window ? "var(--color-bg)" : "var(--color-text-muted)",
                background: k === window ? "var(--color-accent)" : "transparent",
              }}
            >
              {WINDOW_LABEL[k]}
            </Link>
          ))}
        </nav>
      </header>

      {ROWS.map((r) => {
        const t: VitalsTrend = rollup[r.key];
        return (
          <div
            key={r.key}
            className="vitals-trend-row"
            style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {r.label}
              </span>
              <span style={{ fontFamily: mono, fontSize: 18, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                {r.fmt(t.currentAvg)}
                {r.unit ? <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}> {r.unit}</span> : null}
              </span>
            </div>
            <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {deltaText(
                r.key === "sleepTotalSeconds" && t.deltaPerWeek != null ? t.deltaPerWeek / 60 : t.deltaPerWeek,
                r.deltaUnit,
                r.deltaDigits
              )}{" "}
              vs last week
            </span>
            <VitalsSparkline series={t.series} label={r.label} />
          </div>
        );
      })}
    </section>
  );
}
