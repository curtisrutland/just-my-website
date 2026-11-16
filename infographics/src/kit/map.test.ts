import { describe, expect, it } from "vitest";
import { fitTraces, type LonLat, pointAt } from "./map";

const box = { x: 100, y: 50, width: 800, height: 600 };
// A square about 1 km on a side, near Georgetown, Texas.
const square: LonLat[] = [
  [-97.7, 30.65],
  [-97.69, 30.65],
  [-97.69, 30.6586],
  [-97.7, 30.6586],
];

describe("fitTraces", () => {
  it("puts every point inside the box, touching it on the tighter axis", () => {
    const project = fitTraces([square], box);
    const pts = square.map(project);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.x - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(box.x + box.width + 1e-6);
    expect(Math.min(...ys)).toBeCloseTo(box.y, 3); // the box is wider than tall, so height binds
    expect(Math.max(...ys)).toBeCloseTo(box.y + box.height, 3);
  });

  it("centres the traces and puts north up, east right", () => {
    const project = fitTraces([square], box);
    const [sw, se, ne] = square.map(project);
    expect((sw[0] + se[0]) / 2).toBeCloseTo(box.x + box.width / 2, 3);
    expect(se[0]).toBeGreaterThan(sw[0]);
    expect(ne[1]).toBeLessThan(se[1]);
  });

  it("keeps true shape: a square on the ground is a square on the page", () => {
    const project = fitTraces([square], box);
    const [sw, se, ne] = square.map(project);
    const width = se[0] - sw[0];
    const height = se[1] - ne[1];
    // 0.01° of longitude at 30.65° N is 0.958 km; 0.0086° of latitude is 0.956 km.
    expect(width / height).toBeCloseTo(1, 1);
  });

  it("fits several traces together, so they share one map", () => {
    const far: LonLat[] = [
      [-97.6, 30.7],
      [-97.59, 30.7],
    ];
    const project = fitTraces([square, far], box);
    for (const p of [...square, ...far].map(project)) {
      expect(p[0]).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(p[0]).toBeLessThanOrEqual(box.x + box.width + 1e-6);
      expect(p[1]).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(p[1]).toBeLessThanOrEqual(box.y + box.height + 1e-6);
    }
  });
});

describe("pointAt", () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 20],
  ];
  it("interpolates between points at a fractional index", () => {
    expect(pointAt(line, 0.5)).toEqual([5, 0]);
    expect(pointAt(line, 1.25)).toEqual([10, 5]);
  });
  it("clamps to the ends", () => {
    expect(pointAt(line, -3)).toEqual([0, 0]);
    expect(pointAt(line, 99)).toEqual([10, 20]);
  });
});
