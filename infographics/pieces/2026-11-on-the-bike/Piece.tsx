import { scaleLinear } from "d3-scale";
import type { CSSProperties, ReactNode } from "react";
import { useVideoConfig } from "remotion";
import { pieceCompositions, type PieceProps } from "../../src/kit/compose";
import { FONT } from "../../src/kit/fonts";
import { CATEGORICAL, mix } from "../../src/kit/palette";
import { Stage } from "../../src/kit/Stage";
import { dark } from "../../src/kit/theme";
import { ft, hms, hours, mdShort, mi } from "../../src/kit/units";
import type { RideType, Snapshot } from "./data";

const PIECE = "2026-11-on-the-bike";
const theme = dark;

// A ride type wears its bike's colour (src/kit/palette.ts).
const TYPE_COLOUR: Record<RideType, string> = { MTB: CATEGORICAL[0], "Gravel/Road": CATEGORICAL[1], BMX: CATEGORICAL[3] };
const TYPE_ORDER: RideType[] = ["MTB", "Gravel/Road", "BMX"];

// Six zone segments, low to high, as steps of one hue: dim is easy, bright is hard.
const ZONE_STEPS = [0.14, 0.26, 0.4, 0.56, 0.8, 1];
const ZONE_NAMES = ["below zone 1", "zone 1", "zone 2", "zone 3", "zone 4", "zone 5"];
const zoneColour = (colour: string, zone: number) => mix(colour, theme.surfaceRaised, ZONE_STEPS[zone]);

const percent = (share: number) => `${Math.round(share * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Layout({ data }: { data: Snapshot }) {
  const { width, height } = useVideoConfig();
  const u = width / 1080;
  const pad = 64 * u;
  const inner = width - 2 * pad;

  const mono: CSSProperties = { fontFamily: FONT.mono };
  const label: CSSProperties = { ...mono, fontSize: 17 * u, letterSpacing: 1.6 * u, color: theme.textMuted };
  const fine: CSSProperties = { ...mono, fontSize: 17 * u, color: theme.textMuted };
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <div style={{ ...label, marginBottom: 14 * u }}>{title}</div>
      {children}
    </div>
  );

  const { totals, types, weeks, rides, records, zones, excluded } = data;

  // --- By kind of bike: one bar per type, as long as its hours, cut into zones. ---
  const labelWidth = 356 * u;
  const barWidth = inner - labelWidth;
  const hoursScale = scaleLinear().domain([0, Math.max(...types.map((t) => t.movingSeconds))]).range([0, barWidth]);
  const gap = 2 * u;

  // --- Sixteen weeks: hours a week, stacked by type. ---
  const weekChart = { h: 150 * u, axis: 54 * u };
  const weekTotal = (w: Snapshot["weeks"][number]) => TYPE_ORDER.reduce((sum, t) => sum + w.seconds[t], 0);
  const biggest = weeks.reduce((best, w) => (weekTotal(w) > weekTotal(best) ? w : best));
  const weekY = scaleLinear().domain([0, Math.ceil((weekTotal(biggest) / 3600) * 1.3 / 2) * 2]).range([weekChart.h, 0]); // hours, with room for the label
  // Gridlines every 4 h, none above the tallest bar: that space belongs to its label.
  const weekTicks = Array.from({ length: Math.floor(weekTotal(biggest) / 3600 / 4) }, (_, i) => (i + 1) * 4);
  const weekStep = (inner - weekChart.axis) / weeks.length;
  const weekBar = weekStep * 0.66;

  // --- Every ride: one mark each, as tall as its share at zone 4 or above. ---
  const rideChart = { h: 84 * u, axis: 54 * u };
  const rideStep = (inner - rideChart.axis) / rides.length;

  return (
    <div style={{ position: "absolute", inset: 0, padding: pad, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      {/* Title */}
      <div>
        <div style={label}>{`${mdShort(data.window.start)} – ${mdShort(data.window.end)}, ${data.window.end.slice(0, 4)}  ·  ${weeks.length} weeks`.toUpperCase()}</div>
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 96 * u, lineHeight: 1.05, marginTop: 6 * u }}>On the bike</div>
        <div style={{ fontSize: 26 * u, color: theme.textMuted, marginTop: 6 * u }}>
          {plural(totals.rides, "ride")} on {plural(totals.rideDays, "day")}
        </div>
      </div>

      {/* The headline numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.15fr 1.15fr", columnGap: 20 * u }}>
        {[
          [hours(totals.movingSeconds), "HOURS RIDING"],
          [mi(totals.distanceMeters), "MILES"],
          [ft(totals.ascentMeters), "FEET CLIMBED"],
          [hours(totals.hardSeconds), "HOURS AT ZONE 4+"],
        ].map(([value, name]) => (
          <div key={name}>
            <div style={{ ...mono, fontWeight: 500, fontSize: 62 * u, lineHeight: 1.05 }}>{value}</div>
            <div style={{ ...label, marginTop: 8 * u }}>{name}</div>
          </div>
        ))}
      </div>

      {/* By kind of bike */}
      <Section title="BY KIND OF BIKE  ·  BAR LENGTH IS HOURS, SHADING IS HEART-RATE ZONE">
        <div style={{ display: "flex", flexDirection: "column", gap: 22 * u }}>
          {types.map((type) => {
            const colour = TYPE_COLOUR[type.type];
            const zoneTotal = type.zoneSeconds.reduce((a, b) => a + b, 0) || 1;
            const length = hoursScale(type.movingSeconds);
            return (
              <div key={type.type} style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ width: labelWidth, flex: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 * u, fontFamily: FONT.display, fontWeight: 600, fontSize: 34 * u, lineHeight: 1.1 }}>
                    <span style={{ width: 16 * u, height: 16 * u, background: colour, flex: "none" }} />
                    {type.type}
                  </div>
                  <div style={{ ...fine, color: theme.text, marginTop: 8 * u }}>
                    {plural(type.rides, "ride")} · {mi(type.distanceMeters)} mi · {ft(type.ascentMeters)} ft
                  </div>
                  <div style={{ ...fine, marginTop: 4 * u }}>{type.bikes.map((b) => `${b.name} × ${b.rides}`).join("  ·  ")}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...mono, fontSize: 22 * u, whiteSpace: "nowrap" }}>
                    {hours(type.movingSeconds)} h
                    <span style={{ color: theme.textMuted, fontSize: 17 * u }}>{`   ${percent(type.hardSeconds / zoneTotal)} of it at zone 4 or above`}</span>
                  </div>
                  <div style={{ display: "flex", gap, width: length, height: 40 * u, marginTop: 10 * u }}>
                    {type.zoneSeconds.map((seconds, zone) =>
                      seconds > 0 ? <div key={zone} style={{ flex: `${seconds} 0 0`, background: zoneColour(colour, zone) }} /> : null
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ ...fine, display: "flex", alignItems: "center", gap: 18 * u, marginTop: 20 * u, marginLeft: labelWidth, whiteSpace: "nowrap" }}>
          {ZONE_NAMES.map((name, zone) => (
            <span key={name} style={{ display: "flex", alignItems: "center", gap: 7 * u }}>
              <span style={{ width: 14 * u, height: 14 * u, background: zoneColour(theme.text, zone) }} />
              {zone === 0 ? "below" : zone === 5 ? "5" : zone === 1 ? "zone 1" : String(zone)}
            </span>
          ))}
        </div>
      </Section>

      {/* Sixteen weeks */}
      <Section title={`${weeks.length} WEEKS  ·  HOURS RIDING EACH WEEK`}>
        <svg width={inner} height={weekChart.h + 30 * u} style={{ display: "block", overflow: "visible" }}>
          {weekTicks.map((t) => (
            <g key={t}>
              <line x1={weekChart.axis} x2={inner} y1={weekY(t)} y2={weekY(t)} stroke={theme.border} strokeWidth={1 * u} />
              <text x={weekChart.axis - 12 * u} y={weekY(t)} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={16 * u}>
                {`${t} h`}
              </text>
            </g>
          ))}
          <line x1={weekChart.axis} x2={inner} y1={weekChart.h} y2={weekChart.h} stroke={theme.textMuted} strokeWidth={1 * u} />
          {weeks.map((week, i) => {
            const x = weekChart.axis + i * weekStep + (weekStep - weekBar) / 2;
            let below = 0;
            const firstOfMonth = i === 0 || week.start.slice(5, 7) !== weeks[i - 1].start.slice(5, 7);
            return (
              <g key={week.start}>
                {TYPE_ORDER.map((type) => {
                  const seconds = week.seconds[type];
                  if (seconds <= 0) return null;
                  const y = weekY((below + seconds) / 3600);
                  const h = weekY(below / 3600) - y;
                  below += seconds;
                  return <rect key={type} x={x} y={y} width={weekBar} height={Math.max(0, h - gap)} fill={TYPE_COLOUR[type]} />;
                })}
                {firstOfMonth ? (
                  <text x={x} y={weekChart.h + 24 * u} fill={theme.textMuted} fontFamily={FONT.mono} fontSize={16 * u}>
                    {MONTH[Number(week.start.slice(5, 7)) - 1]}
                  </text>
                ) : null}
                {week === biggest
                  ? (() => {
                      // Named, and tied to its bar by a short line, so it cannot read as a stray caption.
                      const top = weekY(weekTotal(week) / 3600);
                      const side = i < weeks.length * 0.3 ? "start" : i > weeks.length * 0.7 ? "end" : "middle";
                      const textX = side === "start" ? x : side === "end" ? x + weekBar : x + weekBar / 2;
                      return (
                        <g>
                          <line x1={x + weekBar / 2} x2={x + weekBar / 2} y1={top - 4 * u} y2={top - 16 * u} stroke={theme.text} strokeWidth={1.5 * u} />
                          <text x={textX} y={top - 24 * u} textAnchor={side} fontFamily={FONT.mono} fontSize={17 * u} stroke={theme.bg} strokeWidth={6 * u} paintOrder="stroke" strokeLinejoin="round">
                            <tspan fill={theme.textMuted} letterSpacing={1.4 * u}>BIGGEST WEEK</tspan>
                            <tspan fill={theme.text} dx={12 * u}>{`${hours(weekTotal(week))} h · ${plural(week.rides, "ride")} · ${mi(week.distanceMeters)} mi`}</tspan>
                          </text>
                        </g>
                      );
                    })()
                  : null}
              </g>
            );
          })}
        </svg>
      </Section>

      {/* Every ride */}
      <Section title="EVERY RIDE, IN ORDER  ·  HOW MUCH OF IT WAS AT ZONE 4 OR ABOVE">
        <svg width={inner} height={rideChart.h} style={{ display: "block", overflow: "visible" }}>
          {[0.5, 1].map((share) => (
            <g key={share}>
              <line x1={rideChart.axis} x2={inner} y1={rideChart.h * (1 - share)} y2={rideChart.h * (1 - share)} stroke={theme.border} strokeWidth={1 * u} />
              <text x={rideChart.axis - 12 * u} y={rideChart.h * (1 - share)} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={16 * u}>
                {share === 1 ? "all" : "half"}
              </text>
            </g>
          ))}
          <line x1={rideChart.axis} x2={inner} y1={rideChart.h} y2={rideChart.h} stroke={theme.textMuted} strokeWidth={1 * u} />
          {rides.map((ride, i) => {
            const h = Math.max(2 * u, ride.hardShare * rideChart.h);
            return <rect key={i} x={rideChart.axis + i * rideStep + gap / 2} y={rideChart.h - h} width={rideStep - gap} height={h} fill={TYPE_COLOUR[ride.type]} />;
          })}
        </svg>
      </Section>

      {/* Records, and what is not here */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24 * u }}>
          {[
            ["LONGEST RIDE", `${mi(records.longestDistance.distanceMeters)} mi`, records.longestDistance],
            ["LONGEST TIME RIDING", hms(records.longestTime.movingSeconds), records.longestTime],
            ["MOST CLIMBING", `${ft(records.mostAscent.ascentMeters)} ft`, records.mostAscent],
          ].map(([name, value, ride]) => (
            <div key={name as string}>
              <div style={label}>{name as string}</div>
              <div style={{ ...mono, fontWeight: 500, fontSize: 32 * u, marginTop: 6 * u }}>{value as string}</div>
              <div style={{ ...fine, marginTop: 4 * u }}>{`${(ride as { bike: string }).bike} · ${mdShort((ride as { date: string }).date)}`}</div>
            </div>
          ))}
        </div>
        <div style={{ ...mono, fontSize: 14.5 * u, lineHeight: 1.5, color: theme.textMuted, marginTop: 26 * u, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 40 * u }}>
          <div>
            {excluded.length > 0
              ? `${plural(excluded.length, "ride")} left out (${excluded.map((e) => mdShort(e.date)).join(", ")}): ${excluded[0].why}. `
              : ""}
            Top speed and calories are not shown. Zones are the watch's own, set from its max heart rate ({zones.maxHeartRate[0]}–{zones.maxHeartRate[1]} bpm over these weeks), so zone 4 began at {zones.zone4From[0]}–{zones.zone4From[1]} bpm; zone 5 includes time above the max.
          </div>
          <div style={{ flex: "none" }}>justmy.website</div>
        </div>
      </div>
    </div>
  );
}

function OnTheBike(_: PieceProps) {
  return <Stage<Snapshot> piece={PIECE}>{(data) => <Layout data={data} />}</Stage>;
}

export const onTheBike = pieceCompositions({ slug: "on-the-bike", component: OnTheBike, variants: [{ format: "poster" }] });
