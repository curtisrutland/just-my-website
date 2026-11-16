import { geoMercator } from "d3-geo";

/** A GPS point as GeoJSON orders it: [longitude, latitude], in degrees. */
export type LonLat = [lon: number, lat: number];

export type Box = { x: number; y: number; width: number; height: number };

/**
 * A projection that fits a set of traces inside a box, centred, with their true shape kept
 * (Mercator, which is conformal, so a trail's turns look right at any latitude). Returns a
 * function from [lon, lat] to [x, y] in the box's own pixels.
 *
 * Fit once per layout and reuse it: every piece that draws traces on the same box then agrees
 * on where a place is.
 */
export function fitTraces(traces: LonLat[][], box: Box): (point: LonLat) => [number, number] {
  const projection = geoMercator().fitExtent(
    [
      [box.x, box.y],
      [box.x + box.width, box.y + box.height],
    ],
    { type: "MultiLineString", coordinates: traces }
  );
  return (point) => projection(point) as [number, number];
}

/**
 * Stroke a projected trace onto a canvas, from its first point to `end` (a fractional index, so a
 * trace can be drawn part-way to its next point). The caller sets the stroke style and width.
 */
export function strokeTrace(ctx: CanvasRenderingContext2D, points: [number, number][], end: number = points.length - 1) {
  if (points.length === 0 || end <= 0) return;
  const whole = Math.min(Math.floor(end), points.length - 1);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i <= whole; i++) ctx.lineTo(points[i][0], points[i][1]);
  const [x, y] = pointAt(points, end);
  ctx.lineTo(x, y);
  ctx.stroke();
}

/** The position at a fractional index along a projected trace. */
export function pointAt(points: [number, number][], index: number): [number, number] {
  const clamped = Math.max(0, Math.min(index, points.length - 1));
  const i = Math.floor(clamped);
  const next = points[Math.min(i + 1, points.length - 1)];
  const f = clamped - i;
  return [points[i][0] + (next[0] - points[i][0]) * f, points[i][1] + (next[1] - points[i][1]) * f];
}
