import type { WeightSummary } from "@/lib/weight/schema";
import { fmt1, trendDisplay, WINDOW_SUB, type WindowKey } from "./format";

/** Four mono stat tiles: current 7-day avg, trend, latest raw, range. */
export function WeightStats({ summary, window }: { summary: WeightSummary; window: WindowKey }) {
  const trend = trendDisplay(summary.trendPerWeek);
  const tp = summary.trendPerWeek;
  const trendValue = tp == null ? "—" : `${tp < 0 ? "−" : tp > 0 ? "+" : ""}${Math.abs(tp).toFixed(1)}`;
  const sub = WINDOW_SUB[window];

  const tiles = [
    { label: "7-DAY AVG", value: fmt1(summary.currentAvg), unit: "lb", color: "var(--color-text)", sub: "current trend value" },
    { label: "TREND", value: trendValue, unit: "lb/wk", color: trend.color, sub },
    { label: "LATEST RAW", value: fmt1(summary.current), unit: "lb", color: "var(--color-text)", sub: "most recent weigh-in" },
    {
      label: "RANGE",
      value: summary.range ? `${fmt1(summary.range.min)}–${fmt1(summary.range.max)}` : "—",
      unit: "lb",
      color: "var(--color-text)",
      sub,
    },
  ];

  return (
    <section className="stat-grid" style={{ display: "grid", gap: 12, marginTop: 16 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "14px 16px" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>{t.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 10 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", color: t.color }}>
              {t.value}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-muted)" }}>{t.unit}</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)", marginTop: 7 }}>{t.sub}</div>
        </div>
      ))}
    </section>
  );
}
