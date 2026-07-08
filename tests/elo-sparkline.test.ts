import { describe, it, expect } from "vitest";
import {
  eloSparklinePoints,
  SPARKLINE_VIEWBOX_WIDTH,
  SPARKLINE_VIEWBOX_HEIGHT,
} from "@/lib/elo-sparkline";

function expectInsideViewBox(x: number, y: number) {
  expect(Number.isNaN(x)).toBe(false);
  expect(Number.isNaN(y)).toBe(false);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThanOrEqual(SPARKLINE_VIEWBOX_WIDTH);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(y).toBeLessThanOrEqual(SPARKLINE_VIEWBOX_HEIGHT);
}

describe("eloSparklinePoints", () => {
  it("returns no points for an empty history", () => {
    expect(eloSparklinePoints([])).toEqual([]);
  });

  it("returns a single centered point for one history entry (no NaN)", () => {
    const points = eloSparklinePoints([1500]);
    expect(points).toHaveLength(1);
    const [p] = points;
    expectInsideViewBox(p.x, p.y);
    expect(p.x).toBe(SPARKLINE_VIEWBOX_WIDTH / 2);
    expect(p.y).toBe(SPARKLINE_VIEWBOX_HEIGHT / 2);
  });

  it("returns two distinct in-bounds points for two history entries", () => {
    const points = eloSparklinePoints([1400, 1500]);
    expect(points).toHaveLength(2);
    for (const p of points) expectInsideViewBox(p.x, p.y);
    // rising elo -> second point renders higher (smaller y) than the first
    expect(points[1].y).toBeLessThan(points[0].y);
    expect(points[0].x).toBeLessThan(points[1].x);
  });

  it("spreads points across x and stays in-bounds for a flat (zero-range) series", () => {
    const points = eloSparklinePoints([1500, 1500, 1500]);
    expect(points).toHaveLength(3);
    for (const p of points) expectInsideViewBox(p.x, p.y);
    // all y values equal (centered) since range collapses to 0
    expect(points[0].y).toBe(points[1].y);
    expect(points[1].y).toBe(points[2].y);
    // x values still spread out left to right
    expect(points[0].x).toBeLessThan(points[1].x);
    expect(points[1].x).toBeLessThan(points[2].x);
  });

  it("stays fully in-bounds for a normal multi-point series", () => {
    const values = [1200, 1450, 1300, 1600, 1550, 1700];
    const points = eloSparklinePoints(values);
    expect(points).toHaveLength(values.length);
    for (const p of points) expectInsideViewBox(p.x, p.y);
    // min elo (index 0) should render at the bottom-most y among all points
    const maxY = Math.max(...points.map((p) => p.y));
    expect(points[0].y).toBe(maxY);
    // max elo (index 5, value 1700) should render at the top-most y
    const minY = Math.min(...points.map((p) => p.y));
    expect(points[5].y).toBe(minY);
  });
});
