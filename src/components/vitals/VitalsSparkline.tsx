import type { VitalsPoint } from "@/lib/vitals/types";

const W = 240;
const H = 34;
const PAD = 3;

/**
 * One metric's trend as a bare line — no axes, no labels, no score.
 *
 * **Gap honesty is the whole point**, and it is the same rule `RideCharts` follows for a dropped
 * stream bucket: a day with no measurement BREAKS the path and leaves it open. Nothing is
 * interpolated across a gap, because a line drawn through a day you did not wear the watch is a
 * measurement the watch never took.
 *
 * The raw points are drawn faintly and the 7-day average solid — a single day of resting HR or HRV
 * is noise, exactly as a single day's weight is.
 */
export function VitalsSparkline({ series, label }: { series: VitalsPoint[]; label: string }) {
  const vals = series.flatMap((p) => [p.value, p.avg]).filter((v): v is number => v != null);
  if (vals.length < 2) {
    return (
      <div style={{ width: W, height: H, display: "flex", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}>
        not enough data
      </div>
    );
  }

  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const n = series.length;
  const xAt = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
  const yAt = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  /** Build path segments, starting a new one after every gap. */
  const pathFor = (pick: (p: VitalsPoint) => number | null): string => {
    const out: string[] = [];
    let open = false;
    series.forEach((p, i) => {
      const v = pick(p);
      if (v == null) {
        open = false;
        return;
      }
      out.push(`${open ? "L" : "M"}${r1(xAt(i))} ${r1(yAt(v))}`);
      open = true;
    });
    return out.join(" ");
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`${label} trend, ${n} days`}
      style={{ display: "block", overflow: "visible" }}
    >
      <path d={pathFor((p) => p.value)} fill="none" stroke="var(--color-text-muted)" strokeWidth={1} opacity={0.45} />
      <path d={pathFor((p) => p.avg)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
