import Link from "next/link";
import type { WeightPoint, WeightRollup } from "@/lib/weight/schema";
import { fmt1, monthDay, trendDisplay, WINDOW_LABEL, type WindowKey } from "./format";

const WINDOWS: WindowKey[] = ["30", "90", "365", "all"];

// SVG viewBox geometry (matches the design reference).
const VBW = 1000;
const VBH = 300;
const PAD = { l: 46, r: 14, t: 14, b: 30 };

type Geo = {
  gridLines: { y: number; label: number }[];
  areaPath: string;
  avgPath: string;
  dots: { cx: number; cy: number }[];
  curPt: { cx: number; cy: number } | null;
  xLabels: { x: number; label: string }[];
};

function chartGeometry(series: WeightPoint[]): Geo | null {
  const ix0 = PAD.l;
  const ix1 = VBW - PAD.r;
  const iy0 = PAD.t;
  const iy1 = VBH - PAD.b;

  const avgVals = series.map((p) => p.avg).filter((v): v is number => v != null);
  const rawVals = series.map((p) => p.weight).filter((v): v is number => v != null);
  const all = [...avgVals, ...rawVals];
  if (all.length === 0) return null;

  const domMin = Math.floor(Math.min(...all) - 0.5);
  const domMax = Math.ceil(Math.max(...all) + 0.5);
  const span = Math.max(1, domMax - domMin);
  const n = series.length;
  const xAt = (k: number) => (n <= 1 ? (ix0 + ix1) / 2 : ix0 + (k / (n - 1)) * (ix1 - ix0));
  const yAt = (w: number) => iy1 - ((w - domMin) / span) * (iy1 - iy0);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const gridLines = [0, 1, 2, 3].map((t) => {
    const wv = domMin + (t / 3) * span;
    return { y: r1(yAt(wv)), label: Math.round(wv) };
  });

  const avgKs = series.map((p, k) => ({ p, k })).filter((x) => x.p.avg != null);
  const avgPath = avgKs.map((x) => `${r1(xAt(x.k))},${r1(yAt(x.p.avg as number))}`).join(" ");
  const firstK = avgKs.length ? avgKs[0].k : 0;
  const lastK = avgKs.length ? avgKs[avgKs.length - 1].k : 0;
  const areaPath = avgKs.length ? `${avgPath} ${r1(xAt(lastK))},${iy1} ${r1(xAt(firstK))},${iy1}` : "";

  const dots = series
    .map((p, k) => (p.weight != null ? { cx: r1(xAt(k)), cy: r1(yAt(p.weight)) } : null))
    .filter((d): d is { cx: number; cy: number } => d != null);

  const curPt = avgKs.length ? { cx: r1(xAt(lastK)), cy: r1(yAt(series[lastK].avg as number)) } : null;

  const steps = Math.min(5, n);
  const xLabels = Array.from({ length: steps }, (_, s) => {
    const k = steps <= 1 ? 0 : Math.round((s / (steps - 1)) * (n - 1));
    return { x: r1(xAt(k)), label: monthDay(series[k].date) };
  });

  return { gridLines, areaPath, avgPath, dots, curPt, xLabels };
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "5px 11px",
    letterSpacing: "0.02em",
    textDecoration: "none",
    background: active ? "var(--color-accent)" : "var(--color-surface)",
    color: active ? "var(--color-bg)" : "var(--color-text-muted)",
    fontWeight: active ? 600 : 400,
  };
}

/** The hero: big 7-day average + trend, a window selector, and the daily-noise-vs-trend chart. */
export function WeightTrend({
  rollup,
  window,
  basePath,
}: {
  rollup: WeightRollup;
  window: WindowKey;
  basePath: string;
}) {
  const { summary, series } = rollup;
  const trend = trendDisplay(summary.trendPerWeek);
  const geo = chartGeometry(series);
  const label: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" };

  return (
    <section style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: "calc(var(--radius) * 1.5)", overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, padding: "22px 24px 18px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
        <div>
          <div style={{ ...label, marginBottom: 10 }}>
            7-DAY AVERAGE <span style={{ opacity: 0.55 }}>· THE TREND</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 52, fontWeight: 600, lineHeight: 0.9, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {fmt1(summary.currentAvg)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--color-text-muted)" }}>lb</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: trend.color, marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
              {trend.arrow} {trend.text}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-muted)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--color-text-muted)", opacity: 0.65 }} />
            <span>
              latest raw <span style={{ color: "var(--color-text)" }}>{fmt1(summary.current)} lb</span>
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>a single day is noise; the line is the truth</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>WINDOW</span>
          <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {WINDOWS.map((k) => (
              <Link key={k} href={`${basePath}?w=${k}`} style={segStyle(k === window)}>
                {WINDOW_LABEL[k]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* chart */}
      <div style={{ padding: "18px 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 6, paddingLeft: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 16, height: 2.5, background: "var(--color-accent)", borderRadius: 2 }} />7-day rolling avg
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-muted)" }} />daily weigh-in
          </span>
        </div>
        {geo ? (
          <svg viewBox={`0 0 ${VBW} ${VBH}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {geo.gridLines.map((g, i) => (
              <g key={i}>
                <line x1={PAD.l} y1={g.y} x2={VBW - PAD.r} y2={g.y} style={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                <text x={PAD.l - 8} y={g.y + 3.5} style={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--color-text-muted)", textAnchor: "end" }}>
                  {g.label}
                </text>
              </g>
            ))}
            {geo.areaPath && <polygon points={geo.areaPath} style={{ fill: "var(--band)", stroke: "none" }} />}
            <polyline points={geo.avgPath} style={{ fill: "none", stroke: "var(--color-accent)", strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
            {geo.dots.map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r={2.3} style={{ fill: "var(--color-text-muted)", opacity: 0.7 }} />
            ))}
            {geo.curPt && <circle cx={geo.curPt.cx} cy={geo.curPt.cy} r={4.5} style={{ fill: "var(--color-accent)", stroke: "var(--color-bg)", strokeWidth: 2 }} />}
            {geo.xLabels.map((x, i) => (
              <text key={i} x={x.x} y={VBH - PAD.b + 18} style={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--color-text-muted)", textAnchor: "middle" }}>
                {x.label}
              </text>
            ))}
          </svg>
        ) : (
          <div style={{ padding: "40px 0", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--color-text-muted)" }}>
            No weigh-ins yet — log one above to start the trend.
          </div>
        )}
      </div>
    </section>
  );
}
