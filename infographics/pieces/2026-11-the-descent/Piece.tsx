import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { pieceCompositions, type PieceProps } from "../../src/kit/compose";
import { FONT } from "../../src/kit/fonts";
import { Stage } from "../../src/kit/Stage";
import { dark } from "../../src/kit/theme";
import { lb, mdShort, mi } from "../../src/kit/units";
import type { Snapshot } from "./data";

const PIECE = "2026-11-the-descent";
const theme = dark;

// One colour per bike, assigned in order of first ride so a bike keeps its colour as rides are
// added. Checked as a set on this background: every pair is told apart at a glance.
const BIKE_COLOURS = ["#3987e5", "#c98500", "#199e70", "#d55181"];

// The video's beats, in seconds (brief: Timeline).
const DRAW_FROM = 2;
const DRAW_TO = 20;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const minus = (n: number, text: string) => (n < 0 ? `−${text}` : text); // a true minus sign, as the site shows

function Layout({ data }: { data: Snapshot }) {
  const { width, height, durationInFrames, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const isVideo = durationInFrames > 1;
  const u = Math.min(width, height) / 1080;
  const stacked = width < 1400; // the card: the headline sits under the title, not beside it
  const days = data.window.days;

  // How many days are drawn so far (fractional), and how far the closing totals have faded in.
  const drawn = isVideo ? interpolate(frame, [DRAW_FROM * fps, DRAW_TO * fps], [0, days], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : days;
  const closing = isVideo ? interpolate(frame, [DRAW_TO * fps, (DRAW_TO + 0.8) * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;

  // Geometry. Nothing here depends on the frame.
  const g = useMemo(() => {
    const pad = 72 * u;
    const gutter = 78 * u; // room for the axis labels left of the plot
    const x0 = pad + gutter;
    const x1 = width - pad;
    const step = (x1 - x0) / days;
    const x = (day: number) => x0 + (day + 0.5) * step; // the centre of a day's column

    const top = (stacked ? 330 : 215) * u;
    const bottom = height - (stacked ? 262 : 196) * u; // room for the month labels and the totals
    const label = 34 * u; // the line of text above each band
    const gap = 22 * u;
    const ridesH = 38 * u;
    const proteinH = 14 * u;
    const headroom = 30 * u; // between the weight band's label and its plot, for the first weigh-in's label
    const rest = bottom - top - 3 * label - 2 * gap - ridesH - proteinH - 10 * u - headroom;
    const profileH = rest * 0.72;
    const foodH = rest * 0.28;

    const profile = { y: top + label + headroom, h: profileH };
    const food = { y: profile.y + profileH + gap + label, h: foodH };
    const protein = { y: food.y + foodH + 10 * u, h: proteinH };
    const rides = { y: protein.y + proteinH + gap + label, h: ridesH };

    const weights = data.weight.flatMap((d) => [d.weight, d.avg]).filter((v): v is number => v != null);
    const lo = Math.floor(Math.min(...weights) / 10) * 10;
    const hi = Math.ceil(Math.max(...weights) / 10) * 10;
    const y = scaleLinear().domain([lo, hi]).range([profile.y + profileH, profile.y]);
    const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10);

    const averaged = data.weight.map((d, i) => ({ i, avg: d.avg })).filter((d): d is { i: number; avg: number } => d.avg != null);
    const linePath = line<{ i: number; avg: number }>().x((d) => x(d.i)).y((d) => y(d.avg))(averaged) ?? "";
    const areaPath = area<{ i: number; avg: number }>().x((d) => x(d.i)).y0(profile.y + profileH).y1((d) => y(d.avg))(averaged) ?? "";

    // The food band: every bar is measured from that day's own target, which is the zero line.
    const deltas = data.food.map((d) => (d.calorieTarget == null || d.calories === 0 ? null : d.calories - d.calorieTarget));
    const over = Math.max(0, ...deltas.map((d) => d ?? 0));
    const under = Math.max(0, ...deltas.map((d) => -(d ?? 0)));
    const kcal = scaleLinear().domain([over, -under]).range([food.y, food.y + foodH]);

    const months = data.weight.map((d, i) => ({ i, date: d.date })).filter((d) => d.date.endsWith("-01"));
    const bikeColour = new Map(data.bikes.map((b, i) => [b.name, BIKE_COLOURS[i % BIKE_COLOURS.length]]));
    const ridesByDay = new Map<string, string[]>();
    for (const ride of data.rides) ridesByDay.set(ride.date, [...(ridesByDay.get(ride.date) ?? []), bikeColour.get(ride.bike ?? "") ?? theme.textMuted]);

    const kcalTicks = [500, -1000].filter((v) => v <= over && v >= -under);

    return { pad, x0, x1, step, x, profile, food, protein, rides, label, y, ticks, linePath, areaPath, deltas, kcal, kcalTicks, months, bikeColour, ridesByDay, averaged };
  }, [data, width, height, u, stacked, days]);

  // Where the rider is: the last fully drawn day, and the point part-way to the next.
  const dayIndex = Math.min(days - 1, Math.max(0, Math.ceil(drawn) - 1));
  const at = Math.max(0, Math.min(days - 1, drawn - 0.5));
  const a = g.averaged[Math.floor(at)];
  const b = g.averaged[Math.min(g.averaged.length - 1, Math.floor(at) + 1)];
  const f = at - Math.floor(at);
  const rider = { x: g.x(at), y: g.y(a.avg + (b.avg - a.avg) * f) };

  const today = data.weight[dayIndex];
  const { from, to, change } = data.totals.poundsDown;
  const fromIndex = data.weight.findIndex((d) => d.date === from.date);
  const downSoFar = drawn > 0 && dayIndex >= fromIndex && today.avg != null ? today.avg - from.avg : null;
  const finished = closing > 0;

  const mono = { fontFamily: FONT.mono } as const;
  const small = { ...mono, fontSize: 18 * u, letterSpacing: 1.5 * u, color: theme.textMuted } as const;
  const bandLabel = (y: number, text: string, detail?: string) => (
    <div style={{ ...small, position: "absolute", left: g.x0, right: g.pad, top: y - g.label, whiteSpace: "nowrap" }}>
      {text}
      {detail ? <span style={{ letterSpacing: 0.3 * u, color: theme.text, opacity: closing }}>{`  ·  ${detail}`}</span> : null}
    </div>
  );
  const barWidth = Math.max(2 * u, g.step * 0.58);
  const cellGap = Math.min(2 * u, g.step * 0.18);

  return (
    <>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="descent-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={theme.accent} stopOpacity={0.34} />
            <stop offset="1" stopColor={theme.accent} stopOpacity={0.03} />
          </linearGradient>
          <clipPath id="descent-drawn">
            <rect x={0} y={0} width={drawn >= days ? width : g.x0 + drawn * g.step} height={height} />
          </clipPath>
        </defs>

        {/* Axes and guides: always there, and quiet. */}
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={g.x0} x2={g.x1} y1={g.y(t)} y2={g.y(t)} stroke={theme.border} strokeWidth={1 * u} />
            <text x={g.x0 - 14 * u} y={g.y(t)} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={17 * u}>
              {t}
            </text>
          </g>
        ))}
        {g.months.map((m) => (
          <g key={m.date}>
            <line x1={g.x0 + m.i * g.step} x2={g.x0 + m.i * g.step} y1={g.profile.y} y2={g.rides.y + g.rides.h} stroke={theme.border} strokeWidth={1 * u} strokeDasharray={`${3 * u} ${6 * u}`} />
            <text x={g.x0 + m.i * g.step + 8 * u} y={g.rides.y + g.rides.h + 30 * u} fill={theme.textMuted} fontFamily={FONT.mono} fontSize={17 * u}>
              {MONTH[Number(m.date.slice(5, 7)) - 1]}
            </text>
          </g>
        ))}
        <line x1={g.x0} x2={g.x1} y1={g.kcal(0)} y2={g.kcal(0)} stroke={theme.textMuted} strokeWidth={1 * u} />
        <text x={g.x0 - 14 * u} y={g.kcal(0)} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={17 * u}>
          target
        </text>
        <text x={g.x0 - 14 * u} y={g.protein.y + g.protein.h / 2} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={15 * u}>
          protein
        </text>
        {g.kcalTicks.map((value) => (
          <g key={value}>
            <line x1={g.x0} x2={g.x1} y1={g.kcal(value)} y2={g.kcal(value)} stroke={theme.border} strokeWidth={1 * u} />
            <text x={g.x0 - 14 * u} y={g.kcal(value)} dy="0.35em" textAnchor="end" fill={theme.textMuted} fontFamily={FONT.mono} fontSize={15 * u}>
              {`${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-US")}`}
            </text>
          </g>
        ))}

        {/* Empty day cells in the rides band, so a day without a ride still reads as a day. */}
        {data.weight.map((d, i) => (
          <rect key={d.date} x={g.x0 + i * g.step + cellGap / 2} y={g.rides.y} width={g.step - cellGap} height={g.rides.h} fill={theme.surface} />
        ))}

        {/* The data, revealed left to right. */}
        <g clipPath="url(#descent-drawn)">
          <path d={g.areaPath} fill="url(#descent-fill)" />
          {data.weight.map((d, i) => (d.weight == null ? null : <circle key={d.date} cx={g.x(i)} cy={g.y(d.weight)} r={2.6 * u} fill={theme.text} opacity={0.34} />))}
          <path d={g.linePath} fill="none" stroke={theme.accent} strokeWidth={3 * u} strokeLinejoin="round" strokeLinecap="round" />

          {g.deltas.map((delta, i) =>
            delta == null ? null : (
              <rect
                key={i}
                x={g.x(i) - barWidth / 2}
                y={Math.min(g.kcal(0), g.kcal(delta))}
                width={barWidth}
                height={Math.max(1 * u, Math.abs(g.kcal(delta) - g.kcal(0)))}
                fill={delta > 0 ? theme.text : theme.textMuted}
                opacity={delta > 0 ? 0.9 : 0.75}
              />
            )
          )}
          {data.food.map((d, i) => {
            const met = d.proteinTarget != null && d.protein >= d.proteinTarget;
            const side = Math.min(g.protein.h, g.step - cellGap) * (met ? 1 : 0.42);
            return <rect key={d.date} x={g.x(i) - side / 2} y={g.protein.y + (g.protein.h - side) / 2} width={side} height={side} fill={met ? theme.text : theme.textMuted} opacity={met ? 0.8 : 0.55} />;
          })}

          {data.weight.map((d, i) => {
            const colours = g.ridesByDay.get(d.date);
            if (!colours) return null;
            const each = g.rides.h / colours.length;
            return colours.map((colour, k) => (
              <rect key={`${d.date}-${k}`} x={g.x0 + i * g.step + cellGap / 2} y={g.rides.y + k * each} width={g.step - cellGap} height={each - (k < colours.length - 1 ? cellGap : 0)} fill={colour} />
            ));
          })}
        </g>

        {/* The first weigh-in, named once; the rider; and where the line ends. */}
        {drawn > 0 && data.weight[0].weight != null ? (
          <text x={g.x(0) + 2 * u} y={g.profile.y - 12 * u} fill={theme.textMuted} fontFamily={FONT.mono} fontSize={17 * u}>
            {lb(data.weight[0].weight)} first weigh-in
          </text>
        ) : null}
        {drawn > 0 ? (
          <>
            <circle cx={rider.x} cy={rider.y} r={11 * u} fill={theme.bg} />
            <circle cx={rider.x} cy={rider.y} r={8 * u} fill={theme.text} />
          </>
        ) : null}
        {finished ? (
          <text x={rider.x - 4 * u} y={rider.y - 34 * u} textAnchor="end" fill={theme.text} stroke={theme.bg} strokeWidth={7 * u} paintOrder="stroke" strokeLinejoin="round" fontFamily={FONT.mono} fontSize={22 * u} opacity={closing}>
            {lb(to.avg)} lb
          </text>
        ) : null}
      </svg>

      {/* Header: what this is, and the one number. */}
      <div style={{ position: "absolute", left: g.pad, top: g.pad * 0.85 }}>
        <div style={small}>
          {`${mdShort(data.window.start)} – ${mdShort(data.window.end)}, ${data.window.end.slice(0, 4)}  ·  ${days} DAYS`.toUpperCase()}
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 68 * u, lineHeight: 1.1, marginTop: 8 * u }}>The descent</div>
      </div>
      <div style={{ position: "absolute", top: stacked ? g.pad * 0.85 + 132 * u : g.pad * 0.85, ...(stacked ? { left: g.pad } : { right: g.pad, textAlign: "right" }) }}>
        <div style={small}>
          {finished ? `7-DAY AVERAGE, ${mdShort(from.date)} → ${mdShort(to.date)}`.toUpperCase() : drawn > 0 ? `${mdShort(today.date)}  ·  7-DAY AVERAGE ${lb(today.avg)} LB`.toUpperCase() : "7-DAY AVERAGE"}
        </div>
        <div style={{ ...mono, fontWeight: 500, fontSize: 84 * u, lineHeight: 1.1, marginTop: 4 * u }}>
          {finished ? `${minus(change, lb(Math.abs(change)))} lb` : downSoFar == null ? "\u00a0" : `${minus(downSoFar, lb(Math.abs(downSoFar)))} lb`}
        </div>
      </div>

      {bandLabel(g.profile.y - 30 * u, "WEIGHT, LB  ·  7-DAY AVERAGE AND EACH WEIGH-IN", data.trendPerWeek == null ? undefined : `${minus(data.trendPerWeek, lb(Math.abs(data.trendPerWeek)))} lb a week`)}
      {bandLabel(g.food.y, "FOOD  ·  KCAL AGAINST THE DAY'S TARGET")}
      <div style={{ ...small, position: "absolute", left: g.x0, right: g.pad, top: g.rides.y - g.label, display: "flex", gap: 26 * u, whiteSpace: "nowrap" }}>
        <span>RIDES</span>
        {data.bikes.map((bike) => (
          <span key={bike.name} style={{ letterSpacing: 0.3 * u, color: theme.text, display: "flex", alignItems: "center", gap: 8 * u }}>
            <span style={{ width: 13 * u, height: 13 * u, background: g.bikeColour.get(bike.name), display: "inline-block" }} />
            {bike.name}
            <span style={{ color: theme.textMuted }}>{bike.rides}</span>
          </span>
        ))}
      </div>

      {/* The totals: what the picture covers. */}
      <div style={{ position: "absolute", left: g.pad, right: g.pad, bottom: g.pad * 0.7, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 * u }}>
        <div style={{ ...mono, fontSize: 22 * u, color: theme.text, opacity: closing, display: "flex", flexWrap: "wrap", columnGap: 30 * u, rowGap: 6 * u }}>
          {[
            `${data.totals.days} days`,
            `${data.totals.weighIns} weigh-ins`,
            `${data.totals.daysLogged} days of food logged`,
            `at or under the calorie target on ${data.totals.caloriesOnTarget}`,
            `protein target met on ${data.totals.proteinOnTarget}`,
            `${data.totals.rides} rides`,
            `${mi(data.totals.distanceMeters)} mi`,
          ].map((text) => (
            <span key={text}>{text}</span>
          ))}
        </div>
        <div style={{ ...small, letterSpacing: 0.5 * u }}>justmy.website</div>
      </div>
    </>
  );
}

function TheDescent(_: PieceProps) {
  return <Stage<Snapshot> piece={PIECE}>{(data) => <Layout data={data} />}</Stage>;
}

export const theDescent = pieceCompositions({
  slug: "the-descent",
  component: TheDescent,
  variants: [{ format: "wide", seconds: 26 }, { format: "card" }],
});
