"use client";

import type { RideStreamView } from "@/lib/rides/types";
import { hms } from "./format";
import { nearestIndex } from "./playback";

const mono = "var(--font-mono)";
const FT = 3.280839895;
const MPH = 2.2369363;
const W = 900;
const H = 84;

/**
 * The effort charts (Rides.dc.html §charts): stacked small-multiples over the downsampled
 * stream, sharing one x-axis and one hover crosshair. Gap honesty is the point — a null bucket
 * (Garmin smart-recording dropout) breaks the path and stays open; nothing is interpolated.
 * Channel order and presence follow the data: elevation, HR, power, speed — absent channels
 * simply have no chart.
 */

type Spec = { key: string; label: string; unit: string; conv: (v: number) => number; dec: number; area?: boolean };

function specsFor(data: RideStreamView["data"]): Spec[] {
  const out: Spec[] = [];
  if (data.altitude) out.push({ key: "altitude", label: "ELEVATION", unit: "ft", conv: (v) => v * FT, dec: 0, area: true });
  if (data.heartRate) out.push({ key: "heartRate", label: "HEART RATE", unit: "bpm", conv: (v) => v, dec: 0 });
  if (data.power) out.push({ key: "power", label: "POWER", unit: "W", conv: (v) => v, dec: 0, area: true });
  if (data.speed) out.push({ key: "speed", label: "SPEED", unit: "mph", conv: (v) => v * MPH, dec: 1 });
  return out;
}

export function RideCharts({
  stream,
  displayT = null,
  onHover,
}: {
  stream: RideStreamView;
  /** The moment being shown (hover preview or the playback playhead), in ride seconds. */
  displayT?: number | null;
  /** Pointer preview: ride seconds under the pointer, or null on leave. */
  onHover?: (tSec: number | null) => void;
}) {
  const d = stream.data;
  const t = d.t;
  const N = t.length;
  const specs = specsFor(d);
  if (N < 2 || specs.length === 0) return null;
  const duration = t[N - 1] || 1;
  const hoverIdx = displayT == null ? null : nearestIndex(t, displayT);

  const fromPointer = (clientX: number, el: Element) => {
    const box = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    onHover?.(p * duration);
  };

  const charts = specs.map((sp) => {
    const vals = (d[sp.key] as (number | null)[]).map((v) => (v == null ? null : sp.conv(v)));
    const fin = vals.filter((v): v is number => v != null);
    const lo = Math.min(...fin);
    const up = Math.max(...fin);
    const pad = (up - lo) * 0.14 || 1;
    const y0 = lo - pad;
    const y1 = up + pad;
    const X = (i: number) => Math.round((t[i] / duration) * W * 10) / 10;
    const Y = (v: number) => Math.round((H - ((v - y0) / (y1 - y0)) * H) * 10) / 10;

    let line = "";
    let area = "";
    let open = false;
    let segX0 = 0;
    for (let i = 0; i < N; i++) {
      const v = vals[i];
      if (v == null) {
        // A gap stays a gap: close the current segment, never bridge it.
        if (open && sp.area) area += ` L ${X(i - 1)} ${H} L ${segX0} ${H} Z`;
        open = false;
        continue;
      }
      if (!open) {
        line += ` M ${X(i)} ${Y(v)}`;
        if (sp.area) {
          area += ` M ${X(i)} ${Y(v)}`;
          segX0 = X(i);
        }
        open = true;
      } else {
        line += ` L ${X(i)} ${Y(v)}`;
        if (sp.area) area += ` L ${X(i)} ${Y(v)}`;
      }
    }
    if (open && sp.area) area += ` L ${X(N - 1)} ${H} L ${segX0} ${H} Z`;

    const fm = (v: number | null) => (v == null ? "—" : sp.dec ? v.toFixed(sp.dec) : Math.round(v).toLocaleString("en-US"));
    const readout =
      hoverIdx != null && hoverIdx < N ? `${fm(vals[hoverIdx])} ${sp.unit}   ${hms(t[hoverIdx])}` : `${fm(lo)}–${fm(up)} ${sp.unit}`;
    return { key: sp.key, label: sp.label, line: line.trim(), area: area.trim(), readout };
  });

  const gaps = d.heartRate ? d.heartRate.filter((v) => v == null).length : 0;
  // The crosshair tracks displayT continuously (smooth during playback); readouts snap to the
  // nearest recorded bucket.
  const hoverX = displayT != null ? ((Math.min(Math.max(displayT, 0), duration) / duration) * W).toFixed(1) : "0";
  const ticks = [0, 1, 2, 3, 4].map((k) => hms((duration * k) / 4));

  return (
    <section style={{ marginTop: 30, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "4px 16px 12px" }}>
      <div
        onMouseMove={(e) => fromPointer(e.clientX, e.currentTarget)}
        onMouseLeave={() => onHover?.(null)}
        onTouchStart={(e) => fromPointer(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => fromPointer(e.touches[0].clientX, e.currentTarget)}
        onTouchEnd={() => onHover?.(null)}
        style={{ position: "relative", touchAction: "pan-y" }}
      >
        {charts.map((c) => (
          <div key={c.key} style={{ padding: "12px 0 4px", borderTop: "1px solid var(--color-border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
              <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)", flex: "none" }}>{c.label}</span>
              <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}>{c.readout}</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 84, display: "block" }}>
              <path d={c.area} fill="var(--band)" stroke="none" />
              <path d={c.line} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <line x1={hoverX} y1={0} x2={hoverX} y2={H} stroke={hoverIdx != null ? "var(--color-text-muted)" : "transparent"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--color-border)", paddingTop: 7, marginTop: 8 }}>
          {ticks.map((label, i) => (
            <span key={i} style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", paddingTop: 8 }}>
        {stream.resolutionSeconds} s buckets · {N} points
        {gaps > 0 ? ` · ${gaps * stream.resolutionSeconds} s not recorded (gap left open)` : ""}
      </div>
    </section>
  );
}
