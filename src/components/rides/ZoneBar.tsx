"use client";

import { useState } from "react";
import type { TimeInHrZone } from "@/lib/rides/types";
import { hms } from "./format";

const mono = "var(--font-mono)";

/**
 * The HR-zone histogram (Rides.dc.html §TIME IN HEART RATE ZONES): one segmented bar,
 * proportional to time, labeled by the bpm boundaries the DEVICE computed against (the message
 * is self-describing) — a muted single-hue ramp, never a green-to-red effort gauge. A histogram
 * of measurements, not a score.
 */
export function ZoneBar({ zoneData }: { zoneData: TimeInHrZone }) {
  const [hover, setHover] = useState<number | null>(null);

  const bounds = zoneData.hrZoneHighBoundary ?? [];
  const times = zoneData.timeInHrZone ?? [];
  const total = times.reduce((a, c) => a + c, 0) || 1;

  const live = times
    .map((sec, i) => ({
      i,
      sec,
      pct: (sec / total) * 100,
      label: i === 0 ? `<${bounds[0]}` : i > bounds.length - 1 ? `>${bounds[bounds.length - 1]}` : `${bounds[i - 1]}–${bounds[i]}`,
    }))
    .filter((z) => z.sec > 0);
  if (live.length === 0) return null;

  const shade = (k: number) => {
    const pctAccent = 14 + Math.round((k / Math.max(1, live.length - 1)) * 58);
    return `color-mix(in oklab, var(--color-accent) ${pctAccent}%, var(--color-surface-raised))`;
  };
  const hovered = live.find((z) => z.i === hover) ?? null;
  const readout = hovered
    ? `${hovered.label} bpm · ${hms(hovered.sec)} · ${Math.round(hovered.pct)}%`
    : `max ${zoneData.maxHeartRate ?? "—"} bpm · ${live.length} zones touched`;

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, paddingBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)", flex: "none" }}>
          TIME IN HEART RATE ZONES
        </span>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
          {readout}
        </span>
      </div>
      <div onMouseLeave={() => setHover(null)} style={{ display: "flex", gap: 1, height: 26, borderRadius: 2, overflow: "hidden", background: "var(--color-border)" }}>
        {live.map((z, k) => (
          <div
            key={z.i}
            onMouseEnter={() => setHover(z.i)}
            onClick={() => setHover(hover === z.i ? null : z.i)}
            style={{
              flex: "0 0 auto",
              width: `${z.pct.toFixed(2)}%`,
              minWidth: 3,
              height: "100%",
              background: shade(k),
              opacity: hover == null || hover === z.i ? 1 : 0.45,
              cursor: "default",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 14px", marginTop: 10 }}>
        {live.map((z, k) => (
          <span key={z.i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, flex: "none", background: shade(k) }} />
            <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{z.label}</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>{hms(z.sec)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
