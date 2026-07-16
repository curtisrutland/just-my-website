import type { PanelHealth } from "@/lib/panel/types";
import { DayTypeToggle } from "./DayTypeToggle";
import { SectionHeader } from "./SectionHeader";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const TZ = process.env.JMW_TZ || "America/Chicago";

/** Macro color = "attention in the direction that matters" (contract §11.4). Number + bar share a
 *  state color: the protein FLOOR is NEUTRAL while short (no nag) and success-green once reached; a
 *  CEILING is neutral under the line and amber once over. Amber is the only attention color, and only
 *  a ceiling can be over — protein never shows amber. (Protein's "clear second" emphasis is size, not
 *  color.) */
function macroColors(kind: "floor" | "ceiling", consumed: number, target: number, remaining: number): { num: string; bar: string } {
  if (kind === "floor") {
    const met = consumed >= target;
    return { num: met ? "var(--p-success)" : "var(--p-text)", bar: met ? "var(--p-success)" : "var(--p-muted)" };
  }
  const over = remaining < 0;
  return { num: over ? "var(--p-warn)" : "var(--p-text)", bar: over ? "var(--p-warn)" : "var(--p-muted)" };
}

function MacroCard({
  label,
  kind,
  consumed,
  target,
  remaining,
  emphasis = false,
}: {
  label: string;
  kind: "floor" | "ceiling";
  consumed: number;
  target: number;
  remaining: number;
  emphasis?: boolean;
}) {
  const { num, bar } = macroColors(kind, consumed, target, remaining);
  const pct = target > 0 ? Math.max(0, Math.min(100, (consumed / target) * 100)) : 0;
  return (
    <div style={{ padding: "20px 18px", border: `1px solid ${emphasis ? "rgba(58,208,214,0.35)" : "var(--p-border)"}`, borderRadius: 8, background: "var(--p-surf)" }}>
      <div className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.14em", color: "var(--p-muted)", marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="p-mono" style={{ fontWeight: 600, fontSize: emphasis ? 48 : 38, lineHeight: 1, letterSpacing: "-0.01em", color: num }}>
          {fmt(consumed)}
        </span>
        <span className="p-mono" style={{ fontSize: 15, color: "var(--p-muted)" }}>g</span>
      </div>
      <div className="p-mono" style={{ fontSize: "var(--p-micro)", color: "var(--p-faint)", marginTop: 8 }}>
        of {fmt(target)}g
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "var(--p-border)", marginTop: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: bar }} />
      </div>
    </div>
  );
}

function Sparkline({ series }: { series: PanelHealth["weight"]["series"] }) {
  const pts = series.map((p, i) => ({ i, avg: p.avg })).filter((p): p is { i: number; avg: number } => p.avg != null);
  if (pts.length < 2) return null;
  const W = 640;
  const H = 132;
  const padY = 14;
  const n = series.length;
  const avgs = pts.map((p) => p.avg);
  const lo = Math.min(...avgs) - 0.4;
  const hi = Math.max(...avgs) + 0.4;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (a: number) => padY + (1 - (a - lo) / (hi - lo || 1)) * (H - padY * 2);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} ${x(last.i).toFixed(1)},${H} ${x(pts[0].i).toFixed(1)},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 132, display: "block" }}>
      <polygon points={area} style={{ fill: "rgba(58,208,214,0.10)", stroke: "none" }} />
      <polyline points={line} style={{ fill: "none", stroke: "var(--p-accent)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" }} />
      <circle cx={x(last.i)} cy={y(last.avg)} r={6} style={{ fill: "var(--p-accent)" }} />
    </svg>
  );
}

export function HealthScreen({ data, renderedAt }: { data: PanelHealth; renderedAt: number }) {
  const { macros, weight } = data;
  const over = macros.remaining.kcal < 0;
  const eaten =
    macros.consumed.kcal === 0
      ? `nothing logged yet · ${fmt(macros.target.kcal)} target`
      : `${fmt(macros.consumed.kcal)} of ${fmt(macros.target.kcal)} eaten`;

  const t = weight.trend;
  const trendColor = t === "down" ? "var(--p-success)" : t === "up" ? "var(--p-warn)" : "var(--p-muted)";
  const trendArrow = t === "down" ? "↓" : t === "up" ? "↑" : "→";
  const latestTime = weight.latest
    ? new Date(weight.latest.loggedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
    : null;

  return (
    <div className="p-scroll">
      <SectionHeader label="HEALTH" renderedAt={renderedAt} />

      <div style={{ padding: "34px 36px 0" }}>
        <DayTypeToggle initial={data.dayType} />

        <div className="p-mono" style={{ fontSize: "var(--p-label)", letterSpacing: "0.18em", color: "var(--p-muted)", marginBottom: 6 }}>
          {over ? "OVER TARGET" : "REMAINING"}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <span className="p-mono" style={{ fontWeight: 700, fontSize: "var(--p-hero)", lineHeight: 0.86, letterSpacing: "-0.03em", color: over ? "var(--p-warn)" : "var(--p-accent)" }}>
            {fmt(Math.abs(macros.remaining.kcal))}
          </span>
          <span className="p-mono" style={{ fontSize: 28, color: "var(--p-muted)" }}>kcal</span>
          {over && (
            <span className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.14em", color: "var(--p-warn)", border: "1px solid var(--p-warn)", borderRadius: 4, padding: "4px 8px", alignSelf: "center" }}>
              OVER
            </span>
          )}
        </div>
        <div className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-muted)", marginTop: 14 }}>
          {eaten}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, padding: "34px 36px 0" }}>
        <MacroCard label="PROTEIN" kind="floor" emphasis consumed={macros.consumed.protein} target={macros.target.protein} remaining={macros.remaining.protein} />
        <MacroCard label="FAT" kind="ceiling" consumed={macros.consumed.fat} target={macros.target.fat} remaining={macros.remaining.fat} />
        <MacroCard label="CARB" kind="ceiling" consumed={macros.consumed.carb} target={macros.target.carb} remaining={macros.remaining.carb} />
      </div>

      <div className="p-card" style={{ margin: "44px 36px", padding: "28px 30px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span className="p-mono" style={{ fontSize: "var(--p-micro)", letterSpacing: "0.16em", color: "var(--p-muted)" }}>WEIGHT · 7-DAY AVG</span>
          <span className="p-mono" style={{ fontSize: "var(--p-micro)", color: "var(--p-faint)" }}>last {weight.windowDays} days</span>
        </div>

        {weight.rollingAvg7 != null ? (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 22 }}>
              <span className="p-mono" style={{ fontWeight: 600, fontSize: "var(--p-num-lg)", lineHeight: 1 }}>{weight.rollingAvg7}</span>
              <span className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-muted)" }}>lb</span>
              {weight.trendPerWeek != null && t != null && (
                <span className="p-mono" style={{ fontSize: "var(--p-body-sm)", fontWeight: 600, color: trendColor, marginLeft: 4 }}>
                  {trendArrow} {Math.abs(weight.trendPerWeek).toFixed(1)} lb/wk
                </span>
              )}
            </div>
            <Sparkline series={weight.series} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
              <span className="p-mono" style={{ fontSize: "var(--p-micro)", color: "var(--p-faint)" }}>
                {weight.latest ? (
                  <>
                    latest raw <span style={{ color: "var(--p-muted)" }}>{weight.latest.value} lb</span> · {latestTime}
                  </>
                ) : (
                  "no raw reading"
                )}
              </span>
              {weight.range && (
                <span className="p-mono" style={{ fontSize: "var(--p-micro)", color: "var(--p-faint)" }}>
                  range {weight.range.min.toFixed(1)}–{weight.range.max.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="p-mono" style={{ fontSize: "var(--p-body-sm)", color: "var(--p-faint)", padding: "18px 0" }}>— not enough readings yet</div>
        )}
      </div>
    </div>
  );
}
