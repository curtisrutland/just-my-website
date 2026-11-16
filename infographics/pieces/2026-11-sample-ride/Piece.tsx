import { useLayoutEffect, useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { pieceCompositions, type PieceProps } from "../../src/kit/compose";
import { FONT } from "../../src/kit/fonts";
import { fitTraces, type LonLat, pointAt, strokeTrace } from "../../src/kit/map";
import { Stage } from "../../src/kit/Stage";
import { dark } from "../../src/kit/theme";
import { ft, hms, mdLong, mi, rideTitle } from "../../src/kit/units";
import type { Snapshot } from "./data";

const PIECE = "2026-11-sample-ride";
const theme = dark;

/** The fractional index of time `at` in an ascending list of sample times. */
function indexAtTime(t: number[], at: number): number {
  if (at <= t[0]) return 0;
  if (at >= t[t.length - 1]) return t.length - 1;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= at) lo = mid;
    else hi = mid;
  }
  return lo + (at - t[lo]) / (t[hi] - t[lo] || 1);
}

function Layout({ data }: { data: Snapshot }) {
  const { width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const isVideo = durationInFrames > 1;
  const u = Math.min(width, height) / 1080; // every size below is in these units, so all formats share one layout

  const pad = 64 * u;
  const headerHeight = 220 * u;
  const footerHeight = 230 * u;
  const mapBox = { x: pad, y: headerHeight, width: width - 2 * pad, height: height - headerHeight - footerHeight };

  // Projected once per layout; nothing here depends on the frame.
  const points = useMemo(() => {
    const trace = data.track.lon.map((lon, i): LonLat => [lon, data.track.lat[i]]);
    const inset = 24 * u;
    const project = fitTraces([trace], {
      x: mapBox.x + inset,
      y: mapBox.y + inset,
      width: mapBox.width - 2 * inset,
      height: mapBox.height - 2 * inset,
    });
    return trace.map(project);
  }, [data, u, mapBox.x, mapBox.y, mapBox.width, mapBox.height]);

  // Motion comes from the frame number alone: a constant multiple of real time.
  const { t } = data.track;
  const progress = isVideo ? frame / (durationInFrames - 1) : 1;
  const elapsed = t[0] + progress * (t[t.length - 1] - t[0]);
  const index = indexAtTime(t, elapsed);

  const canvas = useRef<HTMLCanvasElement>(null);
  const density = typeof window === "undefined" ? 1 : window.devicePixelRatio; // 5 on a poster render
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (isVideo) {
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 3 * u;
      strokeTrace(ctx, points);
    }
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 4 * u;
    strokeTrace(ctx, points, index);

    const dot = (at: [number, number], radius: number, fill: string) => {
      ctx.beginPath();
      ctx.arc(at[0], at[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    dot(points[0], 7 * u, theme.textMuted);
    dot(pointAt(points, index), 11 * u, theme.bg);
    dot(pointAt(points, index), 8 * u, theme.text);
  }, [points, index, isVideo, width, height, u, density]);

  const { ride, counts } = data;
  const stats: [label: string, value: string][] = [
    ["DISTANCE", ride.distanceMeters == null ? "—" : `${mi(ride.distanceMeters)} mi`],
    ["MOVING TIME", hms(ride.movingSeconds)],
    ["ASCENT", ride.totalAscentMeters == null ? "—" : `${ft(ride.totalAscentMeters)} ft`],
  ];
  const label = { fontFamily: FONT.mono, fontSize: 20 * u, letterSpacing: 2 * u, color: theme.textMuted } as const;

  return (
    <>
      <canvas ref={canvas} width={width * density} height={height * density} style={{ position: "absolute", inset: 0, width, height }} />

      <div style={{ position: "absolute", left: pad, right: pad, top: pad * 0.9 }}>
        <div style={label}>SAMPLE PIECE</div>
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 64 * u, lineHeight: 1.15, marginTop: 10 * u }}>
          {rideTitle(ride)}
        </div>
        <div style={{ fontSize: 28 * u, color: theme.textMuted, marginTop: 4 * u }}>{mdLong(ride.localDate)}</div>
      </div>

      {isVideo ? (
        <div style={{ position: "absolute", right: pad, top: pad * 0.9, textAlign: "right" }}>
          <div style={label}>ELAPSED</div>
          <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 44 * u, marginTop: 10 * u }}>{hms(elapsed - t[0])}</div>
        </div>
      ) : null}

      <div style={{ position: "absolute", left: pad, right: pad, bottom: pad * 0.9 }}>
        <div style={{ display: "flex", gap: 72 * u }}>
          {stats.map(([name, value]) => (
            <div key={name}>
              <div style={label}>{name}</div>
              <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 44 * u, marginTop: 8 * u }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ ...label, letterSpacing: 0.5 * u, marginTop: 28 * u }}>
          1 ride · {counts.samplesWithPosition.toLocaleString("en-US")} GPS points at full resolution · justmy.website
        </div>
      </div>
    </>
  );
}

function SampleRide(_: PieceProps) {
  return <Stage<Snapshot> piece={PIECE}>{(data) => <Layout data={data} />}</Stage>;
}

export const sampleRide = pieceCompositions({
  slug: "sample-ride",
  component: SampleRide,
  variants: [{ format: "wide", seconds: 6 }, { format: "card" }, { format: "poster" }],
});
